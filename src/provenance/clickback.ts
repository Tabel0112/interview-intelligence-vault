import type { SqliteDatabase } from "../db/connection.js";
import { getEvidenceForTarget, resolveEvidencePointer } from "./evidencePointers.js";
import { parseSourcePointerUri } from "./pointerFormat.js";
import { resolveSourcePointer } from "./sourcePointers.js";

export type ClickbackResolution =
  | { ok: false; reason: string; uri: string }
  | ({ ok: true } & Record<string, unknown>);

export function resolveClickback(db: SqliteDatabase, uri: string): ClickbackResolution {
  if (uri.startsWith("mv://source/")) {
    let parsed: { transcriptId: string; spanId: string };
    try { parsed = parseSourcePointerUri(uri); } catch { return { ok: false, reason: "malformed_uri", uri }; }
    const resolved = resolveSourcePointer(db, uri);
    if (!resolved.ok) return { ok: false, reason: resolved.reason, uri };
    const span = db.prepare("SELECT speaker_label FROM transcript_spans WHERE id=?").get(parsed.spanId) as { speaker_label: string | null };
    return { ok: true, kind: "source_span", transcriptId: parsed.transcriptId, spanId: parsed.spanId, transcriptTitle: resolved.transcriptTitle, speaker: span.speaker_label, startMs: resolved.pointer.start_ms, endMs: resolved.pointer.end_ms, spanText: resolved.spanText, rawStartOffset: resolved.pointer.raw_start_offset, rawEndOffset: resolved.pointer.raw_end_offset };
  }
  if (uri.startsWith("mv://evidence/")) {
    const resolved = resolveEvidencePointer(db, uri);
    if (!resolved.ok) return { ok: false, reason: resolved.reason, uri };
    const item = resolved.evidence;
    return { ok: true, kind: "evidence", evidencePointerId: item.evidence_pointer_id, targetType: item.target_type, targetId: item.target_id, evidenceRole: item.evidence_role, evidenceStrength: item.evidence_strength, confidence: item.confidence, spanText: resolved.spanText, sourceUri: item.source_pointer_uri };
  }
  const patterns: Array<{ pattern: RegExp; kind: string; table: string; idColumn: string; evidenceType: "claim" | "answer" | "graph_node" | "graph_edge" }> = [
    { pattern: /^mv:\/\/claim\/([^/]+)$/, kind: "claim", table: "memory_objects", idColumn: "id", evidenceType: "claim" },
    { pattern: /^mv:\/\/answer\/([^/]+)$/, kind: "answer", table: "ai_answers", idColumn: "id", evidenceType: "answer" },
    { pattern: /^mv:\/\/graph\/node\/([^/]+)$/, kind: "graph_node", table: "graph_nodes", idColumn: "id", evidenceType: "graph_node" },
    { pattern: /^mv:\/\/graph\/edge\/([^/]+)$/, kind: "graph_edge", table: "graph_edges", idColumn: "id", evidenceType: "graph_edge" },
  ];
  for (const candidate of patterns) {
    const match = uri.match(candidate.pattern);
    if (!match) continue;
    const id = decodeURIComponent(match[1]);
    const object = db.prepare(`SELECT * FROM ${candidate.table} WHERE ${candidate.idColumn}=?`).get(id) as Record<string, unknown> | undefined;
    if (!object) return { ok: false, reason: "not_found", uri };
    return { ok: true, kind: candidate.kind, object, evidence: getEvidenceForTarget(db, { targetType: candidate.evidenceType, targetId: id }) };
  }
  return { ok: false, reason: "unsupported_uri", uri };
}
