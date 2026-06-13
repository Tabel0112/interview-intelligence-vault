import type { EvidenceCandidate, EvidenceUseType } from "./types.js";
import { round } from "./rules.js";

const normalizeQuote = (quote = "") => quote.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function nearIdentical(left = "", right = ""): boolean {
  const a = new Set(normalizeQuote(left).split(" ").filter(Boolean)), b = new Set(normalizeQuote(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return false;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(a.size, b.size) >= 0.9;
}

function areDuplicates(left: EvidenceCandidate, right: EvidenceCandidate): boolean {
  if (left.evidencePointerId && left.evidencePointerId === right.evidencePointerId) return true;
  if (left.spanIds.some((id) => right.spanIds.includes(id))) return true;
  if (nearIdentical(left.quote, right.quote)) return true;
  return left.transcriptId != null && left.transcriptId === right.transcriptId
    && left.turnTimestampStartMs != null && left.turnTimestampStartMs === right.turnTimestampStartMs
    && left.turnTimestampEndMs != null && left.turnTimestampEndMs === right.turnTimestampEndMs;
}

export function deduplicateEvidenceCandidates(candidates: EvidenceCandidate[]): EvidenceCandidate[] {
  const accepted: EvidenceCandidate[] = [];
  for (const candidate of candidates) {
    if (!accepted.some((item) => areDuplicates(item, candidate))) accepted.push(candidate);
  }
  return accepted;
}

export function calculateRepetitionScore(candidate: EvidenceCandidate, allCandidates: EvidenceCandidate[], useType: EvidenceUseType = "direct_fact"): number {
  const sameStance = deduplicateEvidenceCandidates(allCandidates).filter((item) => (item.stance ?? "unknown") === (candidate.stance ?? "unknown"));
  const count = sameStance.length;
  if (useType === "pattern") return round(count >= 3 ? 1 : count === 2 ? 0.78 : 0.2);
  return round(count >= 3 ? 1 : count === 2 ? 0.75 : 0.5);
}
