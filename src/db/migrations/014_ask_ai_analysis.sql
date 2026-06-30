-- Persist structured, LIVE-ONLY AI analysis (Step 3) in a table SEPARATE from evidence-backed answer
-- claims, so reconstruction matches the live response without ever letting analysis become transcript
-- evidence. AI analysis is reasoning/recommendations, NOT a transcript-backed claim:
--   * there is NO evidence_pointer / source_pointer / citation column here -> analysis is structurally
--     uncitable and cannot create provenance;
--   * there is NO support_status column -> reconstruction always sets the literal "ai_analysis" in code,
--     so analysis can never reload as 'supported' (it never passes through reconstructClaimSupport);
--   * rows hang off the ask_ai_run (ON DELETE CASCADE) like ask_ai_run_evidence / followups, and are read
--     ONLY by Ask AI reconstruction -- never by answer_claims, citation_links, evidence bundles, the
--     provenance graph builders, or generated-note builders.
-- This does NOT touch answer_claims, ask_ai_claim_metadata, citation_links, evidence_pointers, or any
-- existing CHECK constraint.

CREATE TABLE ask_ai_analysis_claims (
  id TEXT PRIMARY KEY,
  ask_ai_run_id TEXT NOT NULL REFERENCES ask_ai_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position >= 0),
  kind TEXT NOT NULL CHECK(kind IN ('fact','pattern','inference','recommendation')),
  text TEXT NOT NULL,
  explanation TEXT,
  warning TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(ask_ai_run_id, position)
);
CREATE INDEX ask_ai_analysis_claims_run_idx ON ask_ai_analysis_claims(ask_ai_run_id);

INSERT OR REPLACE INTO app_meta(key,value_json,updated_at)
VALUES ('schema_version','"014"',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
