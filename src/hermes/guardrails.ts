import { ValidationError } from "../db/errors.js";

type EvidenceLike = { evidencePointerId?: string; evidenceScore?: number; finalScore?: number; stance?: string };
type AnswerLike = { answerMarkdown?: string; evidenceConfidence?: string; evidence?: EvidenceLike[]; conflicts?: unknown[]; claims?: unknown[] };
const scores = (items: EvidenceLike[]) => new Map(items.map((item) => [item.evidencePointerId, item.evidenceScore ?? item.finalScore]));

export function assertHermesDidNotModifyEvidenceScores(before: EvidenceLike[], after: EvidenceLike[]): void {
  const expected = scores(before);
  for (const item of after) if (expected.get(item.evidencePointerId) !== (item.evidenceScore ?? item.finalScore)) throw new ValidationError("Hermes cannot modify evidence scores");
}
export function assertHermesDidNotCreateEvidencePointers(before: EvidenceLike[], after: EvidenceLike[]): void {
  const ids = new Set(before.map((item) => item.evidencePointerId));
  if (after.some((item) => !ids.has(item.evidencePointerId))) throw new ValidationError("Hermes cannot create evidence pointers");
}
export function assertHermesDidNotRemoveRequiredWarnings(before: AnswerLike, after: AnswerLike): void {
  const required = ["weak", "conflict", "enough transcript-backed evidence"];
  for (const marker of required) if (before.answerMarkdown?.toLowerCase().includes(marker) && !after.answerMarkdown?.toLowerCase().includes(marker)) throw new ValidationError("Hermes cannot remove required evidence warnings");
}
export function assertHermesDidNotSuppressConflicts(before: AnswerLike, after: AnswerLike): void {
  const oppositionBefore = before.evidence?.filter((item) => item.stance === "opposes").length ?? 0;
  const oppositionAfter = after.evidence?.filter((item) => item.stance === "opposes").length ?? 0;
  if ((before.conflicts?.length ?? 0) > (after.conflicts?.length ?? 0) || oppositionBefore > oppositionAfter) throw new ValidationError("Hermes cannot suppress conflicts or opposing evidence");
}
export function assertHermesOnlyChangedPresentationOrAllowedRanking(before: AnswerLike, after: AnswerLike): void {
  assertHermesDidNotModifyEvidenceScores(before.evidence ?? [], after.evidence ?? []);
  assertHermesDidNotCreateEvidencePointers(before.evidence ?? [], after.evidence ?? []);
  assertHermesDidNotRemoveRequiredWarnings(before, after);
  assertHermesDidNotSuppressConflicts(before, after);
  const beforeIds = [...new Set((before.evidence ?? []).map((item) => item.evidencePointerId))].sort();
  const afterIds = [...new Set((after.evidence ?? []).map((item) => item.evidencePointerId))].sort();
  if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds)) throw new ValidationError("Hermes cannot add or remove selected evidence");
  if (before.evidenceConfidence !== after.evidenceConfidence || JSON.stringify(before.claims) !== JSON.stringify(after.claims)) throw new ValidationError("Hermes cannot alter truth-bearing answer fields");
}
