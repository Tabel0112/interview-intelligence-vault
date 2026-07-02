// Safe recalibration of PENDING review items against the CURRENT activation rules.
//
// Why this exists: activation calibration lives in the extraction pipeline, so memories persisted by an
// OLDER build keep their old needs_review/weak status (and have no stored review reason) until something
// re-evaluates them. This module re-runs the SAME trust gates the pipeline uses today over already-stored
// pending memories and:
//   - promotes ONLY items that now pass ALL gates (grounded LLM extraction, non-tentative, high calibrated
//     confidence, body strongly supported by its immutable quoted span, no conflict with active memory,
//     no duplicate, live evidence spans present, human decisions untouched);
//   - writes a SPECIFIC review reason onto every item that stays pending, so the Review queue can always
//     say why; and
//   - upgrades legacy bridged evidence pointers whose strength was stored as "unknown" (old bridging never
//     derived strength from the extraction evidence score, so high-score links rendered as WEAK and
//     flooded the Review queue).
//
// Trust boundaries: never touches raw transcript text; never promotes conflicts/duplicates/unsupported or
// tentative claims; never overrides a user decision (user_corrected=1 rows are skipped entirely); rejected/
// superseded lineages are never resurrected. Fully offline and deterministic. Bridging + live conflict
// detection for newly-promoted memories are done by the CALLER (frontend API) via the existing
// indexTranscriptForRetrieval / detectAndPersistConflictsForTranscript paths.

import type { SqliteDatabase } from "../../db/connection.js";
import { now as nowUtc } from "../../db/utils.js";
import { assessBodyQuoteSupport } from "./bodyQuoteSupport.js";
import { scoreCandidateConfidence } from "./confidence.js";
import { findDuplicateMemoryObject } from "./duplicateDetection.js";
import { GROUNDED_CONFIDENCE } from "./llmExtractor.js";
import { memoryFingerprint, normalizeMemoryText } from "./normalize.js";
import { conflictsWithActiveMemory } from "./pipeline.js";
import type { ExtractionMemoryObjectType, TranscriptSpanForExtraction, ValidatedMemoryCandidate } from "./types.js";

export interface RecalibrationResult {
  /** Legacy bridged pointers whose strength was upgraded from "unknown" to a score-derived strength. */
  pointersUpgraded: number;
  /** Pending memories promoted to active (all current gates passed). Bridging is the caller's job. */
  promoted: string[];
  /** Transcript ids owning promoted memories (callers bridge + run conflict detection per transcript). */
  transcriptsToBridge: string[];
  /** Pending memories that remain pending, with the specific reason now persisted. */
  stillPending: Array<{ memoryId: string; reason: string }>;
}

interface PendingRow {
  id: string; extraction_type: string | null; type: string; title: string | null; generated_text: string;
  extraction_status: string; metadata_json: string | null; extraction_run_id: string | null;
}

const strengthFromScore = (score: number): string => (score >= 0.78 ? "strong" : score >= 0.55 ? "mixed" : "weak");

/** Merge review_reason into metadata_json without dropping other keys (e.g. extraction_reason). */
function setReviewReason(db: SqliteDatabase, memoryId: string, reason: string | null): void {
  const row = db.prepare("SELECT metadata_json FROM memory_objects WHERE id=?").get(memoryId) as { metadata_json: string | null } | undefined;
  let metadata: Record<string, unknown> = {};
  try { metadata = row?.metadata_json ? JSON.parse(row.metadata_json) as Record<string, unknown> : {}; } catch { metadata = {}; }
  metadata.review_reason = reason;
  db.prepare("UPDATE memory_objects SET metadata_json=? WHERE id=? AND user_corrected=0").run(JSON.stringify(metadata), memoryId);
}

