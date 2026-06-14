// Reindex-needed detection. READ-ONLY: this inspects the index state and reports whether the
// embeddings on disk match the active embedding space. It never mutates anything and never
// triggers a reindex — rebuildRetrievalIndex remains the action. Switching provider/model makes
// every document "missing under the active space", which is reported as needsReindex=true.

import type { SqliteDatabase } from "../db/connection.js";
import { embeddingSpaceOf, isVectorCapable, sameEmbeddingSpace, type EmbeddingSpace } from "./embeddingSpace.js";
import type { EmbeddingProvider } from "./embeddingProvider.js";
import type { RetrievalTargetType } from "./types.js";

export interface IndexedEmbeddingSpace extends EmbeddingSpace {
  count: number;
}

export interface ReindexAssessment {
  activeSpace: EmbeddingSpace;
  vectorCapable: boolean;
  documentCount: number;
  embeddedUnderActive: number;
  missingUnderActive: number;
  indexedSpaces: IndexedEmbeddingSpace[];
  foreignSpaces: IndexedEmbeddingSpace[];
  needsReindex: boolean;
  reasons: string[];
}

const isProvider = (value: EmbeddingProvider | EmbeddingSpace): value is EmbeddingProvider =>
  typeof (value as EmbeddingProvider).embedTexts === "function";

export function detectReindexNeeded(
  db: SqliteDatabase,
  active: EmbeddingProvider | EmbeddingSpace,
  options: { targetTypes?: RetrievalTargetType[] } = {},
): ReindexAssessment {
  const activeSpace = isProvider(active) ? embeddingSpaceOf(active) : active;
  const vectorCapable = isVectorCapable(activeSpace);
  const types = options.targetTypes;
  const typeClause = types && types.length ? ` WHERE target_type IN (${types.map(() => "?").join(",")})` : "";
  const typeArgs = types && types.length ? types : [];

  const documentCount = (db.prepare(`SELECT COUNT(*) c FROM retrieval_documents${typeClause}`).get(...typeArgs) as { c: number }).c;

  const joinTypeClause = types && types.length ? ` AND d.target_type IN (${types.map(() => "?").join(",")})` : "";
  const embeddedUnderActive = (db.prepare(
    `SELECT COUNT(*) c FROM retrieval_documents d
     JOIN search_embeddings e ON e.target_type=d.target_type AND e.target_id=d.target_id
     WHERE e.embedding_provider=? AND e.embedding_model=? AND e.embedding_dim=?${joinTypeClause}`,
  ).get(activeSpace.provider, activeSpace.model, activeSpace.dimensions, ...typeArgs) as { c: number }).c;

  const missingUnderActive = Math.max(0, documentCount - embeddedUnderActive);

  const indexedSpaces = (db.prepare(
    `SELECT embedding_provider provider, embedding_model model, embedding_dim dimensions, COUNT(*) count
     FROM search_embeddings${typeClause}
     GROUP BY embedding_provider, embedding_model, embedding_dim
     ORDER BY embedding_provider, embedding_model, embedding_dim`,
  ).all(...typeArgs) as IndexedEmbeddingSpace[]);

  const foreignSpaces = indexedSpaces.filter((space) => !sameEmbeddingSpace(space, activeSpace));

  const reasons: string[] = [];
  if (!vectorCapable) reasons.push("Embeddings are disabled for the active provider (0 dimensions).");
  if (documentCount === 0) reasons.push("No indexed documents to embed.");
  if (vectorCapable && documentCount > 0 && missingUnderActive > 0) {
    reasons.push(`${missingUnderActive} of ${documentCount} document(s) are not embedded under the active space (${activeSpace.provider}/${activeSpace.model}@${activeSpace.dimensions}).`);
  }
  if (foreignSpaces.length) {
    const total = foreignSpaces.reduce((sum, space) => sum + space.count, 0);
    reasons.push(`${total} embedding(s) are indexed under a different provider/model and are ignored by vector search.`);
  }

  const needsReindex = vectorCapable && documentCount > 0 && missingUnderActive > 0;

  return { activeSpace, vectorCapable, documentCount, embeddedUnderActive, missingUnderActive, indexedSpaces, foreignSpaces, needsReindex, reasons };
}
