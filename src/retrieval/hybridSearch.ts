import type { SqliteDatabase } from "../db/connection.js";
import { keywordSearch } from "./keywordSearch.js";
import { dedupeUnderlyingEvidence, mergeCandidates, rankCandidate } from "./ranking.js";
import type { RetrievalCandidate, RetrievalQuery } from "./types.js";
import { vectorSearch } from "./vectorSearch.js";

export async function searchRetrieval(db: SqliteDatabase, query: RetrievalQuery): Promise<RetrievalCandidate[]> {
  if (!query.query.trim()) return [];
  const mode = query.mode ?? "hybrid";
  const keyword = mode === "vector" ? [] : keywordSearch(db, query);
  const vector = mode === "keyword" ? [] : await vectorSearch(db, query);
  const ranked = mergeCandidates([...keyword, ...vector]).map((candidate) => rankCandidate(candidate, vector.length > 0, query.recencyBoost, query.now));
  const filtered = query.requireEvidencePointers ? ranked.filter((candidate) => candidate.evidencePointerIds.length > 0) : ranked;
  return dedupeUnderlyingEvidence(filtered).sort((a, b) => b.finalScore - a.finalScore).slice(0, query.finalLimit ?? query.limit ?? 20);
}
export const searchTranscriptSpans = (db: SqliteDatabase, query: RetrievalQuery) => searchRetrieval(db, { ...query, scope: "transcript_spans" });
export const searchMemoryObjects = (db: SqliteDatabase, query: RetrievalQuery) => searchRetrieval(db, { ...query, scope: "memory_objects" });
export const searchEvidencePointers = (db: SqliteDatabase, query: RetrievalQuery) => searchRetrieval(db, { ...query, scope: "evidence_pointers" });
