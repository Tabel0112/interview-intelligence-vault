import type { SqliteDatabase } from "../db/connection.js";
import { NotFoundError } from "../db/errors.js";
import { contentHash } from "../db/ids.js";
import { createMemoryObjectsRepo } from "../db/repositories/memoryObjectsRepo.js";
import { isStrongMemoryObject } from "../memory/canonical.js";
import type { EvidencePointer } from "../provenance/types.js";
import { storeEmbeddingVector, upsertEmbedding, validateVector } from "./embeddingStore.js";
import type { RetrievalIndexOptions, RetrievalTargetType, SupportRole } from "./types.js";

interface IndexDocument {
  targetType: RetrievalTargetType; targetId: string; transcriptId: string | null; sourceId: string | null;
  speakerId: string | null; speakerName: string | null; memoryType: string | null; memoryStatus: string | null;
  title: string | null; text: string; topicText: string | null; createdAt: string | null; updatedAt: string | null;
  evidenceScore: number; supportRole: SupportRole; evidencePointerIds: string[]; sourcePointerIds: string[];
}

function pointerMetadata(db: SqliteDatabase, targetType: string, targetId: string) {
  const rows = db.prepare(`SELECT evidence_pointer_id,source_pointer_uri,transcript_id,evidence_role,evidence_strength,confidence,final_score
    FROM evidence_pointers WHERE target_type=? AND target_id=? ORDER BY evidence_pointer_id`).all(targetType, targetId) as Array<EvidencePointer & { source_pointer_uri: string }>;
  const support = rows.some((row) => row.evidence_role === "support"), opposition = rows.some((row) => row.evidence_role === "opposition");
  const supportRole: SupportRole = support && opposition ? "mixed" : opposition ? "opposing" : support ? "supporting" : "unknown";
  return {
    rows, supportRole, evidenceScore: rows.length ? Math.max(...rows.map((row) => row.final_score ?? row.confidence)) : 0.5,
    evidencePointerIds: rows.map((row) => row.evidence_pointer_id), sourcePointerIds: rows.map((row) => row.source_pointer_uri),
  };
}

function spanDocument(db: SqliteDatabase, spanId: string): IndexDocument {
  const row = db.prepare(`SELECT s.id,s.transcript_id,s.source_id,s.speaker_id,s.speaker_label,s.text,s.created_at,t.updated_at
    FROM transcript_spans s JOIN transcripts t ON t.id=s.transcript_id WHERE s.id=?`).get(spanId) as Record<string, string | null> | undefined;
  if (!row) throw new NotFoundError(`Transcript span not found: ${spanId}`);
  const pointers = db.prepare("SELECT pointer_uri FROM source_pointers WHERE span_id=?").all(spanId) as Array<{ pointer_uri: string }>;
  const evidence = db.prepare("SELECT evidence_pointer_id,evidence_role,confidence,final_score FROM evidence_pointers WHERE span_id=?").all(spanId) as Array<{ evidence_pointer_id: string; evidence_role: string; confidence: number; final_score: number | null }>;
  const opposition = evidence.some((item) => item.evidence_role === "opposition"), support = evidence.some((item) => item.evidence_role === "support");
  return { targetType: "transcript_span", targetId: spanId, transcriptId: row.transcript_id, sourceId: row.source_id, speakerId: row.speaker_id, speakerName: row.speaker_label, memoryType: null, memoryStatus: null, title: null, text: row.text!, topicText: null, createdAt: row.created_at, updatedAt: row.updated_at, evidenceScore: evidence.length ? Math.max(...evidence.map((item) => item.final_score ?? item.confidence)) : 0.5, supportRole: support && opposition ? "mixed" : opposition ? "opposing" : support ? "supporting" : "unknown", evidencePointerIds: evidence.map((item) => item.evidence_pointer_id), sourcePointerIds: pointers.map((item) => item.pointer_uri) };
}

