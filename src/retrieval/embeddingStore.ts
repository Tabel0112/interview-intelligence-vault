import type { SqliteDatabase } from "../db/connection.js";
import { ValidationError } from "../db/errors.js";
import { stableProvenanceId } from "../provenance/utils.js";
import type { EmbeddingProvider } from "./embeddingProvider.js";
import type { RetrievalTargetType } from "./types.js";

export function validateVector(vector: number[], dimensions: number): void {
  if (!vector.length || vector.length !== dimensions || vector.some((value) => !Number.isFinite(value))) {
    throw new ValidationError(`Invalid embedding vector; expected ${dimensions} finite dimensions`);
  }
}
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) throw new ValidationError("Vector dimensions must match");
  let dot = 0, left = 0, right = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; left += a[i] ** 2; right += b[i] ** 2; }
  if (!left || !right) return 0;
  return Math.max(0, Math.min(1, (dot / Math.sqrt(left * right) + 1) / 2));
}
export async function upsertEmbedding(db: SqliteDatabase, input: { targetType: RetrievalTargetType; targetId: string; text: string; contentHash: string; provider: EmbeddingProvider }): Promise<boolean> {
  if (input.provider.dimensions <= 0) return false;
  const existing = db.prepare(`SELECT content_hash FROM search_embeddings WHERE target_type=? AND target_id=? AND embedding_provider=? AND embedding_model=?`)
    .get(input.targetType, input.targetId, input.provider.name, input.provider.model) as { content_hash: string } | undefined;
  if (existing?.content_hash === input.contentHash) return false;
  const vector = (await input.provider.embedTexts([input.text]))[0];
  return storeEmbeddingVector(db, { targetType: input.targetType, targetId: input.targetId, contentHash: input.contentHash, provider: input.provider, vector });
}

export function storeEmbeddingVector(db: SqliteDatabase, input: { targetType: RetrievalTargetType; targetId: string; contentHash: string; provider: EmbeddingProvider; vector: number[] }): boolean {
  if (input.provider.dimensions <= 0) return false;
  const existing = db.prepare(`SELECT content_hash FROM search_embeddings WHERE target_type=? AND target_id=? AND embedding_provider=? AND embedding_model=?`)
    .get(input.targetType, input.targetId, input.provider.name, input.provider.model) as { content_hash: string } | undefined;
  if (existing?.content_hash === input.contentHash) return false;
  const vector = input.vector;
  validateVector(vector, input.provider.dimensions);
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO search_embeddings(id,target_type,target_id,embedding_provider,embedding_model,embedding_dim,content_hash,vector_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(target_type,target_id,embedding_provider,embedding_model) DO UPDATE SET embedding_dim=excluded.embedding_dim,content_hash=excluded.content_hash,vector_json=excluded.vector_json,updated_at=excluded.updated_at`)
    .run(stableProvenanceId("semb_", `${input.targetType}:${input.targetId}:${input.provider.name}:${input.provider.model}`), input.targetType, input.targetId, input.provider.name, input.provider.model, input.provider.dimensions, input.contentHash, JSON.stringify(vector), timestamp, timestamp);
  return true;
}
