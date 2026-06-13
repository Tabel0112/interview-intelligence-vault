ALTER TABLE transcripts ADD COLUMN raw_sha256 TEXT;
ALTER TABLE transcripts ADD COLUMN source_filename TEXT;
ALTER TABLE transcripts ADD COLUMN source_type TEXT;
ALTER TABLE transcripts ADD COLUMN raw_text TEXT;

CREATE UNIQUE INDEX transcripts_raw_sha256_uq
ON transcripts(raw_sha256)
WHERE raw_sha256 IS NOT NULL;

CREATE TRIGGER transcripts_ingestion_raw_immutable
BEFORE UPDATE OF raw_sha256, source_filename, raw_text ON transcripts BEGIN
  SELECT RAISE(ABORT, 'ingested raw transcript fields are immutable');
END;

CREATE TABLE transcript_turns (
  id TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  turn_index INTEGER NOT NULL,
  speaker_label TEXT,
  speaker_normalized TEXT,
  start_time_ms INTEGER,
  end_time_ms INTEGER,
  start_line INTEGER NOT NULL CHECK(start_line >= 1),
  end_line INTEGER NOT NULL CHECK(end_line >= start_line),
  start_char INTEGER NOT NULL CHECK(start_char >= 0),
  end_char INTEGER NOT NULL CHECK(end_char > start_char),
  raw_text TEXT NOT NULL,
  UNIQUE(transcript_id, turn_index)
);
CREATE INDEX transcript_turns_transcript_idx ON transcript_turns(transcript_id);
CREATE INDEX transcript_turns_speaker_idx ON transcript_turns(speaker_normalized);
CREATE INDEX transcript_turns_offsets_idx ON transcript_turns(transcript_id, start_char, end_char);

ALTER TABLE transcript_spans ADD COLUMN span_index INTEGER;
ALTER TABLE transcript_spans ADD COLUMN kind TEXT;
ALTER TABLE transcript_spans ADD COLUMN speaker_label TEXT;
ALTER TABLE transcript_spans ADD COLUMN start_line INTEGER;
ALTER TABLE transcript_spans ADD COLUMN end_line INTEGER;
ALTER TABLE transcript_spans ADD COLUMN text TEXT;
ALTER TABLE transcript_spans ADD COLUMN created_by TEXT DEFAULT 'deterministic_span_creator';

CREATE UNIQUE INDEX transcript_spans_span_index_uq
ON transcript_spans(transcript_id, span_index)
WHERE span_index IS NOT NULL;
CREATE UNIQUE INDEX transcript_spans_stable_range_uq
ON transcript_spans(transcript_id, start_char, end_char, kind)
WHERE kind IS NOT NULL;

CREATE TRIGGER transcript_turns_exact_source_immutable
BEFORE UPDATE OF transcript_id, turn_index, start_line, end_line, start_char, end_char, raw_text ON transcript_turns BEGIN
  SELECT RAISE(ABORT, 'transcript turn source fields are immutable');
END;

CREATE TRIGGER transcript_spans_exact_source_immutable
BEFORE UPDATE OF transcript_id, source_id, ordinal, span_index, kind, start_line, end_line, start_char, end_char, text, text_hash ON transcript_spans BEGIN
  SELECT RAISE(ABORT, 'transcript span source fields are immutable');
END;

INSERT OR REPLACE INTO app_meta(key, value_json, updated_at)
VALUES ('schema_version', '"003"', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