function memoryDocument(db: SqliteDatabase, id: string): IndexDocument {
  const raw = db.prepare("SELECT * FROM memory_objects WHERE id=?").get(id) as Record<string, string | number | null> | undefined;
  const canonical = createMemoryObjectsRepo(db).getCanonicalMemoryObject(id);
  if (!raw || !canonical) throw new NotFoundError(`Memory object not found: ${id}`);
  const pointer = pointerMetadata(db, "memory_object", id);
  const legacyEvidence = db.prepare(`SELECT e.span_id,s.transcript_id,s.source_id,s.speaker_id,s.speaker_label
    FROM memory_object_evidence e JOIN transcript_spans s ON s.id=e.span_id WHERE e.memory_id=?`).all(id) as Array<{ span_id: string; transcript_id: string; source_id: string; speaker_id: string | null; speaker_label: string | null }>;
  const transcriptId = pointer.rows[0]?.transcript_id ?? legacyEvidence[0]?.transcript_id ?? null;
  const linkedSpan = legacyEvidence[0] ?? (db.prepare(`SELECT s.transcript_id,s.source_id,s.speaker_id,s.speaker_label
    FROM evidence_pointers e JOIN transcript_spans s ON s.id=e.span_id WHERE e.target_type='memory_object' AND e.target_id=? LIMIT 1`).get(id) as { transcript_id: string; source_id: string; speaker_id: string | null; speaker_label: string | null } | undefined);
  const sourcePointers = db.prepare(`SELECT sp.pointer_uri FROM source_pointers sp WHERE sp.span_id IN (SELECT span_id FROM memory_object_evidence WHERE memory_id=?)`).all(id) as Array<{ pointer_uri: string }>;
  const evidencePointerIds = pointer.evidencePointerIds;
  return { targetType: "memory_object", targetId: id, transcriptId, sourceId: linkedSpan?.source_id ?? null, speakerId: linkedSpan?.speaker_id ?? null, speakerName: linkedSpan?.speaker_label ?? null, memoryType: canonical.type, memoryStatus: canonical.status, title: canonical.title, text: canonical.body, topicText: canonical.type === "topic" ? canonical.title : null, createdAt: String(raw.created_at), updatedAt: String(raw.updated_at), evidenceScore: isStrongMemoryObject(canonical) ? canonical.confidence : Math.min(canonical.confidence, 0.45), supportRole: pointer.supportRole, evidencePointerIds: [...evidencePointerIds], sourcePointerIds: [...new Set([...pointer.sourcePointerIds, ...sourcePointers.map((item) => item.pointer_uri)])] };
}

function evidenceDocument(db: SqliteDatabase, id: string): IndexDocument {
  const row = db.prepare("SELECT * FROM evidence_pointers WHERE evidence_pointer_id=?").get(id) as EvidencePointer | undefined;
  if (!row) throw new NotFoundError(`Evidence pointer not found: ${id}`);
  const span = db.prepare("SELECT source_id,speaker_id,speaker_label FROM transcript_spans WHERE id=?").get(row.span_id) as { source_id: string; speaker_id: string | null; speaker_label: string | null };
  return { targetType: "evidence_pointer", targetId: id, transcriptId: row.transcript_id, sourceId: span.source_id, speakerId: span.speaker_id, speakerName: span.speaker_label, memoryType: null, memoryStatus: null, title: null, text: row.quote_preview, topicText: null, createdAt: row.created_at, updatedAt: row.created_at, evidenceScore: row.final_score ?? row.confidence, supportRole: row.evidence_role === "support" ? "supporting" : row.evidence_role === "opposition" ? "opposing" : "unknown", evidencePointerIds: [id], sourcePointerIds: [row.source_pointer_uri] };
}

function getDocument(db: SqliteDatabase, type: RetrievalTargetType, id: string): IndexDocument {
  return type === "transcript_span" ? spanDocument(db, id) : type === "memory_object" ? memoryDocument(db, id) : evidenceDocument(db, id);
}

