CREATE TABLE conflict_assessments (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('direct_contradiction','tension','temporal_update','conditional_difference','weak_or_ambiguous')),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL CHECK(status IN ('active','needs_review','resolved','dismissed','superseded')),
  left_target_type TEXT NOT NULL CHECK(left_target_type IN ('memory_object','claim','summary','answer_claim','graph_node','graph_edge','evidence_pointer')),
  left_target_id TEXT NOT NULL,
  right_target_type TEXT NOT NULL CHECK(right_target_type IN ('memory_object','claim','summary','answer_claim','graph_node','graph_edge','evidence_pointer')),
  right_target_id TEXT NOT NULL,
  pair_key TEXT NOT NULL,
  summary TEXT NOT NULL,
  explanation TEXT NOT NULL,
  component_scores_json TEXT NOT NULL DEFAULT '{}',
  newer_target_id TEXT,
  older_target_id TEXT,
  winning_target_id TEXT,
  resolution_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX conflict_assessments_active_pair_uq ON conflict_assessments(pair_key) WHERE status='active';
CREATE INDEX conflict_assessments_pair_idx ON conflict_assessments(pair_key);
CREATE INDEX conflict_assessments_left_idx ON conflict_assessments(left_target_type,left_target_id,status);
CREATE INDEX conflict_assessments_right_idx ON conflict_assessments(right_target_type,right_target_id,status);
CREATE INDEX conflict_assessments_kind_status_idx ON conflict_assessments(kind,status);

CREATE TABLE conflict_evidence_links (
  id TEXT PRIMARY KEY,
  conflict_assessment_id TEXT NOT NULL REFERENCES conflict_assessments(id) ON DELETE CASCADE,
  evidence_pointer_id TEXT NOT NULL REFERENCES evidence_pointers(evidence_pointer_id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK(side IN ('left','right')),
  role TEXT NOT NULL CHECK(role IN ('supports_left','supports_right','opposes_left','opposes_right','conditional_context')),
  provenance_validated INTEGER NOT NULL DEFAULT 0 CHECK(provenance_validated IN (0,1)),
  created_at TEXT NOT NULL,
  UNIQUE(conflict_assessment_id,evidence_pointer_id,side,role)
);
CREATE INDEX conflict_evidence_links_conflict_idx ON conflict_evidence_links(conflict_assessment_id,side);
CREATE INDEX conflict_evidence_links_pointer_idx ON conflict_evidence_links(evidence_pointer_id);

CREATE TRIGGER conflict_active_requires_both_sides
BEFORE UPDATE OF status ON conflict_assessments
WHEN NEW.status='active' AND (
  NOT EXISTS (SELECT 1 FROM conflict_evidence_links WHERE conflict_assessment_id=NEW.id AND side='left' AND provenance_validated=1)
  OR NOT EXISTS (SELECT 1 FROM conflict_evidence_links WHERE conflict_assessment_id=NEW.id AND side='right' AND provenance_validated=1)
)
BEGIN
  SELECT RAISE(ABORT,'active conflicts require validated evidence for both sides');
END;

CREATE TRIGGER conflict_active_insert_forbidden
BEFORE INSERT ON conflict_assessments
WHEN NEW.status='active'
BEGIN
  SELECT RAISE(ABORT,'conflicts must be inserted for review and promoted after validated evidence is linked');
END;

CREATE TRIGGER conflict_evidence_invalidation_downgrades_assessment
AFTER UPDATE OF provenance_validated ON conflict_evidence_links
WHEN NEW.provenance_validated=0
BEGIN
  UPDATE conflict_assessments SET status='needs_review',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id=NEW.conflict_assessment_id AND status='active' AND (
    NOT EXISTS (SELECT 1 FROM conflict_evidence_links WHERE conflict_assessment_id=NEW.conflict_assessment_id AND side='left' AND provenance_validated=1)
    OR NOT EXISTS (SELECT 1 FROM conflict_evidence_links WHERE conflict_assessment_id=NEW.conflict_assessment_id AND side='right' AND provenance_validated=1)
  );
END;

CREATE TRIGGER conflict_evidence_delete_downgrades_assessment
AFTER DELETE ON conflict_evidence_links
WHEN EXISTS (SELECT 1 FROM conflict_assessments WHERE id=OLD.conflict_assessment_id AND status='active')
BEGIN
  UPDATE conflict_assessments SET status='needs_review',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id=OLD.conflict_assessment_id AND (
    NOT EXISTS (SELECT 1 FROM conflict_evidence_links WHERE conflict_assessment_id=OLD.conflict_assessment_id AND side='left' AND provenance_validated=1)
    OR NOT EXISTS (SELECT 1 FROM conflict_evidence_links WHERE conflict_assessment_id=OLD.conflict_assessment_id AND side='right' AND provenance_validated=1)
  );
END;

CREATE TABLE conflict_graph_edges (
  conflict_assessment_id TEXT PRIMARY KEY REFERENCES conflict_assessments(id) ON DELETE CASCADE,
  graph_edge_id TEXT NOT NULL UNIQUE REFERENCES graph_edges(id) ON DELETE CASCADE,
  logical_edge_type TEXT NOT NULL CHECK(logical_edge_type IN ('contradicts','tensions_with','updates','conditionally_differs_from')),
  created_at TEXT NOT NULL
);
CREATE TRIGGER conflict_status_downgrades_graph_edge
AFTER UPDATE OF status ON conflict_assessments
WHEN NEW.status!='active'
BEGIN
  UPDATE graph_edges SET status='needs_review',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id IN (SELECT graph_edge_id FROM conflict_graph_edges WHERE conflict_assessment_id=NEW.id)
    AND status='active';
END;

CREATE TABLE conflict_corrections (
  id TEXT PRIMARY KEY,
  conflict_assessment_id TEXT NOT NULL REFERENCES conflict_assessments(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('mark_left_correct','mark_right_correct','mark_both_contextual','mark_newer_supersedes_older','keep_both_as_tension','dismiss_not_conflict')),
  winning_target_id TEXT,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX conflict_corrections_assessment_idx ON conflict_corrections(conflict_assessment_id,created_at);
CREATE TRIGGER conflict_corrections_append_only_update BEFORE UPDATE ON conflict_corrections BEGIN
  SELECT RAISE(ABORT,'conflict corrections are append-only');
END;
CREATE TRIGGER conflict_corrections_append_only_delete BEFORE DELETE ON conflict_corrections BEGIN
  SELECT RAISE(ABORT,'conflict corrections are append-only');
END;

CREATE TABLE ask_ai_run_conflicts (
  ask_ai_run_id TEXT NOT NULL REFERENCES ask_ai_runs(id) ON DELETE CASCADE,
  conflict_assessment_id TEXT NOT NULL REFERENCES conflict_assessments(id) ON DELETE CASCADE,
  PRIMARY KEY(ask_ai_run_id,conflict_assessment_id)
);
CREATE INDEX ask_ai_run_conflicts_conflict_idx ON ask_ai_run_conflicts(conflict_assessment_id);

INSERT OR REPLACE INTO app_meta(key,value_json,updated_at)
VALUES ('schema_version','"010"',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
