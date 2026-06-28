CREATE TABLE search_embeddings (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK(target_type IN ('transcript_span','memory_object','evidence_pointer')),
  target_id TEXT NOT NULL,
  embedding_provider TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL CHECK(embedding_dim > 0),
  content_hash TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(target_type,target_id,embedding_provider,embedding_model)
);
CREATE INDEX search_embeddings_target_idx ON search_embeddings(target_type,target_id);
CREATE INDEX search_embeddings_provider_model_idx ON search_embeddings(embedding_provider,embedding_model);

CREATE TABLE retrieval_index_status (
  target_type TEXT NOT NULL CHECK(target_type IN ('transcript_span','memory_object','evidence_pointer')),
  target_id TEXT NOT NULL,
  indexed_hash TEXT NOT NULL,
  keyword_indexed_at TEXT,
  embedding_indexed_at TEXT,
  embedding_provider TEXT,
  embedding_model TEXT,
  error TEXT,
  PRIMARY KEY(target_type,target_id)
);

CREATE TABLE retrieval_documents (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK(target_type IN ('transcript_span','memory_object','evidence_pointer')),
  target_id TEXT NOT NULL,
  transcript_id TEXT,
  source_id TEXT,
  speaker_id TEXT,
  speaker_name TEXT,
  memory_type TEXT,
  memory_status TEXT,
  title TEXT,
  search_text TEXT NOT NULL,
  topic_text TEXT,
  created_at TEXT,
  updated_at TEXT,
  evidence_score REAL NOT NULL DEFAULT 0.5 CHECK(evidence_score BETWEEN 0 AND 1),
  support_role TEXT NOT NULL DEFAULT 'unknown' CHECK(support_role IN ('supporting','opposing','mixed','unknown')),
  evidence_pointer_ids_json TEXT NOT NULL DEFAULT '[]',
  source_pointer_ids_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,
  UNIQUE(target_type,target_id)
);
CREATE INDEX retrieval_documents_target_idx ON retrieval_documents(target_type,target_id);
CREATE INDEX retrieval_documents_transcript_idx ON retrieval_documents(transcript_id);
CREATE INDEX retrieval_documents_source_idx ON retrieval_documents(source_id);
CREATE INDEX retrieval_documents_speaker_idx ON retrieval_documents(speaker_id,speaker_name);
CREATE INDEX retrieval_documents_memory_idx ON retrieval_documents(memory_type,memory_status);
CREATE INDEX retrieval_documents_created_idx ON retrieval_documents(created_at);
CREATE INDEX retrieval_documents_updated_idx ON retrieval_documents(updated_at);

CREATE TRIGGER retrieval_cleanup_span AFTER DELETE ON transcript_spans BEGIN
  DELETE FROM retrieval_documents WHERE target_type='transcript_span' AND target_id=OLD.id;
  DELETE FROM search_embeddings WHERE target_type='transcript_span' AND target_id=OLD.id;
  DELETE FROM retrieval_index_status WHERE target_type='transcript_span' AND target_id=OLD.id;
END;
CREATE TRIGGER retrieval_cleanup_memory AFTER DELETE ON memory_objects BEGIN
  DELETE FROM retrieval_documents WHERE target_type='memory_object' AND target_id=OLD.id;
  DELETE FROM search_embeddings WHERE target_type='memory_object' AND target_id=OLD.id;
  DELETE FROM retrieval_index_status WHERE target_type='memory_object' AND target_id=OLD.id;
END;
CREATE TRIGGER retrieval_cleanup_evidence AFTER DELETE ON evidence_pointers BEGIN
  DELETE FROM retrieval_documents WHERE target_type='evidence_pointer' AND target_id=OLD.evidence_pointer_id;
  DELETE FROM search_embeddings WHERE target_type='evidence_pointer' AND target_id=OLD.evidence_pointer_id;
  DELETE FROM retrieval_index_status WHERE target_type='evidence_pointer' AND target_id=OLD.evidence_pointer_id;
END;

INSERT OR REPLACE INTO app_meta(key,value_json,updated_at)
VALUES ('schema_version','"007"',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
