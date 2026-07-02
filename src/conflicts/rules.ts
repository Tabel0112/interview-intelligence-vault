import type { ConflictCandidate, ConflictClassification, ConflictClassificationOptions, ConflictComponentScores } from "./types.js";

const stopwords = new Set(["a", "an", "and", "are", "as", "be", "but", "for", "i", "in", "is", "it", "of", "on", "or", "the", "to", "we"]);
const conditional = /\b(if|when|unless|depending|except|only when|in uncertain|for uncertain|high[- ]confidence|low[- ]confidence)\b/i;
const negative = /\b(no|not|never|avoid|reject|without|cannot|can't|shouldn't|mustn't|do not|don't)\b/i;
const assertion = /\b(should|must|prefer|want|accept|use|require|allow|is|are|will)\b/i;
const tensionPairs = [
  [/\bautomatic|automated|speed|fast\b/i, /\bmanual|review|accurate|accuracy\b/i],
  [/\bsimple|simplicity\b/i, /\bvisible|reviewable|auditable|transparent\b/i],
  [/\bprivate|privacy\b/i, /\bshare|shared|collaborative\b/i],
];

const round = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
const tokens = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 2 && !stopwords.has(token)) ?? []);

// --- Predicate-aligned negation ------------------------------------------------------------------
// A negation only creates a polarity OPPOSITION when the predicate it denies is actually asserted by
// the other statement. "Never display API keys in generated notes" denies DISPLAYING keys — it does not
// oppose "generated notes are a disposable view layer" merely because both mention "generated notes".
const NEG_WORDS = new Set(["no", "not", "never", "avoid", "reject", "without", "cannot"]);
const NEGATION_WINDOW = 6; // content tokens after the marker = the denied predicate phrase
const lightStem = (token: string): string => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token);

/**
 * True when a negated predicate in `negatedText` aligns with `otherText`: the content tokens immediately
 * following a negation marker (the denied action/property + its object) must be asserted by the other
 * side — either its leading token (usually the verb/value being denied, e.g. "display", "Friday") or a
 * majority of the denied phrase. Prevents topic-overlap-only "contradictions" between compatible
 * statements that merely share a container/location token.
 */
