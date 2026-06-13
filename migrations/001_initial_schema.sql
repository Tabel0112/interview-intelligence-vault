CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transcript_sources (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('imported_file','pasted_text','external_reference')),
  original_filename TEXT,
  raw_storage_uri TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length >= 0),
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS transcript_sources_content_hash_uq ON transcript_sources(content_hash);

CREATE TABLE IF NOT EXISTS transcripts (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES transcript_sources(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  language TEXT,
  status TEXT NOT NULL CHECK(status IN ('imported','chunked','processed','failed')),
  content_hash TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS transcripts_source_id_idx ON transcripts(source_id);
CREATE INDEX IF NOT EXISTS transcripts_status_idx ON transcripts(status);
CREATE INDEX IF NOT EXISTS transcripts_content_hash_idx ON transcripts(content_hash);

CREATE TRIGGER IF NOT EXISTS transcript_sources_immutable_update
BEFORE UPDATE ON transcript_sources BEGIN
  SELECT RAISE(ABORT, 'raw transcript sources are immutable');
END;
CREATE TRIGGER IF NOT EXISTS transcripts_raw_fields_immutable
BEFORE UPDATE OF source_id, title, language, content_hash, imported_at ON transcripts BEGIN
  SELECT RAISE(ABORT, 'raw transcript identity is immutable');
END;

CREATE TABLE IF NOT EXISTS transcript_speakers (
  id TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  speaker_label TEXT NOT NULL,
  display_name TEXT,
  canonical_entity_id TEXT,
  confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(transcript_id, speaker_label)
);
CREATE INDEX IF NOT EXISTS transcript_speakers_transcript_idx ON transcript_speakers(transcript_id);
CREATE INDEX IF NOT EXISTS transcript_speakers_label_idx ON transcript_speakers(speaker_label);
CREATE INDEX IF NOT EXISTS transcript_speakers_entity_idx ON transcript_speakers(canonical_entity_id);

CREATE TABLE IF NOT EXISTS transcript_spans (
  id TEXT PRIMARY KEY,
  transcript_id TEXT NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES transcript_sources(id) ON DELETE RESTRICT,
  speaker_id TEXT REFERENCES transcript_speakers(id) ON DELETE SET NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  start_char INTEGER NOT NULL CHECK(start_char >= 0),
  end_char INTEGER NOT NULL CHECK(end_char > start_char),
  start_time_ms INTEGER,
  end_time_ms INTEGER,
  text_preview TEXT NOT NULL CHECK(length(text_preview) <= 500),
  text_hash TEXT NOT NULL,
  topic_hint TEXT,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(transcript_id, ordinal)
);
CREATE INDEX IF NOT EXISTS transcript_spans_transcript_idx ON transcript_spans(transcript_id);
CREATE INDEX IF NOT EXISTS transcript_spans_order_idx ON transcript_spans(transcript_id, ordinal);
CREATE INDEX IF NOT EXISTS transcript_spans_offsets_idx ON transcript_spans(transcript_id, start_char, end_char);
CREATE INDEX IF NOT EXISTS transcript_spans_speaker_idx ON transcript_spans(speaker_id);
CREATE INDEX IF NOT EXISTS transcript_spans_hash_idx ON transcript_spans(text_hash);

CREATE TABLE IF NOT EXISTS processing_runs (
  id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL CHECK(run_type IN ('ingestion','chunking','extraction','embedding','retrieval','answering','graph_building','correction','reprocessing')),
  status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  model_name TEXT,
  agent_name TEXT,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS processing_runs_type_idx ON processing_runs(run_type);
CREATE INDEX IF NOT EXISTS processing_runs_status_idx ON processing_runs(status);
CREATE INDEX IF NOT EXISTS processing_runs_started_idx ON processing_runs(started_at);

CREATE TABLE IF NOT EXISTS memory_objects (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('claim','topic','person','question','decision','task','preference','event','concept','quote','summary')),
  title TEXT,
  generated_text TEXT NOT NULL,
  normalized_text TEXT,
  status TEXT NOT NULL CHECK(status IN ('active','needs_review','rejected','superseded')),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  created_by TEXT NOT NULL CHECK(created_by IN ('agent','user','system')),
  created_run_id TEXT REFERENCES processing_runs(id) ON DELETE SET NULL,
  supersedes_memory_id TEXT REFERENCES memory_objects(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS memory_objects_type_idx ON memory_objects(type);
CREATE INDEX IF NOT EXISTS memory_objects_status_idx ON memory_objects(status);
CREATE INDEX IF NOT EXISTS memory_objects_confidence_idx ON memory_objects(confidence);
CREATE INDEX IF NOT EXISTS memory_objects_run_idx ON memory_objects(created_run_id);
CREATE INDEX IF NOT EXISTS memory_objects_normalized_idx ON memory_objects(normalized_text);

CREATE TABLE IF NOT EXISTS memory_object_evidence (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL REFERENCES memory_objects(id) ON DELETE CASCADE,
  span_id TEXT NOT NULL REFERENCES transcript_spans(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK(role IN ('supports','contradicts','qualifies','source','context')),
  evidence_score REAL NOT NULL CHECK(evidence_score BETWEEN 0 AND 1),
  explanation TEXT,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(memory_id, span_id, role)
);
CREATE INDEX IF NOT EXISTS memory_evidence_memory_idx ON memory_object_evidence(memory_id);
CREATE INDEX IF NOT EXISTS memory_evidence_span_idx ON memory_object_evidence(span_id);
CREATE INDEX IF NOT EXISTS memory_evidence_role_idx ON memory_object_evidence(role);
CREATE INDEX IF NOT EXISTS memory_evidence_score_idx ON memory_object_evidence(evidence_score);

CREATE TABLE IF NOT EXISTS evidence_bundles (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK(purpose IN ('ask_ai','memory_extraction','graph_edge','correction_review','reprocessing')),
  query_text TEXT,
  query_embedding_model TEXT,
  created_run_id TEXT REFERENCES processing_runs(id) ON DELETE SET NULL,
  overall_score REAL CHECK(overall_score IS NULL OR overall_score BETWEEN 0 AND 1),
  status TEXT NOT NULL CHECK(status IN ('strong','mixed','weak','conflicting','needs_review')),
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS evidence_bundles_purpose_idx ON evidence_bundles(purpose);
CREATE INDEX IF NOT EXISTS evidence_bundles_status_idx ON evidence_bundles(status);
CREATE INDEX IF NOT EXISTS evidence_bundles_score_idx ON evidence_bundles(overall_score);
CREATE INDEX IF NOT EXISTS evidence_bundles_run_idx ON evidence_bundles(created_run_id);

CREATE TABLE IF NOT EXISTS evidence_items (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES evidence_bundles(id) ON DELETE CASCADE,
  span_id TEXT NOT NULL REFERENCES transcript_spans(id) ON DELETE RESTRICT,
  memory_id TEXT REFERENCES memory_objects(id) ON DELETE SET NULL,
  retrieval_rank INTEGER,
  vector_score REAL CHECK(vector_score IS NULL OR vector_score BETWEEN 0 AND 1),
  keyword_score REAL CHECK(keyword_score IS NULL OR keyword_score BETWEEN 0 AND 1),
  recency_score REAL CHECK(recency_score IS NULL OR recency_score BETWEEN 0 AND 1),
  speaker_score REAL CHECK(speaker_score IS NULL OR speaker_score BETWEEN 0 AND 1),
  rerank_score REAL CHECK(rerank_score IS NULL OR rerank_score BETWEEN 0 AND 1),
  final_score REAL NOT NULL CHECK(final_score BETWEEN 0 AND 1),
  stance TEXT NOT NULL CHECK(stance IN ('supports','contradicts','qualifies','background','unknown')),
  reason TEXT,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS evidence_items_bundle_idx ON evidence_items(bundle_id);
CREATE INDEX IF NOT EXISTS evidence_items_span_idx ON evidence_items(span_id);
CREATE INDEX IF NOT EXISTS evidence_items_memory_idx ON evidence_items(memory_id);
CREATE INDEX IF NOT EXISTS evidence_items_score_idx ON evidence_items(final_score);
CREATE INDEX IF NOT EXISTS evidence_items_stance_idx ON evidence_items(stance);
CREATE INDEX IF NOT EXISTS evidence_items_rank_idx ON evidence_items(retrieval_rank);

CREATE TABLE IF NOT EXISTS ai_answers (
  id TEXT PRIMARY KEY,
  question_text TEXT NOT NULL,
  answer_text TEXT NOT NULL,
  evidence_bundle_id TEXT NOT NULL REFERENCES evidence_bundles(id) ON DELETE RESTRICT,
  confidence TEXT NOT NULL CHECK(confidence IN ('high','medium','low')),
  answer_status TEXT NOT NULL CHECK(answer_status IN ('answered','weak_evidence','conflicting_evidence','refused_no_evidence')),
  model_name TEXT,
  created_run_id TEXT REFERENCES processing_runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ai_answers_created_idx ON ai_answers(created_at);
CREATE INDEX IF NOT EXISTS ai_answers_confidence_idx ON ai_answers(confidence);
CREATE INDEX IF NOT EXISTS ai_answers_status_idx ON ai_answers(answer_status);
CREATE INDEX IF NOT EXISTS ai_answers_bundle_idx ON ai_answers(evidence_bundle_id);

CREATE TABLE IF NOT EXISTS ai_answer_citations (
  id TEXT PRIMARY KEY,
  answer_id TEXT NOT NULL REFERENCES ai_answers(id) ON DELETE CASCADE,
  evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id) ON DELETE RESTRICT,
  citation_order INTEGER NOT NULL,
  quoted_text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS answer_citations_answer_idx ON ai_answer_citations(answer_id);
CREATE INDEX IF NOT EXISTS answer_citations_item_idx ON ai_answer_citations(evidence_item_id);
CREATE INDEX IF NOT EXISTS answer_citations_order_idx ON ai_answer_citations(answer_id, citation_order);

CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL CHECK(node_type IN ('memory_object','entity','topic','transcript','span')),
  ref_id TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(node_type, ref_id)
);
CREATE INDEX IF NOT EXISTS graph_nodes_type_idx ON graph_nodes(node_type);
CREATE INDEX IF NOT EXISTS graph_nodes_ref_idx ON graph_nodes(ref_id);
CREATE INDEX IF NOT EXISTS graph_nodes_label_idx ON graph_nodes(label);

CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY,
  from_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL CHECK(edge_type IN ('related_to','supports','contradicts','qualifies','updates','mentions','derived_from','same_as')),
  source_type TEXT NOT NULL CHECK(source_type IN ('source_backed','inferred','user_confirmed')),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  evidence_bundle_id TEXT REFERENCES evidence_bundles(id) ON DELETE SET NULL,
  created_run_id TEXT REFERENCES processing_runs(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('active','needs_review','rejected')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(from_node_id, to_node_id, edge_type)
);
CREATE INDEX IF NOT EXISTS graph_edges_from_idx ON graph_edges(from_node_id);
CREATE INDEX IF NOT EXISTS graph_edges_to_idx ON graph_edges(to_node_id);
CREATE INDEX IF NOT EXISTS graph_edges_type_idx ON graph_edges(edge_type);
CREATE INDEX IF NOT EXISTS graph_edges_source_idx ON graph_edges(source_type);
CREATE INDEX IF NOT EXISTS graph_edges_status_idx ON graph_edges(status);
CREATE INDEX IF NOT EXISTS graph_edges_confidence_idx ON graph_edges(confidence);
CREATE INDEX IF NOT EXISTS graph_edges_bundle_idx ON graph_edges(evidence_bundle_id);

CREATE TABLE IF NOT EXISTS user_corrections (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK(target_type IN ('memory_object','graph_edge','speaker','answer','span','transcript')),
  target_id TEXT NOT NULL,
  correction_type TEXT NOT NULL CHECK(correction_type IN ('edit','reject','confirm','merge','unmerge','mark_conflict','resolve_conflict','rename')),
  old_value_json TEXT,
  new_value_json TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'user',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS corrections_target_type_idx ON user_corrections(target_type);
CREATE INDEX IF NOT EXISTS corrections_target_id_idx ON user_corrections(target_id);
CREATE INDEX IF NOT EXISTS corrections_type_idx ON user_corrections(correction_type);
CREATE INDEX IF NOT EXISTS corrections_created_idx ON user_corrections(created_at);

CREATE TRIGGER IF NOT EXISTS user_corrections_append_only_update
BEFORE UPDATE ON user_corrections BEGIN SELECT RAISE(ABORT, 'corrections are append-only'); END;
CREATE TRIGGER IF NOT EXISTS user_corrections_append_only_delete
BEFORE DELETE ON user_corrections BEGIN SELECT RAISE(ABORT, 'corrections are append-only'); END;

CREATE TABLE IF NOT EXISTS search_documents (
  id TEXT PRIMARY KEY,
  doc_type TEXT NOT NULL CHECK(doc_type IN ('span','memory_object','answer','graph_node')),
  ref_id TEXT NOT NULL,
  search_text TEXT NOT NULL,
  language TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(doc_type, ref_id)
);
CREATE INDEX IF NOT EXISTS search_documents_type_idx ON search_documents(doc_type);
CREATE INDEX IF NOT EXISTS search_documents_ref_idx ON search_documents(ref_id);
CREATE INDEX IF NOT EXISTS search_documents_language_idx ON search_documents(language);

CREATE TABLE IF NOT EXISTS embedding_records (
  id TEXT PRIMARY KEY,
  doc_type TEXT NOT NULL CHECK(doc_type IN ('span','memory_object','answer','graph_node')),
  ref_id TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL CHECK(embedding_dim > 0),
  embedding_storage_uri TEXT,
  embedding_json TEXT,
  content_hash TEXT NOT NULL,
  created_run_id TEXT REFERENCES processing_runs(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(doc_type, ref_id, embedding_model, content_hash)
);
CREATE INDEX IF NOT EXISTS embeddings_type_idx ON embedding_records(doc_type);
CREATE INDEX IF NOT EXISTS embeddings_ref_idx ON embedding_records(ref_id);
CREATE INDEX IF NOT EXISTS embeddings_model_idx ON embedding_records(embedding_model);
CREATE INDEX IF NOT EXISTS embeddings_hash_idx ON embedding_records(content_hash);

INSERT OR REPLACE INTO app_meta(key, value_json, updated_at)
VALUES ('schema_version', '"001"', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
