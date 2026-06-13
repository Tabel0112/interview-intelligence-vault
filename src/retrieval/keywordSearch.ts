import type { SqliteDatabase } from "../db/connection.js";
import { documentMatchesFilters, rowToCandidate, type RetrievalDocumentRow } from "./filters.js";
import type { RetrievalCandidate, RetrievalQuery, RetrievalTargetType } from "./types.js";

const scopeTypes: Record<string, RetrievalTargetType[]> = {
  transcript_spans: ["transcript_span"], memory_objects: ["memory_object"], evidence_pointers: ["evidence_pointer"],
  all: ["transcript_span", "memory_object", "evidence_pointer"],
};

function keywordScore(row: RetrievalDocumentRow, query: string): { score: number; reasons: string[] } {
  const phrase = query.toLowerCase(), title = (row.title ?? "").toLowerCase(), text = row.search_text.toLowerCase();
  const speaker = (row.speaker_name ?? "").toLowerCase(), topic = (row.topic_text ?? "").toLowerCase();
  const tokens = phrase.match(/[\p{L}\p{N}]+/gu) ?? [];
  let score = 0; const reasons: string[] = [];
  if (title.includes(phrase)) { score += 0.65; reasons.push("keyword:title", "keyword:exact_phrase"); }
  if (text.includes(phrase)) { score += 0.55; reasons.push(row.target_type === "transcript_span" ? "keyword:span_text" : "keyword:body", "keyword:exact_phrase"); }
  if (speaker.includes(phrase)) { score += 0.35; reasons.push("keyword:speaker"); }
  if (topic.includes(phrase)) { score += 0.35; reasons.push("keyword:topic"); }
  const matched = tokens.filter((token) => title.includes(token) || text.includes(token) || speaker.includes(token) || topic.includes(token)).length;
  if (tokens.length) score += 0.35 * (matched / tokens.length);
  return { score: Math.min(1, score), reasons: [...new Set(reasons)] };
}

export function keywordSearch(db: SqliteDatabase, query: RetrievalQuery): RetrievalCandidate[] {
  const text = query.query.trim();
  if (!text) return [];
  const types = scopeTypes[query.scope ?? "all"];
  const candidateLimit = Math.max(query.keywordLimit ?? query.limit ?? 50, 20) * 10;
  let rows: RetrievalDocumentRow[] = [];
  try {
    const fts = (text.match(/[\p{L}\p{N}]+/gu) ?? []).map((token) => `"${token.replaceAll('"', '""')}"*`).join(" OR ");
    if (fts) {
      const ids = db.prepare("SELECT target_type,target_id FROM retrieval_documents_fts WHERE retrieval_documents_fts MATCH ? LIMIT ?").all(fts, candidateLimit) as Array<{ target_type: string; target_id: string }>;
      if (ids.length) {
        const clauses = ids.map(() => "(target_type=? AND target_id=?)").join(" OR ");
        rows = db.prepare(`SELECT * FROM retrieval_documents WHERE ${clauses}`).all(...ids.flatMap((id) => [id.target_type, id.target_id])) as RetrievalDocumentRow[];
      }
    }
  } catch { /* FTS5 unavailable or query unsupported. */ }
  if (!rows.length) rows = db.prepare("SELECT * FROM retrieval_documents WHERE lower(search_text) LIKE lower(?) OR lower(COALESCE(title,'')) LIKE lower(?) OR lower(COALESCE(speaker_name,'')) LIKE lower(?) LIMIT ?").all(`%${text}%`, `%${text}%`, `%${text}%`, candidateLimit) as RetrievalDocumentRow[];
  return rows.filter((row) => types.includes(row.target_type) && documentMatchesFilters(row, query.filters)).map((row) => {
    const scored = keywordScore(row, text), candidate = rowToCandidate(row);
    return { ...candidate, keywordScore: scored.score, finalScore: scored.score, metadataScore: query.filters && Object.keys(query.filters).length ? 1 : 0.5, matchReasons: [...scored.reasons, row.evidence_score === 0.5 ? "evidence:unscored" : `evidence:${row.evidence_score < 0.45 ? "weak" : "scored"}`] };
  }).filter((item) => (item.keywordScore ?? 0) > 0).sort((a, b) => (b.keywordScore ?? 0) - (a.keywordScore ?? 0)).slice(0, query.keywordLimit ?? query.limit ?? 50);
}
