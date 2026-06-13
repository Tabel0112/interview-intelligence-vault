import type { ConfidenceLabel, ExtractedMemoryCandidate, ExtractionMemoryObjectStatus, TranscriptSpanForExtraction } from "./types.js";

const vague = new Set(["ai", "transcript", "discussion", "project", "thing", "something"]);

export function scoreCandidateConfidence(candidate: ExtractedMemoryCandidate, spans: TranscriptSpanForExtraction[]): {
  finalConfidence: number; confidenceLabel: ConfidenceLabel; status: Extract<ExtractionMemoryObjectStatus, "active" | "weak" | "needs_review">;
} {
  const extractor = Math.max(0, Math.min(1, candidate.confidence));
  const coverage = Math.min(1, 0.55 + Math.max(0, spans.length - 1) * 0.2);
  const normalizedTitle = candidate.title.toLowerCase().trim();
  const specificity = vague.has(normalizedTitle) || normalizedTitle.split(/\s+/).length < 2 ? 0.25 : Math.min(1, 0.55 + normalizedTitle.split(/\s+/).length * 0.06);
  const typeRule = candidate.type === "quote" ? 1 : candidate.type === "decision" || candidate.type === "action_item" ? 0.9 : 0.8;
  const finalConfidence = Math.max(0, Math.min(1, 0.45 * extractor + 0.25 * coverage + 0.15 * specificity + 0.15 * typeRule));
  const confidenceLabel: ConfidenceLabel = finalConfidence >= 0.8 ? "high" : finalConfidence >= 0.6 ? "medium" : "low";
  const status = confidenceLabel === "low" ? (candidate.type === "decision" || candidate.type === "action_item" ? "needs_review" : "weak") : candidate.type === "decision" || candidate.type === "action_item" ? (confidenceLabel === "high" ? "active" : "needs_review") : "active";
  return { finalConfidence, confidenceLabel, status };
}
