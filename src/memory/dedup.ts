import type { SqliteDatabase } from "../db/connection.js";
import { now } from "../db/utils.js";
import { linkMemoryObjectToSpan } from "../provenance/index.js";
import { stableProvenanceId } from "../provenance/utils.js";

export interface MemoryDedupeResult {
  /** Groups of exact duplicates where at least one duplicate was superseded. */
  canonicalGroups: number;
  /** Duplicate memories marked duplicate_of canonical + superseded. */
  duplicatesSuperseded: number;
  /** New memory<->span links added to canonical memories. */
  evidenceLinksConsolidated: number;
}

interface ActiveMemoryRow { id: string; object_fingerprint: string; type: string; user_corrected: number; created_at: string }
interface EvidenceRow { span_id: string; transcript_id: string | null; turn_id: string | null; evidence_score: number }

/**
 * Deterministic, idempotent repair pass for canonical memory deduplication.
 *
 * Conservative by design — it only merges EXACT duplicates: active, non-duplicate memories that share the
 * SAME `(type, object_fingerprint)`, i.e. identical type + identical normalized text. Because normalization
 * never strips negation, "use SQLite" and "not use SQLite" have different fingerprints and are never merged;
 * near/fuzzy wording differences have different fingerprints too and are left for review (they are not
 * touched here). For each exact-duplicate group it:
 *   - chooses a canonical deterministically: user_corrected first, then earliest created_at, then lowest id;
 *   - consolidates the other members' evidence (memory_object_evidence + provenance pointers) onto the
 *     canonical (idempotent inserts; nothing deleted);
 *   - marks the others `duplicate_of_id = canonical` and `status = superseded`.
 *
 * A user-corrected non-canonical member is left untouched (never silently demoted) — it stays active for
 * human review. Running the pass again makes zero additional changes (superseded/duplicate rows are excluded
 * from the active-group scan). Raw transcripts, evidence spans, source pointers, and corrections are never
 * deleted. SQLite remains the source of truth; generated Markdown is never read here.
 */
export function dedupeCanonicalMemories(db: SqliteDatabase, options: { now?: () => string } = {}): MemoryDedupeResult {
  const ts = options.now ?? now;
  const result: MemoryDedupeResult = { canonicalGroups: 0, duplicatesSuperseded: 0, evidenceLinksConsolidated: 0 };
  return db.transaction(() => {
    const rows = db.prepare(`SELECT id, object_fingerprint, COALESCE(extraction_type,type) AS type, user_corrected, created_at
      FROM memory_objects
      WHERE object_fingerprint IS NOT NULL AND duplicate_of_id IS NULL
        AND status NOT IN ('superseded','rejected')
        AND (extraction_status IS NULL OR extraction_status NOT IN ('superseded','rejected'))`).all() as ActiveMemoryRow[];

    const groups = new Map<string, ActiveMemoryRow[]>();
    for (const row of rows) {
      const key = `${row.type}|${row.object_fingerprint}`;
      const list = groups.get(key);
      if (list) list.push(row); else groups.set(key, [row]);
    }

    for (const members of groups.values()) {
      if (members.length < 2) continue;
      // Canonical selection: user-corrected first, then earliest created_at, then lowest id.
      const sorted = [...members].sort((a, b) =>
        (b.user_corrected - a.user_corrected) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
      const canonical = sorted[0];
      let changed = false;

      for (const dup of sorted.slice(1)) {
        // Never silently touch a user-corrected memory — leave it active for explicit human review.
        if (dup.user_corrected === 1) continue;

        const evidence = db.prepare("SELECT span_id, transcript_id, turn_id, evidence_score FROM memory_object_evidence WHERE memory_id=?").all(dup.id) as EvidenceRow[];
        for (const e of evidence) {
          if (!db.prepare("SELECT 1 FROM memory_object_evidence WHERE memory_id=? AND span_id=? LIMIT 1").get(canonical.id, e.span_id)) {
            const newId = stableProvenanceId("mev_", `${canonical.id}:${e.span_id}:supporting`);
            db.prepare(`INSERT OR IGNORE INTO memory_object_evidence(
              id,memory_id,span_id,role,evidence_score,created_at,metadata_json,transcript_id,turn_id,extraction_role
            ) VALUES (?,?,?,'source',?,?, '{}',?,?, 'supporting')`).run(newId, canonical.id, e.span_id, e.evidence_score, ts(), e.transcript_id, e.turn_id);
            result.evidenceLinksConsolidated += 1;
          }
          // Ensure the canonical has a provenance pointer for this span (idempotent stable id). Skip spans
          // whose source pointer is broken rather than failing the whole pass.
          if (e.transcript_id) {
            try { linkMemoryObjectToSpan(db, { memoryObjectId: canonical.id, transcriptId: e.transcript_id, spanId: e.span_id }); } catch { /* broken source pointer: leave for review */ }
          }
        }

        const updated = db.prepare(`UPDATE memory_objects
          SET duplicate_of_id=?, status='superseded',
              extraction_status=CASE WHEN extraction_status IS NULL THEN NULL ELSE 'superseded' END,
              updated_at=?
          WHERE id=? AND user_corrected=0`).run(canonical.id, ts(), dup.id);
        if (updated.changes > 0) { result.duplicatesSuperseded += updated.changes; changed = true; }
      }

      if (changed) result.canonicalGroups += 1;
    }
    return result;
  })();
}
