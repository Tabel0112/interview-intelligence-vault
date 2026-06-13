import type { SqliteDatabase } from "../db/connection.js";
import { NotFoundError, ValidationError } from "../db/errors.js";
import { contentHash } from "../db/ids.js";
import { makeSourcePointerUri, parseSourcePointerUri } from "./pointerFormat.js";
import type { SourcePointer, SourcePointerResolution } from "./types.js";

interface SpanSourceRow {
  span_id: string; transcript_id: string; speaker_id: string | null; start_char: number; end_char: number;
  start_time_ms: number | null; end_time_ms: number | null; text: string | null; raw_text: string | null;
  raw_sha256: string | null; title: string;
}

function loadSpanSource(db: SqliteDatabase, transcriptId: string, spanId: string): SpanSourceRow | null {
  return (db.prepare(`SELECT s.id span_id,s.transcript_id,s.speaker_id,s.start_char,s.end_char,s.start_time_ms,s.end_time_ms,s.text,
      t.raw_text,t.raw_sha256,t.title
    FROM transcript_spans s JOIN transcripts t ON t.id=s.transcript_id
    WHERE s.id=? AND t.id=?`).get(spanId, transcriptId) as SpanSourceRow | undefined) ?? null;
}

export function getSourcePointer(db: SqliteDatabase, pointerUri: string): SourcePointer | null {
  return (db.prepare("SELECT * FROM source_pointers WHERE pointer_uri = ?").get(pointerUri) as SourcePointer | undefined) ?? null;
}

export function createSourcePointerForSpan(db: SqliteDatabase, input: { transcriptId: string; spanId: string }): SourcePointer {
  const pointerUri = makeSourcePointerUri(input);
  const existing = getSourcePointer(db, pointerUri);
  if (existing) {
    const resolution = resolveSourcePointer(db, pointerUri);
    if (!resolution.ok) throw new ValidationError(`Existing source pointer is broken: ${resolution.reason}`);
    return existing;
  }
  const row = loadSpanSource(db, input.transcriptId, input.spanId);
  if (!row) throw new NotFoundError(`Transcript span not found: ${input.spanId}`);
  if (row.raw_text == null) throw new ValidationError(`Raw transcript is unavailable: ${input.transcriptId}`);
  if (row.start_char < 0 || row.end_char <= row.start_char || row.end_char > row.raw_text.length) throw new ValidationError("Span has invalid raw transcript offsets");
  const substring = row.raw_text.slice(row.start_char, row.end_char);
  if (row.text == null || row.text !== substring) throw new ValidationError("Span text does not match immutable raw transcript text");
  const turn = db.prepare(`SELECT id FROM transcript_turns WHERE transcript_id=? AND start_char<=? AND end_char>=? ORDER BY turn_index LIMIT 1`)
    .get(input.transcriptId, row.start_char, row.end_char) as { id: string } | undefined;
  db.prepare(`INSERT INTO source_pointers(pointer_uri,transcript_id,span_id,turn_id,raw_start_offset,raw_end_offset,raw_text_sha256,span_text_sha256,speaker_id,start_ms,end_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    pointerUri, input.transcriptId, input.spanId, turn?.id ?? null, row.start_char, row.end_char,
    contentHash(row.raw_text), contentHash(substring), row.speaker_id, row.start_time_ms, row.end_time_ms,
  );
  return getSourcePointer(db, pointerUri)!;
}

export function resolveSourcePointer(db: SqliteDatabase, pointerUri: string): SourcePointerResolution {
  try { parseSourcePointerUri(pointerUri); } catch { return { ok: false, reason: "not_found", pointerUri }; }
  const pointer = getSourcePointer(db, pointerUri);
  if (!pointer) return { ok: false, reason: "not_found", pointerUri };
  const row = loadSpanSource(db, pointer.transcript_id, pointer.span_id);
  if (!row || row.raw_text == null) return { ok: false, reason: "raw_transcript_missing", pointerUri };
  if (pointer.raw_start_offset < 0 || pointer.raw_end_offset <= pointer.raw_start_offset || pointer.raw_end_offset > row.raw_text.length) {
    return { ok: false, reason: "invalid_offsets", pointerUri };
  }
  const spanText = row.raw_text.slice(pointer.raw_start_offset, pointer.raw_end_offset);
  if (row.text !== spanText || contentHash(row.raw_text) !== pointer.raw_text_sha256 || contentHash(spanText) !== pointer.span_text_sha256) {
    return { ok: false, reason: "hash_mismatch", pointerUri };
  }
  return { ok: true, pointer, rawText: row.raw_text, spanText, transcriptTitle: row.title };
}
