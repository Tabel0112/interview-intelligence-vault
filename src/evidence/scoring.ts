import { explainEvidenceScore } from "./explain.js";
import { calculateRecencyScore } from "./recency.js";
import { calculateRepetitionScore, deduplicateEvidenceCandidates } from "./repetition.js";
import {
  SCORER_VERSION, USE_TYPE_WEIGHTS, calculateConfidence, calculateCorrectionWeight, calculateDirectness,
  calculateRelevance, calculateSourceStrength, calculateSpecificity, candidateCaps, classifyEvidenceStrength, round,
} from "./rules.js";
import type {
  CandidateScoringContext, EvidenceBundleAssessment, EvidenceCandidate, EvidenceScoringInput, EvidenceStance,
  EvidenceStrength, ScoredEvidenceCandidate,
} from "./types.js";

const scoreOrder: Record<EvidenceStrength, number> = { strong: 4, mixed: 3, weak: 2, conflicting: 1, no_evidence: 0 };
const byScore = (a: ScoredEvidenceCandidate, b: ScoredEvidenceCandidate) => b.finalScore - a.finalScore || a.candidate.id.localeCompare(b.candidate.id);
const meaningful = (item: ScoredEvidenceCandidate) => item.strength !== "no_evidence";
const supportStances = new Set<EvidenceStance>(["supports", "updates"]);

export function scoreEvidenceCandidate(candidate: EvidenceCandidate, context: CandidateScoringContext): ScoredEvidenceCandidate {
  const stance = context.knownOppositionCandidateIds?.includes(candidate.id) ? "opposes" : candidate.stance ?? "unknown";
  const components = {
    relevance: calculateRelevance(candidate, context.claimText, context.requiredSpecificityTerms),
    directness: calculateDirectness(candidate, context.useType),
    specificity: calculateSpecificity(candidate, context.claimText, context.requiredSpecificityTerms),
    sourceStrength: calculateSourceStrength(candidate),
    repetition: calculateRepetitionScore({ ...candidate, stance }, context.allCandidates, context.useType),
    recency: calculateRecencyScore(candidate, context.now, context.useType),
    correctionWeight: calculateCorrectionWeight(candidate),
    confidence: calculateConfidence(candidate),
    oppositionPenalty: stance === "opposes" ? 0.05 : 0,
  };
  const weights = USE_TYPE_WEIGHTS[context.useType];
  const weighted = Object.entries(weights).reduce((sum, [key, weight]) => sum + components[key as keyof typeof weights] * weight, 0);
  const finalScore = round(weighted - components.oppositionPenalty);
  const caps = candidateCaps(candidate, context.useType, components, context.requiredSpecificityTerms, context.claimText);
  const strength = classifyEvidenceStrength(finalScore, caps);
  const reasons = [
    ...caps.reasons,
    components.relevance < 0.35 ? "Low relevance to the claim" : "",
    components.directness < 0.5 ? "Evidence is indirect" : "",
    components.specificity < 0.4 ? "Evidence lacks specific claim details" : "",
    components.repetition >= 0.75 ? "Independent evidence repeats the support" : "",
    candidate.userCorrectionStatus === "confirmed" ? "Confirmed user correction has priority" : "",
  ].filter(Boolean);
  return { candidate: { ...candidate, stance }, stance, components, finalScore, strength, caps, reasons };
}

function maxScore(items: ScoredEvidenceCandidate[]): number {
  return round(items.length ? Math.max(...items.map((item) => item.finalScore)) : 0);
}

function hasExplicitPattern(candidate: EvidenceCandidate): boolean {
  return /\b(always|usually|often|repeatedly|consistently|tend(?:s)? to)\b/i.test(candidate.quote ?? "");
}

function passesUseTypeGate(input: Pick<EvidenceScoringInput, "useType">, support: ScoredEvidenceCandidate[]): boolean {
  if (input.useType === "direct_fact") return support.some((item) => item.strength === "strong" && item.components.directness >= 0.7);
  if (input.useType === "pattern") return support.length >= 2 || support.some((item) => hasExplicitPattern(item.candidate) && item.finalScore >= 0.70);
  if (input.useType === "inference") return support.filter((item) => item.finalScore >= 0.55).length >= 2 && maxScore(support) >= 0.82;
  return support.some((item) => item.finalScore >= 0.72) && support.some((item) => item.components.recency >= 0.6 || item.candidate.userCorrectionStatus === "confirmed");
}

