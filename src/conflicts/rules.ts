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
  const polarityOpposition = leftNegative !== rightNegative && assertion.test(candidate.leftText) && assertion.test(candidate.rightText) ? 1 : 0;
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
