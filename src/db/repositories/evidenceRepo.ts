import type { SqliteDatabase } from "../connection.js";
import { NotFoundError } from "../errors.js";
import { createId } from "../ids.js";
import type { EvidenceBundle, EvidenceBundlePurpose, EvidenceBundleStatus, EvidenceBundleWithItems, EvidenceItem, EvidenceItemStance, JsonObject } from "../schema.js";
import { assertScore, json, now, parseRow, parseRows, requireRow } from "../utils.js";

export interface CreateEvidenceBundleInput { id?: string; purpose: EvidenceBundlePurpose; query_text?: string | null; query_embedding_model?: string | null; created_run_id?: string | null; overall_score?: number | null; status?: EvidenceBundleStatus; metadata?: JsonObject; }
export interface AddEvidenceItemInput { id?: string; span_id: string; memory_id?: string | null; retrieval_rank?: number | null; vector_score?: number | null; keyword_score?: number | null; recency_score?: number | null; speaker_score?: number | null; rerank_score?: number | null; final_score: number; stance: EvidenceItemStance; reason?: string | null; metadata?: JsonObject; }

export function createEvidenceRepo(db: SqliteDatabase, options: { now?: () => Date } = {}) {
  const timestamp = () => options.now?.().toISOString() ?? now();
  const getBundle = (id: string) => parseRow<EvidenceBundle | null>(db.prepare("SELECT * FROM evidence_bundles WHERE id = ?").get(id));
  return {
    createEvidenceBundle(input: CreateEvidenceBundleInput): EvidenceBundle {
      assertScore(input.overall_score, "overall_score");
      const row = { id: input.id ?? createId("evb_"), purpose: input.purpose, query_text: input.query_text ?? null, query_embedding_model: input.query_embedding_model ?? null, created_run_id: input.created_run_id ?? null, overall_score: input.overall_score ?? null, status: input.status ?? "needs_review", created_at: timestamp(), metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO evidence_bundles(id,purpose,query_text,query_embedding_model,created_run_id,overall_score,status,created_at,metadata_json)
        VALUES (@id,@purpose,@query_text,@query_embedding_model,@created_run_id,@overall_score,@status,@created_at,@metadata_json)`).run(row);
      return getBundle(row.id)!;
    },
    addEvidenceItem(bundleId: string, input: AddEvidenceItemInput): EvidenceItem {
      requireRow(db, "evidence_bundles", bundleId); requireRow(db, "transcript_spans", input.span_id);
      for (const field of ["vector_score", "keyword_score", "recency_score", "speaker_score", "rerank_score", "final_score"] as const) assertScore(input[field], field);
      const row = { id: input.id ?? createId("evi_"), bundle_id: bundleId, span_id: input.span_id, memory_id: input.memory_id ?? null, retrieval_rank: input.retrieval_rank ?? null, vector_score: input.vector_score ?? null, keyword_score: input.keyword_score ?? null, recency_score: input.recency_score ?? null, speaker_score: input.speaker_score ?? null, rerank_score: input.rerank_score ?? null, final_score: input.final_score, stance: input.stance, reason: input.reason ?? null, created_at: timestamp(), metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO evidence_items(id,bundle_id,span_id,memory_id,retrieval_rank,vector_score,keyword_score,recency_score,speaker_score,rerank_score,final_score,stance,reason,created_at,metadata_json)
        VALUES (@id,@bundle_id,@span_id,@memory_id,@retrieval_rank,@vector_score,@keyword_score,@recency_score,@speaker_score,@rerank_score,@final_score,@stance,@reason,@created_at,@metadata_json)`).run(row);
      return parseRow<EvidenceItem>(db.prepare("SELECT * FROM evidence_items WHERE id = ?").get(row.id));
    },
    getEvidenceBundleWithItems(bundleId: string): EvidenceBundleWithItems | null {
      const bundle = getBundle(bundleId); if (!bundle) return null;
      return { ...bundle, items: parseRows<EvidenceItem>(db.prepare("SELECT * FROM evidence_items WHERE bundle_id = ? ORDER BY retrieval_rank, created_at").all(bundleId)) };
    },
    scoreEvidenceBundle(bundleId: string): EvidenceBundle {
      if (!getBundle(bundleId)) throw new NotFoundError(`Evidence bundle not found: ${bundleId}`);
      const items = db.prepare("SELECT final_score, stance FROM evidence_items WHERE bundle_id = ?").all(bundleId) as Array<{ final_score: number; stance: EvidenceItemStance }>;
      const average = items.length ? items.reduce((sum, item) => sum + item.final_score, 0) / items.length : null;
      const high = (stance: EvidenceItemStance) => items.some((item) => item.stance === stance && item.final_score >= 0.75);
      const status: EvidenceBundleStatus = high("supports") && high("contradicts") ? "conflicting" : average != null && average >= 0.75 ? "strong" : average != null && average >= 0.45 ? "mixed" : "weak";
      db.prepare("UPDATE evidence_bundles SET overall_score = ?, status = ? WHERE id = ?").run(average, status, bundleId);
      return getBundle(bundleId)!;
    },
  };
}
