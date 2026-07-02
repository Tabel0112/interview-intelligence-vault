-- Fix ask_ai_analysis_claims primary key. The live analysis item id is a content hash (index:kind:text),
-- unique only WITHIN a run -- so two answers with identical analysis text (e.g. the same advice question
-- asked twice, or generic recommendations) collided on the sole-id PRIMARY KEY and the SECOND answer failed
-- to persist (SQLITE_CONSTRAINT_PRIMARYKEY, rolling back the whole answer). Recreate with the composite key
-- (ask_ai_run_id, id), matching ask_ai_unconfirmed_items. Additive, data-preserving; the table is a leaf
-- (nothing FK-references it), so the standard recreate is safe with foreign_keys ON.

CREATE TABLE ask_ai_analysis_claims_new (
  id TEXT NOT NULL,
  ask_ai_run_id TEXT NOT NULL REFERENCES ask_ai_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position >= 0),
  kind TEXT NOT NULL CHECK(kind IN ('fact','pattern','inference','recommendation')),
  text TEXT NOT NULL,
  explanation TEXT,
  warning TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (ask_ai_run_id, id),
  UNIQUE(ask_ai_run_id, position)
);
INSERT INTO ask_ai_analysis_claims_new (id,ask_ai_run_id,position,kind,text,explanation,warning,metadata_json,created_at)
  SELECT id,ask_ai_run_id,position,kind,text,explanation,warning,metadata_json,created_at FROM ask_ai_analysis_claims;
DROP TABLE ask_ai_analysis_claims;
ALTER TABLE ask_ai_analysis_claims_new RENAME TO ask_ai_analysis_claims;
CREATE INDEX ask_ai_analysis_claims_run_idx ON ask_ai_analysis_claims(ask_ai_run_id);

INSERT OR REPLACE INTO app_meta(key,value_json,updated_at)
VALUES ('schema_version','"016"',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
