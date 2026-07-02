// Post-import retrieval wiring: bridge USABLE extracted memory into provenance-validated
// evidence_pointers, then run LOCAL keyword indexing. Both steps are idempotent and fully offline.
//
// Trust model (Policy A): only memory that isUsableAsEvidence (active/strong, non-duplicate) is
// bridged into Ask AI evidence. needs_review LLM memory stays in the review queue and does NOT become
// Ask AI evidence until promoted. Every pointer is created via linkMemoryObjectToSpan ->
// createSourcePointerForSpan, which re-validates the span against the immutable raw transcript text
// (hash check) — so a pointer always traces to a real span and never invents evidence or mutates raw
// text. No external embedding call is made here (rebuildRetrievalIndex is run with no provider, so it
// only builds the local keyword index — no vectors, no network).

import type { SqliteDatabase } from "../db/connection.js";
import { createMemoryObjectsRepo } from "../db/repositories/memoryObjectsRepo.js";
import { isUsableAsEvidence } from "../memory/index.js";
import { linkMemoryObjectToSpan, type EvidenceStrength, type ProvenanceEvidenceRole } from "../provenance/index.js";
import { rebuildRetrievalIndex } from "./indexer.js";

const mapEvidenceRole = (role: string): ProvenanceEvidenceRole =>
  role === "contradicts" ? "opposition" : role === "qualifies" ? "conditional" : role === "context" ? "neutral" : "support";

/**
 * Derive the provenance strength of a bridged memory→span link from its calibrated extraction evidence
 * score, using the SAME score bands the evidence-scoring layer uses (see evidence/rules.ts). Bridged
 * pointers previously defaulted to "unknown", which the UI renders as WEAK and the Review queue lists as
 * a weak-evidence item — so every high-score auto-activated memory wrongly produced a Review entry. The
 * floor is "weak" (never "unknown"): a provenance-validated extraction link HAS been assessed, just weakly.
 */
export const strengthFromEvidenceScore = (score: number): EvidenceStrength =>
  score >= 0.78 ? "strong" : score >= 0.55 ? "mixed" : "weak";

export interface TranscriptIndexResult {
  transcriptId: string;
  evidencePointersBridged: number;
  indexed: number;
  skipped: number;
}

/**
 * After import + extraction, make a transcript's spans and its USABLE extracted memory discoverable
 * by keyword retrieval / Ask AI. Idempotent: source/evidence pointers use stable ids + INSERT OR
 * IGNORE, and rebuildRetrievalIndex skips unchanged documents by content hash.
 */
export async function indexTranscriptForRetrieval(db: SqliteDatabase, transcriptId: string): Promise<TranscriptIndexResult> {
  const repo = createMemoryObjectsRepo(db);
  const memoryIds = db.prepare("SELECT DISTINCT memory_id FROM memory_object_evidence WHERE transcript_id=?").all(transcriptId) as Array<{ memory_id: string }>;
  let evidencePointersBridged = 0;
  for (const { memory_id } of memoryIds) {
    const canonical = repo.getCanonicalMemoryObject(memory_id);
    if (!canonical || !isUsableAsEvidence(canonical)) continue; // Policy A: needs_review/weak/duplicate not bridged
    const rows = db.prepare("SELECT span_id, role, evidence_score, transcript_id FROM memory_object_evidence WHERE memory_id=? AND transcript_id=?")
      .all(memory_id, transcriptId) as Array<{ span_id: string; role: string; evidence_score: number; transcript_id: string }>;
    for (const row of rows) {
      linkMemoryObjectToSpan(db, {
        memoryObjectId: memory_id, transcriptId: row.transcript_id, spanId: row.span_id,
        evidenceRole: mapEvidenceRole(row.role), confidence: row.evidence_score,
        evidenceStrength: strengthFromEvidenceScore(row.evidence_score),
      });
      evidencePointersBridged++;
    }
  }
  // LOCAL keyword indexing only — no embedding provider => no vectors and no external network call.
  const index = await rebuildRetrievalIndex(db);
  return { transcriptId, evidencePointersBridged, indexed: index.indexed, skipped: index.skipped };
}
