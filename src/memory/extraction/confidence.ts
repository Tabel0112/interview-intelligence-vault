import type { ConfidenceLabel, ExtractedMemoryCandidate, ExtractionMemoryObjectStatus, TranscriptSpanForExtraction } from "./types.js";

const vague = new Set(["ai", "transcript", "discussion", "project", "thing", "something"]);

// Hedged / tentative language: the statement is being floated, not settled. Such memories must go to
// review even when otherwise well-grounded — a proposal is not yet a decision/fact. Prescriptive
// "should" / "must" / "recommend" are deliberately NOT tentative (they are direct guidance, e.g.
// "Ask AI should use scored evidence"), so they are excluded from this pattern.
const TENTATIVE = /\b(maybe|perhaps|possibly|probably|might|tentative\w*|i think|i guess|i'?m not sure|not sure|unsure|consider(?:ing)?|may want|proposed|proposal|instead\?)\b/i;

/** True when any of the given texts uses hedged/tentative phrasing (proposal, not a settled statement). */
export function isTentativeStatement(...texts: Array<string | null | undefined>): boolean {
  return texts.some((text) => typeof text === "string" && TENTATIVE.test(text));
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Calibrate an extracted candidate's confidence and pick its extraction status.
 *
 * Confidence blends the extractor's own signal with deterministic grounding signals (span coverage,
 * title specificity, statement type). A direct, specific, well-grounded statement from a single span
 * is treated as strong — single-span citations are the norm for transcript decisions, so they are NOT
 * penalized into review.
 *
 * Status policy (the auto-active gate): a candidate becomes `active` ONLY when it is non-tentative and
 * scores `high`. Tentative phrasing or `medium` confidence routes to `needs_review`; `low` confidence
 * routes to `needs_review` for decisions/tasks and `weak` otherwise. Conflict-with-an-active-memory and
 * near-duplicate gating happen in the pipeline (this function never sees other memories).
 */
export function scoreCandidateConfidence(candidate: ExtractedMemoryCandidate, spans: TranscriptSpanForExtraction[]): {
  finalConfidence: number; confidenceLabel: ConfidenceLabel; status: Extract<ExtractionMemoryObjectStatus, "active" | "weak" | "needs_review">;
  statusReason?: string;
} {
  const extractor = clamp(candidate.confidence);
  // Single span is the common, legitimate case for a transcript decision -> floor 0.8 (was 0.55), so a
  // clear one-span statement is not structurally capped below the active threshold.
  const coverage = Math.min(1, 0.8 + Math.max(0, spans.length - 1) * 0.1);
  const normalizedTitle = candidate.title.toLowerCase().trim();
  const titleWords = normalizedTitle.split(/\s+/).filter(Boolean).length;
  // Vague/one-word titles are penalized hard; any specific multi-word title starts near full credit. Title
  // length is a weak grounding signal — the body-quote support gate (pipeline) carries the real safety load.
  const specificity = vague.has(normalizedTitle) || titleWords < 2 ? 0.3 : Math.min(1, 0.7 + titleWords * 0.06);
  // Type shades confidence slightly, but a grounded question/topic is NOT less grounded than a decision —
  // review routing for genuinely uncertain content comes from tentative phrasing, low extractor confidence,
  // and the pipeline's body-support/conflict/duplicate gates, not from the object type alone.
  const typeRule = candidate.type === "quote" ? 1
    : candidate.type === "decision" || candidate.type === "action_item" ? 0.95
      : 0.9;
  const finalConfidence = clamp(0.5 * extractor + 0.2 * coverage + 0.15 * specificity + 0.15 * typeRule);
  const confidenceLabel: ConfidenceLabel = finalConfidence >= 0.85 ? "high" : finalConfidence >= 0.6 ? "medium" : "low";
  const tentative = isTentativeStatement(candidate.title, candidate.body);
  const decisionLike = candidate.type === "decision" || candidate.type === "action_item";
  const status = tentative ? "needs_review"
    : confidenceLabel === "high" ? "active"
      : confidenceLabel === "medium" ? "needs_review"
        : decisionLike ? "needs_review" : "weak";
  // Human-readable routing reason, persisted so the Review queue can say WHY an item needs attention.
  const statusReason = status === "active" ? undefined
    : tentative ? "Tentative/hedged phrasing — this reads as a proposal or possibility, not a settled statement."
      : confidenceLabel === "medium" ? "Medium extraction confidence — grounding signals are not strong enough to auto-activate."
        : "Low extraction confidence.";
  return statusReason === undefined
    ? { finalConfidence, confidenceLabel, status }
    : { finalConfidence, confidenceLabel, status, statusReason };
}
