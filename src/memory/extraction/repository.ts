import type { SqliteDatabase } from "../../db/connection.js";
import { NotFoundError } from "../../db/errors.js";
import { createId } from "../../db/ids.js";
import { json, now } from "../../db/utils.js";
import { stableProvenanceId } from "../../provenance/utils.js";
import type { ExtractionWindow, ExtractorKind, StoredExtractedMemoryObject, TranscriptSpanForExtraction, ValidatedMemoryCandidate } from "./types.js";

const legacyType = { topic: "topic", quote: "quote", question: "question", decision: "decision", action_item: "task", objection: "concept", advice_idea: "concept" } as const;
const legacyStatus = { active: "active", weak: "needs_review", needs_review: "needs_review" } as const;

export function createExtractionRun(db: SqliteDatabase, input: { transcriptId: string; extractorKind: ExtractorKind; extractorModel?: string | null; promptVersion: string; config?: Record<string, unknown> }): string {
  if (!db.prepare("SELECT 1 FROM transcripts WHERE id=?").get(input.transcriptId)) throw new NotFoundError(`Transcript not found: ${input.transcriptId}`);
  const id = createId("xrun_");
  db.prepare(`INSERT INTO extraction_runs(id,transcript_id,started_at,status,extractor_kind,extractor_model,prompt_version,config_json)
    VALUES (?,?,?,'running',?,?,?,?)`).run(id, input.transcriptId, now(), input.extractorKind, input.extractorModel ?? null, input.promptVersion, json(input.config));
  return id;
}
export function completeExtractionRun(db: SqliteDatabase, id: string): void { db.prepare("UPDATE extraction_runs SET status='completed',completed_at=? WHERE id=?").run(now(), id); }
export function failExtractionRun(db: SqliteDatabase, id: string, error: string): void { db.prepare("UPDATE extraction_runs SET status='failed',completed_at=?,error_message=? WHERE id=?").run(now(), error, id); }

export function loadSpansForTranscript(db: SqliteDatabase, transcriptId: string): TranscriptSpanForExtraction[] {
  return db.prepare(`SELECT s.transcript_id transcriptId,
    (SELECT tt.id FROM transcript_turns tt WHERE tt.transcript_id=s.transcript_id AND tt.start_char<=s.start_char AND tt.end_char>=s.end_char ORDER BY tt.turn_index LIMIT 1) turnId,
    s.id spanId,s.speaker_label speaker,s.start_char startOffset,s.end_char endOffset,s.text,s.start_time_ms startTimeMs,s.end_time_ms endTimeMs
    FROM transcript_spans s WHERE s.transcript_id=? ORDER BY s.ordinal`).all(transcriptId) as TranscriptSpanForExtraction[];
}

export function buildExtractionWindows(spans: TranscriptSpanForExtraction[], maxWindowChars = 4000, overlapSpans = 0): ExtractionWindow[] {
  if (!spans.length) return [];
  const windows: ExtractionWindow[] = [];
  let start = 0;
  while (start < spans.length) {
    const selected: TranscriptSpanForExtraction[] = [];
    let chars = 0, index = start;
    while (index < spans.length && (!selected.length || chars + spans[index].text.length <= maxWindowChars)) {
      selected.push(spans[index]); chars += spans[index].text.length; index++;
    }
    const transcriptId = selected[0].transcriptId;
    windows.push({
      transcriptId, windowId: stableProvenanceId("win_", `${transcriptId}:${selected.map((span) => span.spanId).join(":")}`), spans: selected,
      text: selected.map((span) => `[span_id=${span.spanId} speaker=${span.speaker ?? "unknown"}]\n${span.text}`).join("\n\n"),
    });
    if (index >= spans.length) break;
    start = Math.max(start + 1, index - Math.max(0, overlapSpans));
  }
  return windows;
}

