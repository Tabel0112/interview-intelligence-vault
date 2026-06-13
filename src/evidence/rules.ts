import type { EvidenceCandidate, EvidenceComponentScores, EvidenceScoreCaps, EvidenceSourceKind, EvidenceStrength, EvidenceUseType } from "./types.js";

export const SCORER_VERSION = "mvp-evidence-v1";

export const DEFAULT_WEIGHTS: Record<keyof Omit<EvidenceComponentScores, "oppositionPenalty">, number> = {
  relevance: 0.24, directness: 0.20, specificity: 0.16, sourceStrength: 0.16,
  repetition: 0.08, recency: 0.06, correctionWeight: 0.06, confidence: 0.04,
};

export const USE_TYPE_WEIGHTS: Record<EvidenceUseType, typeof DEFAULT_WEIGHTS> = {
  direct_fact: { relevance: 0.20, directness: 0.26, specificity: 0.20, sourceStrength: 0.16, repetition: 0.04, recency: 0.04, correctionWeight: 0.06, confidence: 0.04 },
  pattern: { relevance: 0.18, directness: 0.14, specificity: 0.12, sourceStrength: 0.15, repetition: 0.24, recency: 0.06, correctionWeight: 0.06, confidence: 0.05 },
  inference: { relevance: 0.22, directness: 0.12, specificity: 0.14, sourceStrength: 0.18, repetition: 0.18, recency: 0.05, correctionWeight: 0.06, confidence: 0.05 },
  recommendation: { relevance: 0.20, directness: 0.15, specificity: 0.14, sourceStrength: 0.15, repetition: 0.10, recency: 0.14, correctionWeight: 0.08, confidence: 0.04 },
};

const stopWords = new Set(["a", "an", "and", "are", "as", "at", "be", "because", "by", "for", "from", "has", "in", "is", "it", "of", "on", "or", "that", "the", "this", "to", "was", "were", "with"]);
export const clamp = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
export const round = (value: number): number => Math.round(clamp(value) * 10000) / 10000;

export function tokens(text = ""): string[] {
  return [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter((token) => token.length > 1 && !stopWords.has(token)) ?? [])];
}

export function lexicalCoverage(claimText: string, quote = ""): number {
  const claim = tokens(claimText), evidence = new Set(tokens(quote));
  return claim.length ? claim.filter((token) => evidence.has(token)).length / claim.length : 0;
}

export function calculateRelevance(candidate: EvidenceCandidate, claimText: string, requiredTerms: string[] = []): number {
  const available = [candidate.retrievalScore, candidate.vectorScore, candidate.keywordScore].filter((score): score is number => score != null).map(clamp);
  const lexical = lexicalCoverage(claimText, candidate.quote);
  const requiredCoverage = requiredTerms.length
    ? requiredTerms.filter((term) => candidate.quote?.toLowerCase().includes(term.toLowerCase())).length / requiredTerms.length
    : lexical;
  if (!available.length) return round(0.75 * lexical + 0.25 * requiredCoverage);
  const retrieval = clamp(candidate.retrievalScore ?? lexical);
  const vector = clamp(candidate.vectorScore ?? lexical);
  const keyword = clamp(candidate.keywordScore ?? lexical);
  return round(0.35 * retrieval + 0.20 * vector + 0.20 * keyword + 0.15 * lexical + 0.10 * requiredCoverage);
}

export function calculateDirectness(candidate: EvidenceCandidate, useType: EvidenceUseType): number {
  if (candidate.userCorrectionStatus === "confirmed") return 1;
  if (!candidate.spanIds.length) return 0;
  const base: Record<EvidenceSourceKind, number> = {
    raw_transcript_span: candidate.quote ? 0.95 : 0.75,
    user_correction: 0.9,
    generated_summary_with_pointers: 0.62,
    memory_object_with_pointers: 0.62,
    graph_edge_with_pointers: 0.55,
    answer_claim_with_pointers: 0.58,
  };
  return round(base[candidate.sourceKind] + (useType === "inference" ? 0.05 : 0));
}

export function calculateSpecificity(candidate: EvidenceCandidate, claimText: string, requiredTerms: string[] = []): number {
  const quote = candidate.quote ?? "";
  const coverage = lexicalCoverage(claimText, quote);
  const claimSpecifics = tokens(claimText).filter((token) => /\d/.test(token) || token.length >= 7);
  const required = [...new Set([...requiredTerms.map((term) => term.toLowerCase()), ...claimSpecifics])];
  const specificCoverage = required.length ? required.filter((term) => quote.toLowerCase().includes(term)).length / required.length : coverage;
  const concrete = /\d|(?:\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b)/i.test(quote) ? 0.15 : 0;
  return round(0.55 * coverage + 0.45 * specificCoverage + concrete);
}

