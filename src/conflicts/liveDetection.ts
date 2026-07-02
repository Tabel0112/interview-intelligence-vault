// LIVE conflict detection for the production upload/extraction/review path.
//
// This is the missing write-side of the conflict subsystem: sqliteApi (Review), MCP get_conflicts, the
// graph builder, generated conflict notes, and Ask AI's findConflicts all READ conflict_assessments —
// this module is what populates it from the live product flow.
//
// Trust model (aligned with Policy A in retrieval/transcriptIndex.ts): a conflict assessment must cite
// REAL evidence pointers on BOTH sides, and only memory that isUsableAsEvidence (active, non-duplicate)
// is ever bridged to evidence_pointers. So statements are gathered from bridged ACTIVE memories only —
// a needs_review memory (e.g. one held back by the extraction activation gate because it opposes an
// active memory) has no pointers yet and cannot be a citable conflict side; its pair is detected at the
// moment it is APPROVED (approval bridges it first), via detectAndPersistConflictsForMemory.
//
// Reuses the existing deterministic machinery end-to-end: detectConflicts (candidate generation +
// classification) and createConflictRepository().createConflictAssessment (pointer validation on both
// sides, evidence-quality score caps, untrusted-target capping, weak-kind never active, and status
// needs_review until confidence >= 0.6 with validated evidence both sides — enforced by migration 010
// triggers). Persistence is IDEMPOTENT: assessments are deduped by normalized pair_key inside create(),
// and the assessment id itself is stable (stableProvenanceId of the pair key), so re-running detection
// never duplicates a logical pair. weak_or_ambiguous detections are not persisted (matching the
// orchestration agent and the extraction activation gate, which also ignore weak classifications).
//
// Fully offline + deterministic: SQLite reads/writes only — no LLM, no embeddings, no network.

import type { SqliteDatabase } from "../db/connection.js";
import { resolveEvidencePointer } from "../provenance/index.js";
import { detectConflicts, type ConflictStatement } from "./detector.js";
import { createConflictRepository } from "./repository.js";
import type { ConflictAssessment } from "./types.js";

interface LiveStatement extends ConflictStatement {
  /** Transcripts this memory's live evidence pointers trace to (for transcript-scoped detection). */
  transcriptIds: Set<string>;
}

/**
 * Gather conflict statements from bridged, evidence-backed ACTIVE memories: same status predicate as the
 * extraction activation gate, same pointer join as the assessment repository expects. Pointers that no
 * longer resolve are skipped (a broken pointer never enters a new conflict record); a memory with no
 * resolving pointer is not a citable side and is dropped.
 */
function gatherEvidenceBackedStatements(db: SqliteDatabase): LiveStatement[] {
  const rows = db.prepare(`SELECT m.id, m.title, m.generated_text, m.created_at, e.evidence_pointer_id, e.transcript_id
    FROM memory_objects m
    JOIN evidence_pointers e ON e.target_type IN ('memory_object','claim','summary') AND e.target_id=m.id
    WHERE m.duplicate_of_id IS NULL
      AND (m.extraction_status='active' OR (m.extraction_status IS NULL AND m.status='active'))
    ORDER BY m.id, e.evidence_pointer_id`).all() as Array<{
      id: string; title: string | null; generated_text: string; created_at: string; evidence_pointer_id: string; transcript_id: string | null;
    }>;
  const byMemory = new Map<string, LiveStatement>();
  for (const row of rows) {
    if (!resolveEvidencePointer(db, row.evidence_pointer_id).ok) continue;
    let statement = byMemory.get(row.id);
    if (!statement) {
      statement = {
        targetId: row.id, targetType: "memory_object",
        // Same text shape the live activation gate compares (title + body), so the persisted pair
        // classifies consistently with the gate that may have routed one side to review.
        text: `${row.title ?? ""}. ${row.generated_text}`,
        evidenceIds: [], timestamp: row.created_at, transcriptIds: new Set(),
      };
      byMemory.set(row.id, statement);
    }
    statement.evidenceIds.push(row.evidence_pointer_id);
    if (row.transcript_id) statement.transcriptIds.add(row.transcript_id);
  }
  return [...byMemory.values()].filter((statement) => statement.evidenceIds.length > 0);
}

/** Detect + persist non-weak conflicts among the statements, keeping only pairs the caller cares about. */
function persistDetected(
  db: SqliteDatabase,
  statements: LiveStatement[],
  touches: (leftTargetId: string, rightTargetId: string) => boolean,
  options: { now?: () => Date },
): ConflictAssessment[] {
  if (statements.length < 2) return [];
  const repo = createConflictRepository(db, { now: options.now });
  const persisted: ConflictAssessment[] = [];
  for (const detected of detectConflicts(statements)) {
    // weak_or_ambiguous is never persisted (consistent with the orchestration agent + activation gate);
    // the repository re-classifies with real validated evidence and applies all score caps itself.
    if (detected.classification.kind === "weak_or_ambiguous") continue;
    if (!touches(detected.candidate.leftTargetId, detected.candidate.rightTargetId)) continue;
    try {
      persisted.push(repo.createConflictAssessment({ candidate: detected.candidate }));
    } catch {
      // A side whose pointer broke between gathering and persisting is skipped — detection is
      // best-effort and must never fail the surrounding upload/extraction/review operation.
    }
  }
  return persisted;
}

/**
 * Live hook for upload/extraction: after a transcript's memories are extracted and its usable memory is
 * bridged, compare this transcript's evidence-backed memories against ALL other evidence-backed active
 * memories (cross-transcript included) and persist any non-weak conflicts touching this transcript.
 */
export function detectAndPersistConflictsForTranscript(
  db: SqliteDatabase,
  transcriptId: string,
  options: { now?: () => Date } = {},
): ConflictAssessment[] {
  const statements = gatherEvidenceBackedStatements(db);
  const inTranscript = new Set(statements.filter((s) => s.transcriptIds.has(transcriptId)).map((s) => s.targetId));
  if (!inTranscript.size) return [];
  return persistDetected(db, statements, (left, right) => inTranscript.has(left) || inTranscript.has(right), options);
}

/**
 * Live hook for review approval: the approved memory has just been bridged to evidence pointers, so it is
 * now a citable conflict side — compare it against every other evidence-backed active memory and persist
 * any non-weak conflicts. (Before approval the pair could not exist: Policy A gives needs_review memory
 * no pointers, and a conflict record must cite both sides.)
 */
export function detectAndPersistConflictsForMemory(
  db: SqliteDatabase,
  memoryId: string,
  options: { now?: () => Date } = {},
): ConflictAssessment[] {
  const statements = gatherEvidenceBackedStatements(db);
  if (!statements.some((s) => s.targetId === memoryId)) return [];
  return persistDetected(db, statements, (left, right) => left === memoryId || right === memoryId, options);
}
