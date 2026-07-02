CREATE TABLE pipeline_runs (
  id TEXT PRIMARY KEY,
  pipeline_type TEXT NOT NULL CHECK(pipeline_type IN ('transcript_import','transcript_reprocess','ask_ai','cleanup','contradiction_scan')),
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','cancelled')),
  input_json TEXT NOT NULL,
  output_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  idempotency_key TEXT
);
CREATE UNIQUE INDEX pipeline_runs_idempotency_uq ON pipeline_runs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX pipeline_runs_type_status_idx ON pipeline_runs(pipeline_type,status);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  agent_type TEXT NOT NULL CHECK(agent_type IN ('ingestion','chunking_span','extraction','evidence_validation','retrieval_ranking','contradiction_detection','answer_synthesis','cleanup_reprocessing')),
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','skipped')),
  input_json TEXT NOT NULL,
  output_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX agent_runs_pipeline_idx ON agent_runs(pipeline_run_id,created_at);

CREATE TABLE pipeline_events (
  id TEXT PRIMARY KEY,
  pipeline_run_id TEXT NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  agent_run_id TEXT REFERENCES agent_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX pipeline_events_pipeline_idx ON pipeline_events(pipeline_run_id,created_at);
CREATE TRIGGER pipeline_events_append_only_update BEFORE UPDATE ON pipeline_events BEGIN SELECT RAISE(ABORT,'pipeline events are append-only'); END;
CREATE TRIGGER pipeline_events_append_only_delete BEFORE DELETE ON pipeline_events BEGIN SELECT RAISE(ABORT,'pipeline events are append-only'); END;

CREATE TABLE reprocessing_jobs (
  id TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN ('settings_changed','extraction_rules_changed','manual_reprocess','schema_upgrade','cleanup')),
  status TEXT NOT NULL CHECK(status IN ('pending','running','completed','failed','cancelled')),
  requested_by TEXT NOT NULL DEFAULT 'local_user',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  error_json TEXT
);
CREATE INDEX reprocessing_jobs_status_idx ON reprocessing_jobs(status,created_at);

CREATE TABLE hermes_profiles (
  user_id TEXT PRIMARY KEY,
  answer_style_json TEXT NOT NULL,
  default_filters_json TEXT NOT NULL,
  ranking_preferences_json TEXT NOT NULL,
  suggested_followup_preferences_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE hermes_label_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES hermes_profiles(user_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  description TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,label)
);

CREATE TABLE hermes_topic_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES hermes_profiles(user_id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  weight REAL NOT NULL CHECK(weight BETWEEN 0 AND 1),
  source TEXT NOT NULL CHECK(source IN ('explicit_user_preference','correction_history','usage_pattern')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,topic,source)
);

CREATE TABLE hermes_correction_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES hermes_profiles(user_id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  correction_type TEXT NOT NULL CHECK(correction_type IN ('style','label','filter','ranking_preference','factual_correction')),
  summary TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX hermes_correction_history_user_idx ON hermes_correction_history(user_id,created_at);
CREATE TRIGGER hermes_correction_history_append_only_update BEFORE UPDATE ON hermes_correction_history BEGIN SELECT RAISE(ABORT,'Hermes correction history is append-only'); END;
CREATE TRIGGER hermes_correction_history_append_only_delete BEFORE DELETE ON hermes_correction_history BEGIN SELECT RAISE(ABORT,'Hermes correction history is append-only'); END;

INSERT OR REPLACE INTO app_meta(key,value_json,updated_at)
VALUES ('schema_version','"011"',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
