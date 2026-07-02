-- Persist structured Ask AI unconfirmed/tentative/conflict context (sub-step B) in a table SEPARATE from
-- evidence-backed answer claims, so reconstruction matches the live response without ever letting unconfirmed
-- context become transcript-backed evidence. Like ask_ai_analysis_claims (Step 3), this table has:
--   * NO support_status column -> reconstruction sets nothing supportable; it can never reload as a claim;
--   * NO citation columns -> it is structurally uncitable;
--   * an OPTIONAL evidence_pointer_id used ONLY as a context link (not a citation), with NO FK and ON DELETE
--     left to the app: reconstruction re-resolves it and drops the link if the pointer was deleted, so a
--     deleted transcript never yields a broken normal citation.
-- Rows hang off the ask_ai_run (ON DELETE CASCADE) like ask_ai_run_evidence / analysis / followups, and are
-- read ONLY by Ask AI reconstruction -- never by answer_claims, citation_links, evidence bundles, the
-- provenance graph builders, or generated-note builders. No existing CHECK constraint is touched.

CREATE TABLE ask_ai_unconfirmed_items (
  -- The live item id is deterministic per memory/conflict, so it is unique only WITHIN a run (the same memory
  -- can appear in many answers). The primary key is therefore (ask_ai_run_id, id), not id alone.
  id TEXT NOT NULL,
  ask_ai_run_id TEXT NOT NULL REFERENCES ask_ai_runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK(position >= 0),
  kind TEXT NOT NULL CHECK(kind IN ('review_only','tentative','possible_duplicate','conflict','degraded')),
  memory_id TEXT,
  conflict_id TEXT,
  text TEXT NOT NULL,
  label TEXT NOT NULL,
  warning TEXT NOT NULL,
  evidence_pointer_id TEXT,
  evidence_uri TEXT,
  missing_evidence INTEGER NOT NULL DEFAULT 0 CHECK(missing_evidence IN (0,1)),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  PRIMARY KEY (ask_ai_run_id, id),
  UNIQUE(ask_ai_run_id, position)
);
CREATE INDEX ask_ai_unconfirmed_items_run_idx ON ask_ai_unconfirmed_items(ask_ai_run_id);
CREATE INDEX ask_ai_unconfirmed_items_memory_idx ON ask_ai_unconfirmed_items(memory_id);
CREATE INDEX ask_ai_unconfirmed_items_conflict_idx ON ask_ai_unconfirmed_items(conflict_id);
CREATE INDEX ask_ai_unconfirmed_items_pointer_idx ON ask_ai_unconfirmed_items(evidence_pointer_id);

INSERT OR REPLACE INTO app_meta(key,value_json,updated_at)
VALUES ('schema_version','"015"',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
