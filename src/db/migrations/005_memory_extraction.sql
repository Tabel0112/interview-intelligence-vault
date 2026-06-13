CREATE TABLE extraction_runs (
  id TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  extractor_kind TEXT NOT NULL CHECK(extractor_kind IN ('llm','deterministic','test')),
  extractor_model TEXT,
  prompt_version TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT
);
CREATE INDEX extraction_runs_transcript_idx ON extraction_runs(transcript_id);
CREATE INDEX extraction_runs_status_idx ON extraction_runs(status);

ALTER TABLE memory_objects ADD COLUMN extraction_type TEXT
  CHECK(extraction_type IS NULL OR extraction_type IN ('topic','quote','question','decision','action_item','objection','advice_idea'));
ALTER TABLE memory_objects ADD COLUMN extraction_status TEXT
  CHECK(extraction_status IS NULL OR extraction_status IN ('active','weak','needs_review','rejected','superseded'));
ALTER TABLE memory_objects ADD COLUMN generated_by TEXT;
ALTER TABLE memory_objects ADD COLUMN generated_at TEXT;
ALTER TABLE memory_objects ADD COLUMN extraction_run_id TEXT REFERENCES extraction_runs(id) ON DELETE SET NULL;
ALTER TABLE memory_objects ADD COLUMN prompt_version TEXT;
ALTER TABLE memory_objects ADD COLUMN confidence_label TEXT
  CHECK(confidence_label IS NULL OR confidence_label IN ('high','medium','low'));
ALTER TABLE memory_objects ADD COLUMN object_fingerprint TEXT;
ALTER TABLE memory_objects ADD COLUMN duplicate_of_id TEXT REFERENCES memory_objects(id) ON DELETE SET NULL;
ALTER TABLE memory_objects ADD COLUMN user_corrected INTEGER NOT NULL DEFAULT 0 CHECK(user_corrected IN (0,1));
ALTER TABLE memory_objects ADD COLUMN correction_of_id TEXT REFERENCES memory_objects(id) ON DELETE SET NULL;

CREATE INDEX memory_objects_extraction_type_idx ON memory_objects(extraction_type);
CREATE INDEX memory_objects_extraction_status_idx ON memory_objects(extraction_status);
CREATE INDEX memory_objects_extraction_run_idx ON memory_objects(extraction_run_id);
CREATE INDEX memory_objects_fingerprint_idx ON memory_objects(object_fingerprint);
CREATE INDEX memory_objects_duplicate_idx ON memory_objects(duplicate_of_id);

ALTER TABLE memory_object_evidence ADD COLUMN transcript_id TEXT REFERENCES transcripts(id) ON DELETE CASCADE;
ALTER TABLE memory_object_evidence ADD COLUMN turn_id TEXT REFERENCES transcript_turns(id) ON DELETE SET NULL;
ALTER TABLE memory_object_evidence ADD COLUMN extraction_role TEXT
  CHECK(extraction_role IS NULL OR extraction_role IN ('primary','supporting','context'));

CREATE INDEX memory_evidence_transcript_idx ON memory_object_evidence(transcript_id);
CREATE INDEX memory_evidence_turn_idx ON memory_object_evidence(turn_id);

CREATE TRIGGER extraction_memory_active_requires_evidence
BEFORE UPDATE OF extraction_status ON memory_objects
WHEN NEW.extraction_status='active'
  AND NOT EXISTS (SELECT 1 FROM memory_object_evidence WHERE memory_id=NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'active extracted memory objects require evidence');
END;

CREATE TRIGGER extraction_memory_active_insert_requires_evidence
BEFORE INSERT ON memory_objects
WHEN NEW.extraction_status='active'
BEGIN
  SELECT RAISE(ABORT, 'active extracted memory objects must be inserted before evidence and promoted afterward');
END;

INSERT OR REPLACE INTO app_meta(key, value_json, updated_at)
VALUES ('schema_version', '"005"', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
