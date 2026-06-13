import type { RetrievalCandidate } from "./types.js";

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function recencyScore(timestamp?: string, now?: string): number {
  if (!timestamp) return 0.5;
  const time = Date.parse(timestamp), current = now == null ? Date.now() : Date.parse(now);
  if (!Number.isFinite(time) || !Number.isFinite(current)) return 0.5;
  const ageDays = Math.max(0, (current - time) / 86_400_000);
  return clamp(1 / (1 + ageDays / 365));
}

export function rankCandidate(candidate: RetrievalCandidate, vectorAvailable: boolean, recencyBoost = false, now?: string): RetrievalCandidate {
  const vector = candidate.vectorScore ?? 0, keyword = candidate.keywordScore ?? 0;
  const evidence = candidate.evidenceScore ?? 0.5, metadata = candidate.metadataScore ?? 0.5;
  const recency = recencyBoost ? recencyScore(candidate.updatedAt ?? candidate.createdAt, now) : 0.5;
  const score = vectorAvailable
    ? 0.4 * vector + 0.3 * keyword + 0.15 * evidence + 0.1 * metadata + 0.05 * recency
    : 0.55 * keyword + 0.25 * evidence + 0.15 * metadata + 0.05 * recency;
  return { ...candidate, recencyScore: recency, finalScore: clamp(score) };
}

export function mergeCandidates(candidates: RetrievalCandidate[]): RetrievalCandidate[] {
  const merged = new Map<string, RetrievalCandidate>();
  for (const item of candidates) {
    const key = `${item.targetType}:${item.targetId}`;
    const existing = merged.get(key);
    if (!existing) { merged.set(key, item); continue; }
    merged.set(key, {
      ...existing,
      keywordScore: Math.max(existing.keywordScore ?? 0, item.keywordScore ?? 0),
      vectorScore: Math.max(existing.vectorScore ?? 0, item.vectorScore ?? 0),
      evidenceScore: Math.max(existing.evidenceScore ?? 0, item.evidenceScore ?? 0),
      matchReasons: [...new Set([...existing.matchReasons, ...item.matchReasons])],
      evidencePointerIds: [...new Set([...existing.evidencePointerIds, ...item.evidencePointerIds])],
      sourcePointerIds: [...new Set([...existing.sourcePointerIds, ...item.sourcePointerIds])],
    });
  }
  return [...merged.values()];
}

export function dedupeUnderlyingEvidence(candidates: RetrievalCandidate[]): RetrievalCandidate[] {
  const priority = { transcript_span: 3, evidence_pointer: 2, memory_object: 1 };
  const kept = new Map<string, RetrievalCandidate>();
  for (const candidate of candidates.sort((a, b) => b.finalScore - a.finalScore)) {
    const key = candidate.sourcePointerIds[0] ?? `${candidate.targetType}:${candidate.targetId}`;
    const existing = kept.get(key);
    if (!existing || priority[candidate.targetType] > priority[existing.targetType]) {
      kept.set(key, existing ? {
        ...candidate,
        evidencePointerIds: [...new Set([...candidate.evidencePointerIds, ...existing.evidencePointerIds])],
        sourcePointerIds: [...new Set([...candidate.sourcePointerIds, ...existing.sourcePointerIds])],
        matchReasons: [...new Set([...candidate.matchReasons, ...existing.matchReasons])],
      } : candidate);
    }
  }
  return [...kept.values()];
}