export function recalibratePendingMemories(db: SqliteDatabase, options: { now?: () => Date } = {}): RecalibrationResult {
  const timestamp = options.now ? options.now().toISOString() : nowUtc();
  const result: RecalibrationResult = { pointersUpgraded: 0, promoted: [], transcriptsToBridge: [], stillPending: [] };

  // --- 1. Upgrade legacy "unknown"-strength bridged pointers from their extraction evidence score. -----
  // Old bridging stored strength "unknown" (rendered WEAK + listed in Review) while carrying the real
  // score in `confidence`. The link was provenance-validated at creation; only the label was lossy.
  const unknownPointers = db.prepare(`SELECT p.evidence_pointer_id id, e.evidence_score score
    FROM evidence_pointers p
    JOIN memory_object_evidence e ON e.memory_id = p.target_id AND e.span_id = p.span_id
    WHERE p.target_type='memory_object' AND p.evidence_strength='unknown'`).all() as Array<{ id: string; score: number }>;
  for (const pointer of unknownPointers) {
    db.prepare("UPDATE evidence_pointers SET evidence_strength=? WHERE evidence_pointer_id=?")
      .run(strengthFromScore(pointer.score), pointer.id);
    result.pointersUpgraded++;
  }

  // --- 2. Re-evaluate pending generated memories against the CURRENT gates. ---------------------------
  const pending = db.prepare(`SELECT id, extraction_type, type, title, generated_text, extraction_status, metadata_json, extraction_run_id
    FROM memory_objects
    WHERE extraction_status IN ('needs_review','weak') AND user_corrected=0 AND duplicate_of_id IS NULL`).all() as PendingRow[];

  const touchedTranscripts = new Set<string>();
  for (const row of pending) {
    const keep = (reason: string) => {
      setReviewReason(db, row.id, reason);
      result.stillPending.push({ memoryId: row.id, reason });
    };

    // Duplicate-suggestion rows and human-decided rows never reach here (filtered above); rejected/
    // superseded lineages are excluded by status. Now re-run each activation gate in pipeline order.
    const spans = db.prepare(`SELECT s.transcript_id transcriptId, e.turn_id turnId, s.id spanId, s.speaker_label speaker,
        s.start_char startOffset, s.end_char endOffset, s.text, s.start_time_ms startTimeMs, s.end_time_ms endTimeMs
      FROM memory_object_evidence e JOIN transcript_spans s ON s.id = e.span_id
      WHERE e.memory_id=? ORDER BY s.ordinal, s.id`).all(row.id) as TranscriptSpanForExtraction[];
    if (!spans.length) {
      keep("No live transcript evidence remains (the source transcript may have been deleted) — this item cannot be activated; dismiss it if no longer needed.");
      continue;
    }

    const runKind = row.extraction_run_id
      ? (db.prepare("SELECT extractor_kind FROM extraction_runs WHERE id=?").get(row.extraction_run_id) as { extractor_kind: string } | undefined)?.extractor_kind
      : undefined;
    if (runKind !== "llm") {
      keep("Extracted by a non-grounded (dev/test) extractor — run \"Run AI extraction for transcripts missing it\" with a configured LLM, or approve manually after checking the cited spans.");
      continue;
    }

    const type = (row.extraction_type ?? row.type) as ExtractionMemoryObjectType;
    const title = row.title ?? "";
    const body = row.generated_text;
    // Grounded-LLM items carry the pipeline's grounding confidence (the LLM self-report was never used).
    const scored = scoreCandidateConfidence({ type, title, body, evidenceSpanIds: spans.map((span) => span.spanId), confidence: GROUNDED_CONFIDENCE }, spans);
    if (scored.status !== "active") {
      keep(scored.statusReason ?? "Calibrated extraction confidence is below the auto-activation bar.");
      continue;
    }

    const quote = spans.map((span) => span.text).join(" ");
    const support = assessBodyQuoteSupport(body, quote);
    if (support.status !== "strong") {
      keep(`Claim wording is not strongly supported by its quoted transcript span (${support.reasons.join("; ") || "insufficient overlap"}).`);
      continue;
    }

    const normalizedText = normalizeMemoryText(title, body);
    const candidate: ValidatedMemoryCandidate = {
      type, title, body, evidenceSpanIds: spans.map((span) => span.spanId), confidence: GROUNDED_CONFIDENCE,
      transcriptId: spans[0].transcriptId, normalizedText, fingerprint: memoryFingerprint(type, normalizedText),
      evidenceSpans: spans, ...scored,
    };
    const duplicate = findDuplicateMemoryObject(db, candidate);
    if (duplicate && duplicate.object.id !== row.id) {
      keep("Possible duplicate of an existing memory — review whether to merge or keep separately.");
      continue;
    }

    if (conflictsWithActiveMemory(db, candidate, row.id)) {
      keep("Conflicts with an existing active memory — both sides are preserved for review.");
      continue;
    }

    // ALL current gates passed: promote (append-only style — status flips forward, nothing is rewritten;
    // the user_corrected=0 guard keeps every human decision authoritative).
    db.prepare("UPDATE memory_objects SET extraction_status='active', status='active', updated_at=? WHERE id=? AND user_corrected=0")
      .run(timestamp, row.id);
    setReviewReason(db, row.id, null);
    result.promoted.push(row.id);
    for (const span of spans) touchedTranscripts.add(span.transcriptId);
  }

  result.transcriptsToBridge = [...touchedTranscripts].sort();
  return result;
}