async function indexDocument(db: SqliteDatabase, type: RetrievalTargetType, id: string, options: RetrievalIndexOptions = {}): Promise<{ embedded: boolean; skipped: boolean }> {
  try {
    const doc = getDocument(db, type, id);
    const text = `${doc.title ?? ""}\n${doc.text}`.trim(), embeddingHash = contentHash(text);
    const hash = contentHash(JSON.stringify({ text, transcriptId: doc.transcriptId, sourceId: doc.sourceId, speakerId: doc.speakerId, speakerName: doc.speakerName, memoryType: doc.memoryType, memoryStatus: doc.memoryStatus, evidenceScore: doc.evidenceScore, supportRole: doc.supportRole, evidencePointerIds: doc.evidencePointerIds, sourcePointerIds: doc.sourcePointerIds }));
    const timestamp = new Date().toISOString();
    const previous = db.prepare("SELECT indexed_hash FROM retrieval_index_status WHERE target_type=? AND target_id=?").get(type, id) as { indexed_hash: string } | undefined;
    const skipped = previous?.indexed_hash === hash && !options.force;
    if (!skipped) {
      db.prepare(`INSERT INTO retrieval_documents(id,target_type,target_id,transcript_id,source_id,speaker_id,speaker_name,memory_type,memory_status,title,search_text,topic_text,created_at,updated_at,evidence_score,support_role,evidence_pointer_ids_json,source_pointer_ids_json,content_hash)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(target_type,target_id) DO UPDATE SET transcript_id=excluded.transcript_id,source_id=excluded.source_id,speaker_id=excluded.speaker_id,speaker_name=excluded.speaker_name,memory_type=excluded.memory_type,memory_status=excluded.memory_status,title=excluded.title,search_text=excluded.search_text,topic_text=excluded.topic_text,created_at=excluded.created_at,updated_at=excluded.updated_at,evidence_score=excluded.evidence_score,support_role=excluded.support_role,evidence_pointer_ids_json=excluded.evidence_pointer_ids_json,source_pointer_ids_json=excluded.source_pointer_ids_json,content_hash=excluded.content_hash`)
        .run(`${type}:${id}`, type, id, doc.transcriptId, doc.sourceId, doc.speakerId, doc.speakerName, doc.memoryType, doc.memoryStatus, doc.title, doc.text, doc.topicText, doc.createdAt, doc.updatedAt, doc.evidenceScore, doc.supportRole, JSON.stringify(doc.evidencePointerIds), JSON.stringify(doc.sourcePointerIds), hash);
      try {
        db.prepare("DELETE FROM retrieval_documents_fts WHERE target_type=? AND target_id=?").run(type, id);
        db.prepare("INSERT INTO retrieval_documents_fts(target_type,target_id,title,search_text,speaker_name,topic_text) VALUES (?,?,?,?,?,?)").run(type, id, doc.title, doc.text, doc.speakerName, doc.topicText);
      } catch { /* FTS5 unavailable. */ }
    }
    const embedded = options.embeddingProvider ? await upsertEmbedding(db, { targetType: type, targetId: id, text, contentHash: embeddingHash, provider: options.embeddingProvider }) : false;
    db.prepare(`INSERT INTO retrieval_index_status(target_type,target_id,indexed_hash,keyword_indexed_at,embedding_indexed_at,embedding_provider,embedding_model,error)
      VALUES (?,?,?,?,?,?,?,NULL)
      ON CONFLICT(target_type,target_id) DO UPDATE SET indexed_hash=excluded.indexed_hash,keyword_indexed_at=excluded.keyword_indexed_at,embedding_indexed_at=COALESCE(excluded.embedding_indexed_at,retrieval_index_status.embedding_indexed_at),embedding_provider=COALESCE(excluded.embedding_provider,retrieval_index_status.embedding_provider),embedding_model=COALESCE(excluded.embedding_model,retrieval_index_status.embedding_model),error=NULL`)
      .run(type, id, hash, timestamp, embedded ? timestamp : null, options.embeddingProvider?.name ?? null, options.embeddingProvider?.model ?? null);
    return { embedded, skipped };
  } catch (error) {
    db.prepare(`INSERT INTO retrieval_index_status(target_type,target_id,indexed_hash,error) VALUES (?,?,'',?)
      ON CONFLICT(target_type,target_id) DO UPDATE SET error=excluded.error`).run(type, id, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

export const indexTranscriptSpanForSearch = (db: SqliteDatabase, spanId: string, options?: RetrievalIndexOptions) => indexDocument(db, "transcript_span", spanId, options);
export const indexMemoryObjectForSearch = (db: SqliteDatabase, id: string, options?: RetrievalIndexOptions) => indexDocument(db, "memory_object", id, options);
export const indexEvidencePointerForSearch = (db: SqliteDatabase, id: string, options?: RetrievalIndexOptions) => indexDocument(db, "evidence_pointer", id, options);

/**
 * Remove a target's local retrieval/index rows so it is no longer discoverable by search.
 * Idempotent (DELETEs are no-ops when nothing matches) and offline (no embedding call). Deleting the
 * retrieval_index_status row lets a later re-index recreate the document cleanly. FTS removal is
 * best-effort because FTS5 may be unavailable. Does NOT touch memory rows, evidence, or raw sources.
 */
export function removeRetrievalDocument(db: SqliteDatabase, targetType: RetrievalTargetType, targetId: string): void {
  try {
    db.prepare("DELETE FROM retrieval_documents_fts WHERE target_type=? AND target_id=?").run(targetType, targetId);
  } catch { /* FTS5 unavailable; the retrieval_documents JOIN drops any orphaned FTS row anyway. */ }
  db.prepare("DELETE FROM retrieval_documents WHERE target_type=? AND target_id=?").run(targetType, targetId);
  db.prepare("DELETE FROM search_embeddings WHERE target_type=? AND target_id=?").run(targetType, targetId);
  db.prepare("DELETE FROM retrieval_index_status WHERE target_type=? AND target_id=?").run(targetType, targetId);
}

export async function rebuildRetrievalIndex(db: SqliteDatabase, options: RetrievalIndexOptions = {}) {
  const types = options.targetTypes ?? ["transcript_span", "memory_object", "evidence_pointer"];
  let indexed = 0, skipped = 0, embedded = 0, errors = 0;
  const table: Record<RetrievalTargetType, [string, string]> = { transcript_span: ["transcript_spans", "id"], memory_object: ["memory_objects", "id"], evidence_pointer: ["evidence_pointers", "evidence_pointer_id"] };
  for (const type of types) {
    for (const row of db.prepare(`SELECT ${table[type][1]} id FROM ${table[type][0]}`).all() as Array<{ id: string }>) {
      try { const result = await indexDocument(db, type, row.id, { ...options, embeddingProvider: undefined }); result.skipped ? skipped++ : indexed++; } catch { errors++; }
    }
  }
  const provider = options.embeddingProvider;
  if (provider && provider.dimensions > 0) {
    const placeholders = types.map(() => "?").join(",");
    const documents = db.prepare(`SELECT target_type,target_id,title,search_text FROM retrieval_documents WHERE target_type IN (${placeholders})`).all(...types) as Array<{ target_type: RetrievalTargetType; target_id: string; title: string | null; search_text: string }>;
    const pending = documents.map((doc) => {
      const text = `${doc.title ?? ""}\n${doc.search_text}`.trim(), hash = contentHash(text);
      const existing = db.prepare(`SELECT content_hash FROM search_embeddings WHERE target_type=? AND target_id=? AND embedding_provider=? AND embedding_model=?`)
        .get(doc.target_type, doc.target_id, provider.name, provider.model) as { content_hash: string } | undefined;
      return existing?.content_hash === hash ? null : { ...doc, text, hash };
    }).filter((item) => item != null);
    const batchSize = Math.max(1, options.batchSize ?? 64);
    for (let start = 0; start < pending.length; start += batchSize) {
      const batch = pending.slice(start, start + batchSize);
      try {
        const vectors = await provider.embedTexts(batch.map((item) => item.text));
        if (vectors.length !== batch.length) throw new Error("Embedding provider returned the wrong batch size");
        vectors.forEach((vector, index) => {
          const item = batch[index];
          validateVector(vector, provider.dimensions);
          if (storeEmbeddingVector(db, { targetType: item.target_type, targetId: item.target_id, contentHash: item.hash, provider, vector })) embedded++;
          db.prepare(`UPDATE retrieval_index_status SET embedding_indexed_at=?,embedding_provider=?,embedding_model=?,error=NULL WHERE target_type=? AND target_id=?`)
            .run(new Date().toISOString(), provider.name, provider.model, item.target_type, item.target_id);
        });
      } catch (error) {
        errors += batch.length;
        for (const item of batch) db.prepare("UPDATE retrieval_index_status SET error=? WHERE target_type=? AND target_id=?")
          .run(error instanceof Error ? error.message : String(error), item.target_type, item.target_id);
      }
    }
  }
  return { indexed, skipped, embedded, errors };
}
