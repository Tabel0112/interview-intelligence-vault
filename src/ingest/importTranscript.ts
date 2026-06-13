import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../db/connection.js";
import { ValidationError } from "../db/errors.js";
import { contentHash } from "../db/ids.js";
import { json, now } from "../db/utils.js";
import { createSpansFromTurns } from "./createTranscriptSpans.js";
import { detectTranscriptFormat } from "./detectTranscriptFormat.js";
import { computeRawSha256 } from "./hash.js";
import { parseSpeakerTurns } from "./parseSpeakerTurns.js";
import type { ParsedSpan, ParsedTurn, TranscriptImportInput, TranscriptImportResult, TranscriptImportSourceType } from "./types.js";

function stableId(prefix: string, value: string, length = 24): string {
  return `${prefix}${createHash("sha256").update(value).digest("hex").slice(0, length)}`;
}

function sourceTypeForDatabase(sourceType: TranscriptImportSourceType): "imported_file" | "pasted_text" | "external_reference" {
  if (sourceType === "paste" || sourceType === "test") return "pasted_text";
  return sourceType === "vault_file" ? "external_reference" : "imported_file";
}

function insertTurns(db: SqliteDatabase, transcriptId: string, rawText: string, turns: ParsedTurn[]): void {
  const statement = db.prepare(`INSERT INTO transcript_turns(
    id,transcript_id,turn_index,speaker_label,speaker_normalized,start_time_ms,end_time_ms,start_line,end_line,start_char,end_char,raw_text
  ) VALUES (@id,@transcript_id,@turn_index,@speaker_label,@speaker_normalized,@start_time_ms,@end_time_ms,@start_line,@end_line,@start_char,@end_char,@raw_text)`);
  for (const turn of turns) {
    if (turn.rawText !== rawText.slice(turn.startChar, turn.endChar)) throw new ValidationError("Turn text does not match its raw transcript offsets");
    statement.run({
      id: stableId("turn_", `${transcriptId}:${turn.turnIndex}:${turn.startChar}:${turn.endChar}`),
      transcript_id: transcriptId,
      turn_index: turn.turnIndex,
      speaker_label: turn.speakerLabel,
      speaker_normalized: turn.speakerNormalized,
      start_time_ms: turn.startTimeMs,
      end_time_ms: turn.endTimeMs,
      start_line: turn.startLine,
      end_line: turn.endLine,
      start_char: turn.startChar,
      end_char: turn.endChar,
      raw_text: turn.rawText,
    });
  }
}

function insertSpans(db: SqliteDatabase, transcriptId: string, sourceId: string, rawText: string, spans: ParsedSpan[]): void {
  const speakerIds = new Map<string, string>();
  const speakerInsert = db.prepare(`INSERT OR IGNORE INTO transcript_speakers(id,transcript_id,speaker_label,metadata_json)
    VALUES (?, ?, ?, '{}')`);
  const statement = db.prepare(`INSERT INTO transcript_spans(
    id,transcript_id,source_id,speaker_id,ordinal,span_index,start_char,end_char,start_time_ms,end_time_ms,
    text_preview,text_hash,created_at,metadata_json,kind,speaker_label,start_line,end_line,text,created_by
  ) VALUES (
    @id,@transcript_id,@source_id,@speaker_id,@ordinal,@span_index,@start_char,@end_char,@start_time_ms,@end_time_ms,
    @text_preview,@text_hash,@created_at,'{}',@kind,@speaker_label,@start_line,@end_line,@text,'deterministic_span_creator'
  )`);
  for (const span of spans) {
    if (span.text !== rawText.slice(span.startChar, span.endChar)) throw new ValidationError("Span text does not match its raw transcript offsets");
    let speakerId: string | null = null;
    if (span.speakerLabel) {
      speakerId = speakerIds.get(span.speakerLabel) ?? stableId("spk_", `${transcriptId}:${span.speakerLabel}`);
      speakerIds.set(span.speakerLabel, speakerId);
      speakerInsert.run(speakerId, transcriptId, span.speakerLabel);
    }
    statement.run({
      id: stableId("sp_", `${transcriptId}:${span.kind}:${span.startChar}:${span.endChar}`),
      transcript_id: transcriptId,
      source_id: sourceId,
      speaker_id: speakerId,
      ordinal: span.spanIndex,
      span_index: span.spanIndex,
      start_char: span.startChar,
      end_char: span.endChar,
      start_time_ms: span.startTimeMs,
      end_time_ms: span.endTimeMs,
      text_preview: span.text.slice(0, 500),
      text_hash: contentHash(span.text),
      created_at: now(),
      kind: span.kind,
      speaker_label: span.speakerLabel,
      start_line: span.startLine,
      end_line: span.endLine,
      text: span.text,
    });
  }
}

export function importTranscript(db: SqliteDatabase, input: TranscriptImportInput): TranscriptImportResult {
  if (!input.filename.trim()) throw new ValidationError("Transcript filename is required");
  if (!input.rawText.trim()) throw new ValidationError("Transcript rawText must contain non-whitespace content");
  const format = detectTranscriptFormat(input.filename, input.rawText);
  const rawSha256 = computeRawSha256(input.rawText);
  const existing = db.prepare("SELECT id FROM transcripts WHERE raw_sha256 = ? OR (raw_sha256 IS NULL AND content_hash = ?) ORDER BY imported_at LIMIT 1").get(rawSha256, rawSha256) as { id: string } | undefined;
  if (existing) {
    return {
      status: "duplicate",
      transcriptId: existing.id,
      duplicateOfTranscriptId: existing.id,
      rawSha256,
      warning: "Duplicate transcript detected. Existing transcript was reused.",
      turnsCreated: 0,
      spansCreated: 0,
    };
  }

  const transcriptId = `tr_${rawSha256.slice(0, 24)}`;
  const sourceId = `src_${rawSha256.slice(0, 24)}`;
  const sourceType = input.sourceType ?? "upload";
  const importedAt = input.importedAt ?? now();
  const turns = parseSpeakerTurns(input.rawText, format);
  const spans = createSpansFromTurns(input.rawText, turns);
  if (!turns.length || !spans.length) throw new ValidationError("Transcript did not produce any usable turns or spans");

  db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO transcript_sources(id,source_type,original_filename,raw_storage_uri,content_hash,byte_length,created_at,metadata_json)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      sourceId, sourceTypeForDatabase(sourceType), input.filename, `db://transcripts/${transcriptId}/raw`,
      rawSha256, Buffer.byteLength(input.rawText), importedAt, json({ ...input.metadata, ingestion_source_type: sourceType }),
    );
    const storedSourceId = (db.prepare("SELECT id FROM transcript_sources WHERE content_hash = ?").get(rawSha256) as { id: string }).id;
    db.prepare(`INSERT INTO transcripts(
      id,source_id,title,status,content_hash,imported_at,updated_at,metadata_json,raw_sha256,source_filename,source_type,raw_text
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      transcriptId, storedSourceId, input.filename, "chunked", rawSha256, importedAt, importedAt, json(input.metadata),
      rawSha256, input.filename, sourceType, input.rawText,
    );
    insertTurns(db, transcriptId, input.rawText, turns);
    insertSpans(db, transcriptId, storedSourceId, input.rawText, spans);
  })();

  return { status: "imported", transcriptId, rawSha256, turnsCreated: turns.length, spansCreated: spans.length };
}

export function createTranscriptImporter(db: SqliteDatabase) {
  return { importTranscript: (input: TranscriptImportInput) => importTranscript(db, input) };
}
