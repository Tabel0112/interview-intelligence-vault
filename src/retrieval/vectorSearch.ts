import type { SqliteDatabase } from "../db/connection.js";
import { cosineSimilarity, validateVector } from "./embeddingStore.js";
import { documentMatchesFilters, rowToCandidate, type RetrievalDocumentRow } from "./filters.js";
import type { RetrievalCandidate, RetrievalQuery, RetrievalTargetType } from "./types.js";

const scopeTypes: Record<string, RetrievalTargetType[]> = {
  transcript_spans: ["transcript_span"], memory_objects: ["memory_object"], evidence_pointers: ["evidence_pointer"],
  all: ["transcript_span", "memory_object", "evidence_pointer"],
};

export async function vectorSearch(db: SqliteDatabase, query: RetrievalQuery): Promise<RetrievalCandidate[]> {
  const text = query.query.trim(), provider = query.embeddingProvider;
  if (!text || !provider || provider.dimensions <= 0) return [];
  const vector = (await provider.embedTexts([text]))[0];
  validateVector(vector, provider.dimensions);
  const types = scopeTypes[query.scope ?? "all"];
  const embeddings = db.prepare(`SELECT e.*,d.* FROM search_embeddings e JOIN retrieval_documents d
    ON d.target_type=e.target_type AND d.target_id=e.target_id
    WHERE e.embedding_provider=? AND e.embedding_model=? AND e.embedding_dim=?`).all(provider.name, provider.model, provider.dimensions) as Array<RetrievalDocumentRow & { vector_json: string }>;
  return embeddings.filter((row) => types.includes(row.target_type) && documentMatchesFilters(row, query.filters)).map((row) => {
    const stored = JSON.parse(row.vector_json) as number[]; validateVector(stored, provider.dimensions);
    const score = cosineSimilarity(vector, stored), candidate = rowToCandidate(row);
    return { ...candidate, vectorScore: score, finalScore: score, metadataScore: query.filters && Object.keys(query.filters).length ? 1 : 0.5, matchReasons: ["vector:semantic", row.evidence_score === 0.5 ? "evidence:unscored" : `evidence:${row.evidence_score < 0.45 ? "weak" : "scored"}`] };
  }).sort((a, b) => (b.vectorScore ?? 0) - (a.vectorScore ?? 0)).slice(0, query.vectorLimit ?? query.limit ?? 50);
}
