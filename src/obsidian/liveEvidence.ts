import type { SqliteDatabase } from "../db/connection.js";

// A node belongs in the NORMAL generated graph (and gets a generated note) only if it has at least one
// GRAPH-LINKABLE live evidence edge — i.e. a provenance evidence_pointer. The native Obsidian graph is
// built from the wikilinks in the generated Markdown, and only an evidence_pointer produces an evidence
// citation (a wikilink to an Evidence note that in turn links Span -> Transcript). So a pointer is exactly
// what makes a memory/answer/conflict node CONNECTED rather than a disconnected island.
//
// A memory backed only by legacy `memory_object_evidence` (e.g. an unbridged needs_review/weak memory, or
// any row that lost its pointer) has no graph-linkable edge: it would float disconnected. We therefore
// EXCLUDE it from the normal graph (Option B) rather than fabricate a legacy edge that does not correspond
// to a real provenance pointer — that keeps the normal graph = bridged, trustworthy provenance, consistent
// with Policy A (only usable/active memory is bridged). Such rows are NOT deleted: they remain in SQLite
// (the source of truth) and stay visible in Review / detail views with warnings. This only filters the
// disposable view; it never reads generated Markdown back.

/**
 * WHERE-clause fragment that correlates on the `memory_objects` table (query it without an alias, i.e.
 * `... FROM memory_objects WHERE ...`). True when the memory has at least one provenance evidence pointer
 * (the only memory evidence that is graph-linkable).
 */
export const MEMORY_HAS_GRAPH_EVIDENCE_SQL = `EXISTS (
  SELECT 1 FROM evidence_pointers ep WHERE ep.target_type IN ('memory_object','claim','summary') AND ep.target_id = memory_objects.id
)`;

export function memoryHasGraphEvidence(db: SqliteDatabase, memoryId: string): boolean {
  return db.prepare(`SELECT 1 FROM evidence_pointers
    WHERE target_type IN ('memory_object','claim','summary') AND target_id = ? LIMIT 1`).get(memoryId) != null;
}

/** True when the answer (or any of its claims) still has a graph-linkable evidence pointer. */
export function answerHasGraphEvidence(db: SqliteDatabase, answerId: string): boolean {
  return db.prepare(`SELECT 1 FROM evidence_pointers
    WHERE (target_type = 'answer' AND target_id = ?)
       OR (target_type = 'answer_claim' AND target_id IN (SELECT answer_claim_id FROM answer_claims WHERE answer_id = ?))
    LIMIT 1`).get(answerId, answerId) != null;
}

/** True when the conflict still has at least one evidence link whose evidence pointer resolves (graph-linkable). */
export function conflictHasGraphEvidence(db: SqliteDatabase, conflictId: string): boolean {
  return db.prepare(`SELECT 1 FROM conflict_evidence_links l
    JOIN evidence_pointers p ON p.evidence_pointer_id = l.evidence_pointer_id
    WHERE l.conflict_assessment_id = ? LIMIT 1`).get(conflictId) != null;
}