export function storeMemoryObjectWithEvidence(db: SqliteDatabase, runId: string, promptVersion: string, candidate: ValidatedMemoryCandidate, duplicateOfId: string | null = null): StoredExtractedMemoryObject {
  const sortedSpanIds = candidate.evidenceSpans.map((span) => span.spanId).sort();
  const id = stableProvenanceId("mem_", `${candidate.transcriptId}:${candidate.type}:${candidate.normalizedText}:${sortedSpanIds.join(":")}`);
  return db.transaction(() => {
    const timestamp = now();
    db.prepare(`INSERT OR IGNORE INTO memory_objects(
      id,type,title,generated_text,normalized_text,status,confidence,created_by,created_at,updated_at,metadata_json,
      extraction_type,extraction_status,generated_by,generated_at,extraction_run_id,prompt_version,confidence_label,object_fingerprint,duplicate_of_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'needs_review',?,?,?,?,?,?,?)`).run(
      id, legacyType[candidate.type], candidate.title, candidate.body, candidate.normalizedText, legacyStatus[candidate.status],
      candidate.finalConfidence, "agent", timestamp, timestamp, json({ extraction_reason: candidate.reason ?? null }),
      candidate.type, "memory_extraction_pipeline", timestamp, runId, promptVersion, candidate.confidenceLabel, candidate.fingerprint, duplicateOfId,
    );
    for (const [index, span] of candidate.evidenceSpans.entries()) {
      const evidenceId = stableProvenanceId("mev_", `${id}:${span.spanId}:primary`);
      db.prepare(`INSERT OR IGNORE INTO memory_object_evidence(
        id,memory_id,span_id,role,evidence_score,created_at,metadata_json,transcript_id,turn_id,extraction_role
      ) VALUES (?,?,?,'source',?,?, '{}',?,?,?)`).run(evidenceId, id, span.spanId, candidate.finalConfidence, timestamp, span.transcriptId, span.turnId, index === 0 ? "primary" : "supporting");
    }
    db.prepare("UPDATE memory_objects SET extraction_status=? WHERE id=? AND user_corrected=0").run(candidate.status, id);
    return db.prepare("SELECT * FROM memory_objects WHERE id=?").get(id) as StoredExtractedMemoryObject;
  })();
}

export function markDuplicate(db: SqliteDatabase, candidate: ValidatedMemoryCandidate, existingObjectId: string, runId: string, promptVersion: string): StoredExtractedMemoryObject {
  return storeMemoryObjectWithEvidence(db, runId, promptVersion, { ...candidate, status: "needs_review" }, existingObjectId);
}

/**
 * EXACT-duplicate consolidation: attach a (new) source's evidence spans onto an EXISTING canonical memory
 * instead of creating a competing memory. Idempotent at the (memory, span) level — a span already linked to
 * the canonical is left alone, so re-running extraction adds nothing. Never deletes evidence; never changes
 * the canonical's claim/status. Returns the number of newly-attached span links.
 */
export function attachEvidenceToMemory(db: SqliteDatabase, memoryId: string, candidate: ValidatedMemoryCandidate): number {
  return db.transaction(() => {
    const timestamp = now();
    let added = 0;
    for (const span of candidate.evidenceSpans) {
      if (db.prepare("SELECT 1 FROM memory_object_evidence WHERE memory_id=? AND span_id=? LIMIT 1").get(memoryId, span.spanId)) continue;
      const evidenceId = stableProvenanceId("mev_", `${memoryId}:${span.spanId}:supporting`);
      db.prepare(`INSERT OR IGNORE INTO memory_object_evidence(
        id,memory_id,span_id,role,evidence_score,created_at,metadata_json,transcript_id,turn_id,extraction_role
      ) VALUES (?,?,?,'source',?,?, '{}',?,?, 'supporting')`).run(evidenceId, memoryId, span.spanId, candidate.finalConfidence, timestamp, span.transcriptId, span.turnId);
      added += 1;
    }
    return added;
  })();
}
