import type { SqliteDatabase } from "../connection.js";
import { createId } from "../ids.js";
import type { EmbeddingRecord, JsonObject, SearchDocument, SearchDocumentType } from "../schema.js";
import { json, now, parseRow, parseRows } from "../utils.js";

export interface UpsertSearchDocumentInput { id?: string; doc_type: SearchDocumentType; ref_id: string; search_text: string; language?: string | null; metadata?: JsonObject; }
export interface CreateEmbeddingRecordInput { id?: string; doc_type: SearchDocumentType; ref_id: string; embedding_model: string; embedding_dim: number; embedding_storage_uri?: string | null; embedding?: number[] | null; content_hash: string; created_run_id?: string | null; metadata?: JsonObject; }

export function createSearchRepo(db: SqliteDatabase) {
  const getSearchDocument = (docType: SearchDocumentType, refId: string) => parseRow<SearchDocument | null>(db.prepare("SELECT * FROM search_documents WHERE doc_type = ? AND ref_id = ?").get(docType, refId));
  return {
    upsertSearchDocument(input: UpsertSearchDocumentInput): SearchDocument {
      const existing = getSearchDocument(input.doc_type, input.ref_id), timestamp = now();
      const row = { id: existing?.id ?? input.id ?? createId("doc_"), doc_type: input.doc_type, ref_id: input.ref_id, search_text: input.search_text, language: input.language ?? null, created_at: existing?.created_at ?? timestamp, updated_at: timestamp, metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO search_documents(id,doc_type,ref_id,search_text,language,created_at,updated_at,metadata_json)
        VALUES (@id,@doc_type,@ref_id,@search_text,@language,@created_at,@updated_at,@metadata_json)
        ON CONFLICT(doc_type,ref_id) DO UPDATE SET search_text=excluded.search_text,language=excluded.language,updated_at=excluded.updated_at,metadata_json=excluded.metadata_json`).run(row);
      return getSearchDocument(input.doc_type, input.ref_id)!;
    },
    getSearchDocument,
    searchKeyword(query: string, limit = 20): SearchDocument[] {
      try {
        return parseRows<SearchDocument>(db.prepare(`SELECT d.* FROM search_documents_fts f JOIN search_documents d ON d.rowid=f.rowid WHERE search_documents_fts MATCH ? ORDER BY bm25(search_documents_fts) LIMIT ?`).all(query, limit));
      } catch {
        return parseRows<SearchDocument>(db.prepare("SELECT * FROM search_documents WHERE search_text LIKE ? ORDER BY updated_at DESC LIMIT ?").all(`%${query}%`, limit));
      }
    },
    createEmbeddingRecord(input: CreateEmbeddingRecordInput): EmbeddingRecord {
      const row = { id: input.id ?? createId("emb_"), doc_type: input.doc_type, ref_id: input.ref_id, embedding_model: input.embedding_model, embedding_dim: input.embedding_dim, embedding_storage_uri: input.embedding_storage_uri ?? null, embedding_json: input.embedding == null ? null : json(input.embedding), content_hash: input.content_hash, created_run_id: input.created_run_id ?? null, created_at: now(), metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO embedding_records(id,doc_type,ref_id,embedding_model,embedding_dim,embedding_storage_uri,embedding_json,content_hash,created_run_id,created_at,metadata_json)
        VALUES (@id,@doc_type,@ref_id,@embedding_model,@embedding_dim,@embedding_storage_uri,@embedding_json,@content_hash,@created_run_id,@created_at,@metadata_json)`).run(row);
      return parseRow<EmbeddingRecord>(db.prepare("SELECT * FROM embedding_records WHERE id = ?").get(row.id));
    },
    getEmbeddingRecord(docType: SearchDocumentType, refId: string, model: string, hash: string): EmbeddingRecord | null {
      return parseRow<EmbeddingRecord | null>(db.prepare("SELECT * FROM embedding_records WHERE doc_type = ? AND ref_id = ? AND embedding_model = ? AND content_hash = ?").get(docType, refId, model, hash));
    },
  };
}
