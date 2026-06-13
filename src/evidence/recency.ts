import type { EvidenceCandidate, EvidenceUseType } from "./types.js";
import { round } from "./rules.js";

export function calculateRecencyScore(candidate: EvidenceCandidate, now: string | undefined, useType: EvidenceUseType): number {
  const date = candidate.transcriptRecordedAt ?? candidate.createdAt;
  if (!date || !now) return 0.5;
  const nowMs = Date.parse(now), dateMs = Date.parse(date);
  if (!Number.isFinite(nowMs) || !Number.isFinite(dateMs)) return 0.5;
  const ageDays = Math.max(0, (nowMs - dateMs) / 86_400_000);
  let score = ageDays <= 7 ? 1 : ageDays <= 30 ? 0.8 : ageDays <= 180 ? 0.6 : 0.4;
  if (useType === "direct_fact" || useType === "inference") score = 0.5 + score * 0.5;
  return round(score);
}
