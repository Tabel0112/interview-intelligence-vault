CREATE TABLE source_pointers (
  pointer_uri TEXT PRIMARY KEY CHECK(pointer_uri LIKE 'mv://source/%'),
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  span_id TEXT NOT NULL REFERENCES transcript_spans(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES transcript_turns(id) ON DELETE SET NULL,
  raw_start_offset INTEGER NOT NULL CHECK(raw_start_offset >= 0),
  raw_end_offset INTEGER NOT NULL CHECK(raw_end_offset > raw_start_offset),
  raw_text_sha256 TEXT NOT NULL,
  span_text_sha256 TEXT NOT NULL,
  speaker_id TEXT REFERENCES transcript_speakers(id) ON DELETE SET NULL,
  start_ms INTEGER,
  end_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(transcript_id, span_id)
);
CREATE INDEX source_pointers_span_idx ON source_pointers(span_id);
CREATE INDEX source_pointers_turn_idx ON source_pointers(turn_id);

CREATE TRIGGER source_pointers_span_consistency
BEFORE INSERT ON source_pointers
WHEN NOT EXISTS (
  SELECT 1 FROM transcript_spans
  WHERE id=NEW.span_id AND transcript_id=NEW.transcript_id
    AND start_char=NEW.raw_start_offset AND end_char=NEW.raw_end_offset
)
BEGIN
  SELECT RAISE(ABORT, 'source pointer does not match transcript span');
END;

CREATE TABLE evidence_pointers (
  evidence_pointer_id TEXT PRIMARY KEY,
  pointer_uri TEXT NOT NULL UNIQUE CHECK(pointer_uri LIKE 'mv://evidence/%'),
  source_pointer_uri TEXT NOT NULL REFERENCES source_pointers(pointer_uri) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('memory_object','claim','answer','answer_claim','graph_node','graph_edge','summary')),
  target_id TEXT NOT NULL,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  span_id TEXT NOT NULL REFERENCES transcript_spans(id) ON DELETE CASCADE,
  evidence_role TEXT NOT NULL CHECK(evidence_role IN ('support','opposition','neutral','conditional','unclear')),
  evidence_strength TEXT NOT NULL CHECK(evidence_strength IN ('strong','mixed','weak','conflicting','unknown')),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  relevance_score REAL CHECK(relevance_score IS NULL OR relevance_score BETWEEN 0 AND 1),
  semantic_score REAL CHECK(semantic_score IS NULL OR semantic_score BETWEEN 0 AND 1),
  lexical_score REAL CHECK(lexical_score IS NULL OR lexical_score BETWEEN 0 AND 1),
  recency_score REAL CHECK(recency_score IS NULL OR recency_score BETWEEN 0 AND 1),
  final_score REAL CHECK(final_score IS NULL OR final_score BETWEEN 0 AND 1),
  quote_preview TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_evidence_pointers_target ON evidence_pointers(target_type, target_id);
CREATE INDEX idx_evidence_pointers_source ON evidence_pointers(source_pointer_uri);
CREATE INDEX idx_evidence_pointers_span ON evidence_pointers(transcript_id, span_id);
CREATE INDEX idx_evidence_pointers_role ON evidence_pointers(evidence_role);
CREATE INDEX idx_evidence_pointers_strength ON evidence_pointers(evidence_strength);

CREATE TRIGGER evidence_pointers_source_consistency
BEFORE INSERT ON evidence_pointers
WHEN NOT EXISTS (
  SELECT 1 FROM source_pointers
  WHERE pointer_uri=NEW.source_pointer_uri
    AND transcript_id=NEW.transcript_id AND span_id=NEW.span_id
)
BEGIN
  SELECT RAISE(ABORT, 'evidence pointer does not match source pointer');
END;

CREATE TABLE answer_claims (
  answer_claim_id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL REFERENCES ai_answers(id) ON DELETE CASCADE,
  claim_text TEXT NOT NULL,
  claim_order INTEGER NOT NULL CHECK(claim_order >= 0),
  support_status TEXT NOT NULL CHECK(support_status IN ('supported','weakly_supported','conflicted','unsupported','unclear')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(answer_id, claim_order)
);
CREATE INDEX answer_claims_answer_idx ON answer_claims(answer_id);
CREATE INDEX answer_claims_status_idx ON answer_claims(support_status);

CREATE TABLE citation_links (
  citation_link_id TEXT PRIMARY KEY,
  answer_id TEXT REFERENCES ai_answers(id) ON DELETE CASCADE,
  answer_claim_id TEXT REFERENCES answer_claims(answer_claim_id) ON DELETE CASCADE,
  evidence_pointer_id TEXT NOT NULL REFERENCES evidence_pointers(evidence_pointer_id) ON DELETE CASCADE,
  citation_label TEXT NOT NULL,
  citation_order INTEGER NOT NULL CHECK(citation_order >= 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(answer_id, citation_order),
  UNIQUE(answer_id, evidence_pointer_id)
);
CREATE INDEX citation_links_answer_idx ON citation_links(answer_id);
CREATE INDEX citation_links_claim_idx ON citation_links(answer_claim_id);
CREATE INDEX citation_links_evidence_idx ON citation_links(evidence_pointer_id);

CREATE TRIGGER evidence_pointers_cleanup_memory
AFTER DELETE ON evidence_pointers
WHEN OLD.target_type IN ('memory_object','claim','summary')
BEGIN
  UPDATE memory_objects
  SET status='needs_review', updated_at=CURRENT_TIMESTAMP
  WHERE id=OLD.target_id AND status='active'
    AND NOT EXISTS (
      SELECT 1 FROM evidence_pointers
      WHERE target_type IN ('memory_object','claim','summary') AND target_id=OLD.target_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM memory_object_evidence WHERE memory_id=OLD.target_id
    );
END;

CREATE TRIGGER answer_claims_supported_requires_evidence
BEFORE UPDATE OF support_status ON answer_claims
WHEN NEW.support_status='supported'
  AND NOT EXISTS (
    SELECT 1 FROM evidence_pointers
    WHERE target_type='answer_claim' AND target_id=NEW.answer_claim_id
      AND evidence_role='support' AND evidence_strength IN ('strong','mixed')
  )
BEGIN
  SELECT RAISE(ABORT, 'supported answer claims require support evidence');
END;

CREATE TRIGGER evidence_pointers_cleanup_answer_claim
AFTER DELETE ON evidence_pointers
WHEN OLD.target_type='answer_claim'
BEGIN
  UPDATE answer_claims
  SET support_status = CASE
    WHEN EXISTS (SELECT 1 FROM evidence_pointers WHERE target_type='answer_claim' AND target_id=OLD.target_id AND evidence_role='support')
      AND EXISTS (SELECT 1 FROM evidence_pointers WHERE target_type='answer_claim' AND target_id=OLD.target_id AND evidence_role='opposition')
      THEN 'conflicted'
    WHEN EXISTS (SELECT 1 FROM evidence_pointers WHERE target_type='answer_claim' AND target_id=OLD.target_id AND evidence_role='support' AND evidence_strength IN ('strong','mixed'))
      THEN 'supported'
    WHEN EXISTS (SELECT 1 FROM evidence_pointers WHERE target_type='answer_claim' AND target_id=OLD.target_id AND evidence_role='support')
      THEN 'weakly_supported'
    WHEN EXISTS (SELECT 1 FROM evidence_pointers WHERE target_type='answer_claim' AND target_id=OLD.target_id)
      THEN 'unclear'
    ELSE 'unsupported'
  END
  WHERE answer_claim_id=OLD.target_id;
END;

INSERT OR REPLACE INTO app_meta(key, value_json, updated_at)
VALUES ('schema_version', '"004"', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
