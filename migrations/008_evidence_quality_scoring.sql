CREATE TABLE evidence_score_runs (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT,
  claim_text TEXT NOT NULL,
  use_type TEXT NOT NULL CHECK(use_type IN ('direct_fact','pattern','inference','recommendation')),
  strength TEXT NOT NULL CHECK(strength IN ('strong','mixed','weak','conflicting','no_evidence')),
  support_score REAL NOT NULL CHECK(support_score BETWEEN 0 AND 1),
  opposition_score REAL NOT NULL CHECK(opposition_score BETWEEN 0 AND 1),
  qualification_score REAL NOT NULL CHECK(qualification_score BETWEEN 0 AND 1),
  has_conflict INTEGER NOT NULL DEFAULT 0 CHECK(has_conflict IN (0,1)),
  scorer_version TEXT NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  assessment_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX evidence_score_runs_target_idx ON evidence_score_runs(target_type,target_id);
CREATE INDEX evidence_score_runs_strength_idx ON evidence_score_runs(strength);
CREATE INDEX evidence_score_runs_created_idx ON evidence_score_runs(created_at);

CREATE TABLE evidence_score_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES evidence_score_runs(id) ON DELETE CASCADE,
  evidence_pointer_id TEXT REFERENCES evidence_pointers(evidence_pointer_id) ON DELETE SET NULL,
  candidate_id TEXT NOT NULL,
  stance TEXT NOT NULL CHECK(stance IN ('supports','opposes','qualifies','updates','neutral','unknown')),
  final_score REAL NOT NULL CHECK(final_score BETWEEN 0 AND 1),
  strength TEXT NOT NULL CHECK(strength IN ('strong','mixed','weak','conflicting','no_evidence')),
  relevance REAL NOT NULL CHECK(relevance BETWEEN 0 AND 1),
  directness REAL NOT NULL CHECK(directness BETWEEN 0 AND 1),
  specificity REAL NOT NULL CHECK(specificity BETWEEN 0 AND 1),
  source_strength REAL NOT NULL CHECK(source_strength BETWEEN 0 AND 1),
  repetition REAL NOT NULL CHECK(repetition BETWEEN 0 AND 1),
  recency REAL NOT NULL CHECK(recency BETWEEN 0 AND 1),
  correction_weight REAL NOT NULL CHECK(correction_weight BETWEEN 0 AND 1),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  opposition_penalty REAL NOT NULL CHECK(opposition_penalty BETWEEN 0 AND 1),
  caps_json TEXT NOT NULL DEFAULT '{"reasons":[]}',
  reasons_json TEXT NOT NULL DEFAULT '[]',
  candidate_json TEXT NOT NULL
);
CREATE INDEX evidence_score_items_run_idx ON evidence_score_items(run_id);
CREATE INDEX evidence_score_items_pointer_idx ON evidence_score_items(evidence_pointer_id);
CREATE INDEX evidence_score_items_candidate_idx ON evidence_score_items(candidate_id);

INSERT OR REPLACE INTO app_meta(key,value_json,updated_at)
VALUES ('schema_version','"008"',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
