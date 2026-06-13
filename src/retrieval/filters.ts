import type { RetrievalCandidate, RetrievalFilters, RetrievalTargetType } from "./types.js";

export interface RetrievalDocumentRow {
  target_type: RetrievalTargetType; target_id: string; transcript_id: string | null; source_id: string | null;
  speaker_id: string | null; speaker_name: string | null; memory_type: string | null; memory_status: string | null;
  title: string | null; search_text: string; topic_text: string | null; created_at: string | null; updated_at: string | null;
  evidence_score: number; support_role: "supporting" | "opposing" | "mixed" | "unknown";
  evidence_pointer_ids_json: string; source_pointer_ids_json: string; content_hash: string;
}

function inList(value: string | null, list?: string[], insensitive = false): boolean {
  if (!list?.length) return true;
  if (value == null) return false;
  return insensitive ? list.some((item) => item.toLowerCase() === value.toLowerCase()) : list.includes(value);
}
function validDate(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function documentMatchesFilters(row: RetrievalDocumentRow, filters: RetrievalFilters = {}): boolean {
  if (!inList(row.transcript_id, filters.transcriptIds) || !inList(row.source_id, filters.sourceIds)
    || !inList(row.speaker_id, filters.speakerIds) || !inList(row.speaker_name, filters.speakerNames, true)
    || !inList(row.memory_type, filters.memoryTypes) || !inList(row.memory_status, filters.memoryStatuses)) return false;
  if (filters.minEvidenceScore != null && row.evidence_score < filters.minEvidenceScore) return false;
  if (filters.includeGenerated === false && row.target_type !== "transcript_span") return false;
  if (row.target_type === "memory_object" && filters.includeUnsupportedMemory !== true) {
    if (row.memory_status === "rejected" || row.memory_status === "superseded"
      || (JSON.parse(row.evidence_pointer_ids_json).length === 0 && JSON.parse(row.source_pointer_ids_json).length === 0)) return false;
  }
  const created = validDate(row.created_at ?? undefined), updated = validDate(row.updated_at ?? undefined);
  const createdAfter = validDate(filters.createdAfter), createdBefore = validDate(filters.createdBefore);
  const updatedAfter = validDate(filters.updatedAfter), updatedBefore = validDate(filters.updatedBefore);
  if (createdAfter != null && (created == null || created < createdAfter)) return false;
  if (createdBefore != null && (created == null || created > createdBefore)) return false;
  if (updatedAfter != null && (updated == null || updated < updatedAfter)) return false;
  if (updatedBefore != null && (updated == null || updated > updatedBefore)) return false;
  // Topic/entity filters are intentionally no-ops until canonical topic/entity tables exist.
  return true;
}

export function rowToCandidate(row: RetrievalDocumentRow): RetrievalCandidate {
  return {
    targetType: row.target_type, targetId: row.target_id, transcriptId: row.transcript_id ?? undefined,
    sourceId: row.source_id ?? undefined, speakerId: row.speaker_id ?? undefined, speakerName: row.speaker_name ?? undefined,
    title: row.title ?? undefined, textPreview: row.search_text.slice(0, 500), createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined, evidenceScore: row.evidence_score, finalScore: 0, matchReasons: [],
    evidencePointerIds: JSON.parse(row.evidence_pointer_ids_json), sourcePointerIds: JSON.parse(row.source_pointer_ids_json),
    supportRole: row.support_role,
  };
}
