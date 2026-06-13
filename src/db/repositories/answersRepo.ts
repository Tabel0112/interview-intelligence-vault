import type { SqliteDatabase } from "../connection.js";
import { InvalidEvidenceError, NotFoundError } from "../errors.js";
import { createId } from "../ids.js";
import type { AiAnswer, AiAnswerCitation, AiAnswerWithCitations, AnswerConfidence, AnswerStatus, EvidenceBundleStatus, JsonObject } from "../schema.js";
import { json, now, parseRow, parseRows } from "../utils.js";

export interface CreateAnswerInput { id?: string; question_text: string; answer_text: string; evidence_bundle_id: string; confidence: AnswerConfidence; answer_status: AnswerStatus; model_name?: string | null; created_run_id?: string | null; metadata?: JsonObject; }

export function createAnswersRepo(db: SqliteDatabase) {
  const getAnswer = (id: string) => parseRow<AiAnswer | null>(db.prepare("SELECT * FROM ai_answers WHERE id = ?").get(id));
  return {
    createAnswer(input: CreateAnswerInput): AiAnswer {
      const bundle = db.prepare("SELECT status FROM evidence_bundles WHERE id = ?").get(input.evidence_bundle_id) as { status: EvidenceBundleStatus } | undefined;
      if (!bundle) throw new InvalidEvidenceError(`Evidence bundle not found: ${input.evidence_bundle_id}`);
      const itemCount = (db.prepare("SELECT COUNT(*) count FROM evidence_items WHERE bundle_id = ?").get(input.evidence_bundle_id) as { count: number }).count;
      if (input.answer_status !== "refused_no_evidence" && !itemCount) throw new InvalidEvidenceError("Non-refusal answers require evidence items");
      const allowed: Record<EvidenceBundleStatus, AnswerStatus[]> = {
        weak: ["weak_evidence", "refused_no_evidence"], conflicting: ["conflicting_evidence"],
        strong: ["answered"], mixed: ["answered"], needs_review: ["weak_evidence", "refused_no_evidence"],
      };
      if (!allowed[bundle.status].includes(input.answer_status)) throw new InvalidEvidenceError(`Answer status ${input.answer_status} is incompatible with ${bundle.status} evidence`);
      const row = { id: input.id ?? createId("ans_"), question_text: input.question_text, answer_text: input.answer_text, evidence_bundle_id: input.evidence_bundle_id, confidence: input.confidence, answer_status: input.answer_status, model_name: input.model_name ?? null, created_run_id: input.created_run_id ?? null, created_at: now(), metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO ai_answers(id,question_text,answer_text,evidence_bundle_id,confidence,answer_status,model_name,created_run_id,created_at,metadata_json)
        VALUES (@id,@question_text,@answer_text,@evidence_bundle_id,@confidence,@answer_status,@model_name,@created_run_id,@created_at,@metadata_json)`).run(row);
      return getAnswer(row.id)!;
    },
    addCitation(answerId: string, evidenceItemId: string, quotedText?: string): AiAnswerCitation {
      const pair = db.prepare(`SELECT a.evidence_bundle_id answer_bundle, e.bundle_id item_bundle FROM ai_answers a, evidence_items e WHERE a.id = ? AND e.id = ?`).get(answerId, evidenceItemId) as { answer_bundle: string; item_bundle: string } | undefined;
      if (!pair) throw new NotFoundError("Answer or evidence item not found");
      if (pair.answer_bundle !== pair.item_bundle) throw new InvalidEvidenceError("Citation evidence item must belong to the answer evidence bundle");
      const order = (db.prepare("SELECT COALESCE(MAX(citation_order), 0) + 1 next_order FROM ai_answer_citations WHERE answer_id = ?").get(answerId) as { next_order: number }).next_order;
      const row = { id: createId("evi_"), answer_id: answerId, evidence_item_id: evidenceItemId, citation_order: order, quoted_text: quotedText ?? null, created_at: now() };
      db.prepare("INSERT INTO ai_answer_citations(id,answer_id,evidence_item_id,citation_order,quoted_text,created_at) VALUES (@id,@answer_id,@evidence_item_id,@citation_order,@quoted_text,@created_at)").run(row);
      return row;
    },
    getAnswerWithCitations(answerId: string): AiAnswerWithCitations | null {
      const answer = getAnswer(answerId); if (!answer) return null;
      return { ...answer, citations: parseRows<AiAnswerCitation>(db.prepare("SELECT * FROM ai_answer_citations WHERE answer_id = ? ORDER BY citation_order").all(answerId)) };
    },
    listAnswers(filter: Partial<Pick<AiAnswer, "confidence" | "answer_status" | "evidence_bundle_id">> = {}): AiAnswer[] {
      const clauses: string[] = [], values: string[] = [];
      for (const key of ["confidence", "answer_status", "evidence_bundle_id"] as const) if (filter[key]) { clauses.push(`${key} = ?`); values.push(filter[key]!); }
      return parseRows<AiAnswer>(db.prepare(`SELECT * FROM ai_answers ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at`).all(...values));
    },
  };
}
