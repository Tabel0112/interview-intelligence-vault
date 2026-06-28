CREATE TABLE ask_ai_runs (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  normalized_question TEXT NOT NULL,
  answer_markdown TEXT NOT NULL,
  evidence_confidence TEXT NOT NULL CHECK(evidence_confidence IN ('strong','mixed','weak','conflicting','no_evidence')),
  query_understanding_json TEXT NOT NULL,
  answer_id TEXT NOT NULL REFERENCES ai_answers(id) ON DELETE CASCADE,
  score_run_id TEXT REFERENCES evidence_score_runs(id) ON DELETE SET NULL,
  not_enough_evidence INTEGER NOT NULL DEFAULT 0 CHECK(not_enough_evidence IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX ask_ai_runs_confidence_idx ON ask_ai_runs(evidence_confidence);
CREATE INDEX ask_ai_runs_answer_idx ON ask_ai_runs(answer_id);
CREATE INDEX ask_ai_runs_score_run_idx ON ask_ai_runs(score_run_id);
CREATE INDEX ask_ai_runs_created_idx ON ask_ai_runs(created_at);

CREATE TABLE ask_ai_run_evidence (
  ask_ai_run_id TEXT NOT NULL REFERENCES ask_ai_runs(id) ON DELETE CASCADE,
  evidence_pointer_id TEXT NOT NULL REFERENCES evidence_pointers(evidence_pointer_id) ON DELETE CASCADE,
  source_pointer_id TEXT REFERENCES source_pointers(pointer_uri) ON DELETE SET NULL,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  span_id TEXT NOT NULL REFERENCES transcript_spans(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK(rank >= 1),
  evidence_score REAL NOT NULL CHECK(evidence_score BETWEEN 0 AND 1),
  evidence_confidence TEXT NOT NULL CHECK(evidence_confidence IN ('strong','mixed','weak','conflicting','no_evidence')),
  quote_preview TEXT NOT NULL,
  scoring_explanation TEXT NOT NULL,
  PRIMARY KEY (ask_ai_run_id, span_id)
);
CREATE INDEX ask_ai_run_evidence_pointer_idx ON ask_ai_run_evidence(evidence_pointer_id);
CREATE INDEX ask_ai_run_evidence_span_idx ON ask_ai_run_evidence(span_id);

CREATE TABLE ask_ai_claim_metadata (
  answer_claim_id TEXT PRIMARY KEY REFERENCES answer_claims(answer_claim_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('fact','pattern','inference','recommendation')),
  explanation TEXT
);

CREATE TABLE ask_ai_suggested_followups (
  id TEXT PRIMARY KEY,
  ask_ai_run_id TEXT NOT NULL REFERENCES ask_ai_runs(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK(rank >= 1),
  UNIQUE(ask_ai_run_id, rank)
);

INSERT OR REPLACE INTO app_meta(key,value_json,updated_at)
VALUES ('schema_version','"009"',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
