import type { SqliteDatabase } from "../../db/connection.js";
import { tokenJaccard } from "./normalize.js";
import type { StoredExtractedMemoryObject, ValidatedMemoryCandidate } from "./types.js";

export interface DuplicateMatch { object: StoredExtractedMemoryObject; kind: "exact" | "near"; evidenceOverlaps: boolean; }

export function findDuplicateMemoryObject(db: SqliteDatabase, candidate: ValidatedMemoryCandidate): DuplicateMatch | null {
  const spanIds = new Set(candidate.evidenceSpans.map((span) => span.spanId));
  const overlaps = (id: string) => (db.prepare("SELECT span_id FROM memory_object_evidence WHERE memory_id=?").all(id) as Array<{ span_id: string }>).some((row) => spanIds.has(row.span_id));
  const exacts = db.prepare(`SELECT * FROM memory_objects WHERE object_fingerprint=? ORDER BY user_corrected DESC, created_at`)
    .all(candidate.fingerprint) as StoredExtractedMemoryObject[];
  const exact = exacts.find((object) => overlaps(object.id)) ?? exacts[0];
  if (exact) return { object: exact, kind: "exact", evidenceOverlaps: overlaps(exact.id) };
  const candidates = db.prepare(`SELECT * FROM memory_objects WHERE extraction_type=? AND normalized_text IS NOT NULL ORDER BY user_corrected DESC, created_at`)
    .all(candidate.type) as StoredExtractedMemoryObject[];
  for (const existing of candidates) {
    if (tokenJaccard(candidate.normalizedText, existing.normalized_text) >= 0.82) return { object: existing, kind: "near", evidenceOverlaps: overlaps(existing.id) };
  }
  return null;
}