function hasStrongEnoughSupport(useType: EvidenceScoringInput["useType"], support: ScoredEvidenceCandidate[]): boolean {
  if (support.some((item) => item.strength === "strong")) return true;
  if (useType === "pattern") return support.some((item) => hasExplicitPattern(item.candidate) && item.finalScore >= 0.70);
  return false;
}

export function aggregateSupportAndOpposition(
  input: Pick<EvidenceScoringInput, "claimText" | "useType">,
  scoredCandidates: ScoredEvidenceCandidate[],
): EvidenceBundleAssessment {
  const scoredEvidence = [...scoredCandidates].sort(byScore);
  const usableEvidence = scoredEvidence.filter(meaningful);
  const bestSupportingEvidence = usableEvidence.filter((item) => supportStances.has(item.stance)).sort(byScore);
  const bestOpposingEvidence = usableEvidence.filter((item) => item.stance === "opposes").sort(byScore);
  const qualifyingEvidence = usableEvidence.filter((item) => item.stance === "qualifies").sort(byScore);
  const supportScore = maxScore(bestSupportingEvidence);
  const oppositionScore = maxScore(bestOpposingEvidence);
  const qualificationScore = maxScore(qualifyingEvidence);
  const strongSupport = supportScore >= 0.70;
  const strongOpposition = oppositionScore >= 0.65;
  const comparableOpposition = oppositionScore >= Math.max(0.55, supportScore - 0.15);
  const updateWins = bestSupportingEvidence.some((item) => item.stance === "updates" && item.finalScore >= oppositionScore);
  const hasConflict = strongSupport && strongOpposition && comparableOpposition && !updateWins;
  let strength: EvidenceStrength;
  if (!usableEvidence.length || !bestSupportingEvidence.length) strength = "no_evidence";
  else if (hasConflict) strength = "conflicting";
  else if (!passesUseTypeGate(input, bestSupportingEvidence)) strength = "weak";
  else if (strongOpposition || bestOpposingEvidence.length || qualifyingEvidence.length || updateWins) strength = "mixed";
  else if (hasStrongEnoughSupport(input.useType, bestSupportingEvidence)) strength = "strong";
  else strength = "weak";
  const reasons = [
    !usableEvidence.length ? "No usable source-backed evidence" : "",
    hasConflict ? "Comparable source-backed support and opposition remain unresolved" : "",
    qualifyingEvidence.length ? "Qualifying evidence requires a caveat" : "",
    updateWins ? "Newer or explicit update evidence changes older evidence" : "",
    strength === "weak" && input.useType === "pattern" ? "A pattern needs repeated independent evidence or an explicit pattern statement" : "",
    strength === "weak" && input.useType === "inference" ? "An inference needs multiple explainable supporting sources" : "",
  ].filter(Boolean);
  const assessment: EvidenceBundleAssessment = {
    claimText: input.claimText, useType: input.useType, strength, supportScore, oppositionScore, qualificationScore,
    bestSupportingEvidence, bestOpposingEvidence, qualifyingEvidence, usableEvidence, hasConflict,
    scoredEvidence,
    hasWeakEvidenceOnly: usableEvidence.length > 0 && strength === "weak", hasNoEvidence: strength === "no_evidence",
    explanation: "", reasons, scorerVersion: SCORER_VERSION,
  };
  assessment.explanation = explainEvidenceScore(assessment);
  return assessment;
}

export function scoreEvidenceBundle(input: EvidenceScoringInput): EvidenceBundleAssessment {
  const duplicateIds = new Set(input.knownDuplicateCandidateIds ?? []);
  const oppositionIds = new Set(input.knownOppositionCandidateIds ?? []);
  const candidates = deduplicateEvidenceCandidates(input.candidates
    .filter((candidate) => !duplicateIds.has(candidate.id))
    .map((candidate) => oppositionIds.has(candidate.id) ? { ...candidate, stance: "opposes" as const } : candidate));
  const context = {
    claimText: input.claimText, useType: input.useType, allCandidates: candidates, now: input.now,
    knownOppositionCandidateIds: input.knownOppositionCandidateIds, requiredSpecificityTerms: input.requiredSpecificityTerms,
  };
  return aggregateSupportAndOpposition(input, candidates.map((candidate) => scoreEvidenceCandidate(candidate, context))
    .sort((a, b) => scoreOrder[b.strength] - scoreOrder[a.strength] || byScore(a, b)));
}