export function calculateSourceStrength(candidate: EvidenceCandidate): number {
  if (candidate.userCorrectionStatus === "rejected") return 0;
  if (candidate.userCorrectionStatus === "superseded") return 0.15;
  if (candidate.userCorrectionStatus === "confirmed") return 1;
  if (!candidate.spanIds.length) return 0;
  const strengths: Record<EvidenceSourceKind, number> = {
    raw_transcript_span: 0.95,
    user_correction: 0.85,
    generated_summary_with_pointers: 0.68,
    memory_object_with_pointers: 0.68,
    graph_edge_with_pointers: 0.65,
    answer_claim_with_pointers: 0.62,
  };
  return strengths[candidate.sourceKind];
}

export function calculateCorrectionWeight(candidate: EvidenceCandidate): number {
  if (candidate.userCorrectionStatus === "confirmed" || candidate.isUserCorrection) return 1;
  if (candidate.userCorrectionStatus === "rejected" || candidate.userCorrectionStatus === "superseded") return 0;
  return 0.5;
}

export function calculateConfidence(candidate: EvidenceCandidate): number {
  const values = [candidate.sourceConfidence, candidate.extractionConfidence].filter((value): value is number => value != null);
  return round(values.length ? values.reduce((sum, value) => sum + clamp(value), 0) / values.length : 0.5);
}

export function candidateCaps(candidate: EvidenceCandidate, useType: EvidenceUseType, components: EvidenceComponentScores, requiredTerms: string[] = [], claimText = ""): EvidenceScoreCaps {
  const reasons: string[] = [];
  let maxStrength: EvidenceStrength | undefined;
  const capWeak = (reason: string) => { if (maxStrength !== "no_evidence") maxStrength = "weak"; reasons.push(reason); };
  const capNone = (reason: string) => { maxStrength = "no_evidence"; reasons.push(reason); };
  if (candidate.userCorrectionStatus === "rejected") capNone("Rejected user correction is excluded");
  else if (candidate.userCorrectionStatus === "superseded" || candidate.metadata?.superseded === true) capWeak("Superseded evidence is not current truth");
  if (!candidate.spanIds.length && candidate.userCorrectionStatus !== "confirmed") capNone("No raw transcript span or confirmed correction");
  if (candidate.sourceKind !== "raw_transcript_span" && candidate.sourceKind !== "user_correction" && !candidate.spanIds.length) capNone("Generated-only evidence has no raw pointers");
  if (candidate.sourceKind !== "raw_transcript_span" && candidate.sourceKind !== "user_correction" && candidate.provenanceValidated !== true) {
    capNone("Generated-object evidence was not validated against a raw transcript span");
  }
  if (components.relevance < 0.35) capWeak("Low relevance cannot establish the claim");
  if (useType === "direct_fact" && components.directness < 0.5) capWeak("Direct fact lacks direct evidence");
  if (components.specificity < 0.4) capWeak("Specific claim lacks required details");
  if (candidate.vectorScore != null && candidate.keywordScore == null && candidate.retrievalScore == null && lexicalCoverage(claimText, candidate.quote) < 0.5) capWeak("Vector-only match cannot establish truth");
  const memoryStatus = candidate.metadata?.canonicalMemoryStatus;
  if (candidate.sourceKind === "memory_object_with_pointers" && memoryStatus !== undefined && memoryStatus !== "active") capWeak("Canonical memory status is not active");
  if (candidate.metadata?.memoryUsableAsEvidence === false || candidate.metadata?.duplicateOfId != null) capWeak("Memory object is not independently usable as strong evidence");
  return { maxStrength, reasons };
}

const rank: Record<EvidenceStrength, number> = { no_evidence: 0, weak: 1, mixed: 2, strong: 3, conflicting: 3 };

export function classifyEvidenceStrength(score: number, caps: EvidenceScoreCaps = { reasons: [] }): EvidenceStrength {
  let strength: EvidenceStrength = score >= 0.78 ? "strong" : score >= 0.55 ? "mixed" : score >= 0.35 ? "weak" : "no_evidence";
  if (caps.maxStrength && rank[strength] > rank[caps.maxStrength]) strength = caps.maxStrength;
  return strength;
}