function negatedPredicateAligns(negatedText: string, otherText: string): boolean {
  const other = tokens(otherText);
  const otherStems = new Set([...other].map(lightStem));
  const inOther = (token: string) => other.has(token) || otherStems.has(lightStem(token));
  const words = negatedText.toLowerCase().replace(/n't\b/g, " not").match(/[a-z0-9]+/g) ?? [];
  for (let index = 0; index < words.length; index++) {
    if (!NEG_WORDS.has(words[index])) continue;
    const denied: string[] = [];
    for (let next = index + 1; next < words.length && denied.length < NEGATION_WINDOW; next++) {
      const word = words[next];
      if (word.length > 2 && !stopwords.has(word) && !NEG_WORDS.has(word)) denied.push(word);
    }
    if (!denied.length) continue;
    const matches = denied.filter(inOther).length;
    if (inOther(denied[0]) || matches >= Math.ceil(denied.length / 2)) return true;
  }
  return false;
}
const overlap = (a: string, b: string) => {
  const left = tokens(a), right = tokens(b);
  const shared = [...left].filter((token) => right.has(token)).length;
  return round(shared / Math.max(1, Math.min(left.size, right.size)));
};
function temporal(candidate: ConflictCandidate): Pick<ConflictClassification, "newerTargetId" | "olderTargetId"> & { score: number } {
  const left = candidate.leftTimestamp ? Date.parse(candidate.leftTimestamp) : Number.NaN;
  const right = candidate.rightTimestamp ? Date.parse(candidate.rightTimestamp) : Number.NaN;
  if (!Number.isFinite(left) || !Number.isFinite(right) || left === right) return { score: 0, newerTargetId: null, olderTargetId: null };
  const distance = Math.min(1, Math.abs(left - right) / (1000 * 60 * 60 * 24 * 30));
  return {
    score: round(distance),
    newerTargetId: left > right ? candidate.leftTargetId : candidate.rightTargetId,
    olderTargetId: left > right ? candidate.rightTargetId : candidate.leftTargetId,
  };
}

export function scoreConflict(candidate: ConflictCandidate, kind: ConflictClassification["kind"], components: ConflictComponentScores, options: ConflictClassificationOptions = {}): number {
  const validated = new Set(options.validatedEvidenceIds ?? [...candidate.leftEvidenceIds, ...candidate.rightEvidenceIds]);
  const leftValid = candidate.leftEvidenceIds.filter((id) => validated.has(id));
  const rightValid = candidate.rightEvidenceIds.filter((id) => validated.has(id));
  if (!leftValid.length || !rightValid.length) return round(0.15 + 0.2 * components.topicOverlap);
  const average = (ids: string[]) => ids.reduce((sum, id) => sum + (options.evidenceScores?.[id] ?? 0.7), 0) / ids.length;
  const quality = Math.min(average(leftValid), average(rightValid));
  const correctionBoost = new Set(options.userCorrectionTargetIds ?? []).has(candidate.leftTargetId)
    || new Set(options.userCorrectionTargetIds ?? []).has(candidate.rightTargetId) ? 0.08 : 0;
  const base = kind === "direct_contradiction" ? 0.45 + 0.2 * components.topicOverlap + 0.2 * quality + 0.15 * components.polarityOpposition
    : kind === "temporal_update" ? 0.4 + 0.15 * components.topicOverlap + 0.2 * quality + 0.2 * components.temporalDistance
      : kind === "conditional_difference" ? 0.4 + 0.15 * components.topicOverlap + 0.2 * quality + 0.15 * components.conditionality
        : kind === "tension" ? 0.4 + 0.2 * components.topicOverlap + 0.2 * quality
          : 0.15 + 0.15 * components.topicOverlap;
  const scored = round(base + correctionBoost);
  if (quality < 0.45) return Math.min(scored, 0.59);
  if (quality < 0.65) return Math.min(scored, 0.79);
  return scored;
}

export function classifyConflictCandidate(candidate: ConflictCandidate, options: ConflictClassificationOptions = {}): ConflictClassification {
  const topicOverlap = candidate.sharedEntities?.length || candidate.sharedTopics?.length ? 1 : overlap(candidate.leftText, candidate.rightText);
  const leftNegative = negative.test(candidate.leftText), rightNegative = negative.test(candidate.rightText);
  // Opposition requires: exactly one negated side, both sides asserting, AND the denied predicate must be
  // asserted by the other side (predicate alignment). A negation about an unrelated action that merely
  // shares a topic/location token ("generated notes") is NOT a contradiction.
  const negatedSide = leftNegative && !rightNegative ? candidate.leftText : rightNegative && !leftNegative ? candidate.rightText : null;
  const otherSide = leftNegative && !rightNegative ? candidate.rightText : candidate.leftText;
  const polarityOpposition = negatedSide != null
    && assertion.test(candidate.leftText) && assertion.test(candidate.rightText)
    && negatedPredicateAligns(negatedSide, otherSide) ? 1 : 0;
  const conditionality = conditional.test(candidate.leftText) || conditional.test(candidate.rightText) ? 1 : 0;
  const temporalInfo = temporal(candidate);
  const validated = new Set(options.validatedEvidenceIds ?? [...candidate.leftEvidenceIds, ...candidate.rightEvidenceIds]);
  const evidenceCoverage = candidate.leftEvidenceIds.some((id) => validated.has(id)) && candidate.rightEvidenceIds.some((id) => validated.has(id)) ? 1 : 0;
  const tension = tensionPairs.some(([left, right]) =>
    (left.test(candidate.leftText) && right.test(candidate.rightText)) || (right.test(candidate.leftText) && left.test(candidate.rightText)));
  const components: ConflictComponentScores = { topicOverlap, polarityOpposition, conditionality, temporalDistance: temporalInfo.score, evidenceCoverage };

  let kind: ConflictClassification["kind"] = "weak_or_ambiguous";
  if (evidenceCoverage && topicOverlap >= 0.15) {
    if (conditionality && (polarityOpposition || tension)) kind = "conditional_difference";
    else if ((options.preferTemporalUpdate ?? candidate.preferTemporalUpdate) && temporalInfo.score > 0 && (polarityOpposition || tension)) kind = "temporal_update";
    else if (polarityOpposition) kind = "direct_contradiction";
    else if (tension) kind = "tension";
  }
  const confidence = scoreConflict(candidate, kind, components, options);
  const labels: Record<ConflictClassification["kind"], string> = {
    direct_contradiction: "The two source-backed statements directly oppose each other.",
    tension: "The statements express competing goals or constraints.",
    temporal_update: "The newer source-backed statement appears to update the older one.",
    conditional_difference: "The statements differ under an explicit condition or context.",
    weak_or_ambiguous: "The pair lacks enough shared context or source-backed evidence for a reliable conflict.",
  };
  return {
    kind, confidence,
    summary: `${kind.replaceAll("_", " ")} between ${candidate.leftTargetId} and ${candidate.rightTargetId}`,
    explanation: `${labels[kind]} Topic overlap=${topicOverlap.toFixed(3)}; polarity opposition=${polarityOpposition.toFixed(3)}; conditionality=${conditionality.toFixed(3)}; temporal clarity=${temporalInfo.score.toFixed(3)}; validated-side coverage=${evidenceCoverage.toFixed(3)}; confidence=${confidence.toFixed(3)}.`,
    componentScores: components,
    newerTargetId: kind === "temporal_update" ? temporalInfo.newerTargetId : null,
    olderTargetId: kind === "temporal_update" ? temporalInfo.olderTargetId : null,
  };
}

export const classifyConflict = classifyConflictCandidate;
