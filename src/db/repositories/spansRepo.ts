import type { SqliteDatabase } from "../connection.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { createId } from "../ids.js";
import type { JsonObject, TranscriptSpeaker, TranscriptSpan } from "../schema.js";
import { assertScore, json, now, parseRow, parseRows } from "../utils.js";

export interface CreateSpeakerInput { id?: string; transcript_id: string; speaker_label: string; display_name?: string | null; canonical_entity_id?: string | null; confidence?: number | null; metadata?: JsonObject; }
export interface CreateSpanInput { id?: string; transcript_id: string; source_id: string; speaker_id?: string | null; ordinal: number; start_char: number; end_char: number; start_time_ms?: number | null; end_time_ms?: number | null; text_preview: string; text_hash: string; topic_hint?: string | null; metadata?: JsonObject; }

export function createSpansRepo(db: SqliteDatabase) {
  const createSpan = (input: CreateSpanInput): TranscriptSpan => {
    if (input.end_char <= input.start_char || input.start_char < 0) throw new ValidationError("Span offsets must satisfy end_char > start_char >= 0");
    if (input.text_preview.length > 500) throw new ValidationError("text_preview must not exceed 500 characters");
    const transcript = db.prepare("SELECT source_id FROM transcripts WHERE id = ?").get(input.transcript_id) as { source_id: string } | undefined;
    if (!transcript) throw new NotFoundError(`Transcript not found: ${input.transcript_id}`);
    if (transcript.source_id !== input.source_id) throw new ValidationError("Span source_id must match transcript source_id");
    if (input.speaker_id) {
      const speaker = db.prepare("SELECT transcript_id FROM transcript_speakers WHERE id = ?").get(input.speaker_id) as { transcript_id: string } | undefined;
      if (!speaker || speaker.transcript_id !== input.transcript_id) throw new ValidationError("Speaker must belong to the span transcript");
    }
    const row = { id: input.id ?? createId("span_"), transcript_id: input.transcript_id, source_id: input.source_id, speaker_id: input.speaker_id ?? null, ordinal: input.ordinal, start_char: input.start_char, end_char: input.end_char, start_time_ms: input.start_time_ms ?? null, end_time_ms: input.end_time_ms ?? null, text_preview: input.text_preview, text_hash: input.text_hash, topic_hint: input.topic_hint ?? null, created_at: now(), metadata_json: json(input.metadata) };
    db.prepare(`INSERT INTO transcript_spans(id,transcript_id,source_id,speaker_id,ordinal,start_char,end_char,start_time_ms,end_time_ms,text_preview,text_hash,topic_hint,created_at,metadata_json)
      VALUES (@id,@transcript_id,@source_id,@speaker_id,@ordinal,@start_char,@end_char,@start_time_ms,@end_time_ms,@text_preview,@text_hash,@topic_hint,@created_at,@metadata_json)`).run(row);
    return parseRow<TranscriptSpan>(db.prepare("SELECT * FROM transcript_spans WHERE id = ?").get(row.id));
  };
  return {
    createSpeaker(input: CreateSpeakerInput): TranscriptSpeaker {
      assertScore(input.confidence, "confidence");
      const row = { id: input.id ?? createId("spk_"), transcript_id: input.transcript_id, speaker_label: input.speaker_label, display_name: input.display_name ?? null, canonical_entity_id: input.canonical_entity_id ?? null, confidence: input.confidence ?? null, metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO transcript_speakers(id,transcript_id,speaker_label,display_name,canonical_entity_id,confidence,metadata_json)
        VALUES (@id,@transcript_id,@speaker_label,@display_name,@canonical_entity_id,@confidence,@metadata_json)`).run(row);
      return parseRow<TranscriptSpeaker>(db.prepare("SELECT * FROM transcript_speakers WHERE id = ?").get(row.id));
    },
    createSpan,
    createSpans(inputs: CreateSpanInput[]): TranscriptSpan[] { return db.transaction(() => inputs.map(createSpan))(); },
    getSpan(id: string): TranscriptSpan | null { return parseRow<TranscriptSpan | null>(db.prepare("SELECT * FROM transcript_spans WHERE id = ?").get(id)); },
    listSpansForTranscript(transcriptId: string): TranscriptSpan[] { return parseRows<TranscriptSpan>(db.prepare("SELECT * FROM transcript_spans WHERE transcript_id = ? ORDER BY ordinal").all(transcriptId)); },
    listSpansByIds(ids: string[]): TranscriptSpan[] {
      if (!ids.length) return [];
      return parseRows<TranscriptSpan>(db.prepare(`SELECT * FROM transcript_spans WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY transcript_id, ordinal`).all(...ids));
    },
  };
}
