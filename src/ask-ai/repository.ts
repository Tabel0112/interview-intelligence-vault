import type { SqliteDatabase } from "../db/connection.js";
import { NotFoundError, ValidationError } from "../db/errors.js";
import { createId } from "../db/ids.js";
import { createRepositories } from "../db/index.js";
import type { AnswerConfidence, AnswerStatus, EvidenceBundleStatus, EvidenceItemStance } from "../db/schema.js";
import {
  createAnswerClaim, createCitationLinksForAnswer, linkAnswerClaimToEvidence, resolveEvidencePointer, resolveSourcePointer,
  type EvidencePointer, type EvidenceStrength, type ProvenanceEvidenceRole,
} from "../provenance/index.js";
import { AI_ANALYSIS_WARNING } from "./types.js";
import type { AskAIAnalysisClaim, AskAIResponse, ClaimKind, ClaimSupportStatus } from "./types.js";
import { createConflictRepository } from "../conflicts/index.js";

const bundleStatus = (confidence: AskAIResponse["evidenceConfidence"]): EvidenceBundleStatus =>
  confidence === "no_evidence" ? "weak" : confidence;
const answerStatus = (confidence: AskAIResponse["evidenceConfidence"]): AnswerStatus =>
  confidence === "no_evidence" ? "refused_no_evidence" : confidence === "weak" ? "weak_evidence" : confidence === "conflicting" ? "conflicting_evidence" : "answered";
const answerConfidence = (confidence: AskAIResponse["evidenceConfidence"]): AnswerConfidence =>
  confidence === "strong" ? "high" : confidence === "mixed" || confidence === "conflicting" ? "medium" : "low";
const itemStance = (stance: AskAIResponse["evidence"][number]["stance"]): EvidenceItemStance =>
  stance === "opposes" ? "contradicts" : stance === "qualifies" ? "qualifies" : stance === "supports" || stance === "updates" ? "supports" : "unknown";
const pointerRole = (stance: AskAIResponse["evidence"][number]["stance"]): ProvenanceEvidenceRole =>
  stance === "opposes" ? "opposition" : stance === "qualifies" ? "conditional" : stance === "supports" || stance === "updates" ? "support" : "unclear";
const pointerStrength = (strength: AskAIResponse["evidenceConfidence"]): EvidenceStrength =>
  strength === "no_evidence" ? "weak" : strength;
/**
 * Reconstruct a claim's support state. Prefer the persisted LIVE value (ask_ai_claim_metadata.support_status).
 * For legacy rows where it is null/missing, use a CONSERVATIVE fallback capped by the answer-level evidence
 * confidence — never upgrading, and never reading the (promotable) answer_claims.support_status. This
 * guarantees a weak answer's claims can never reconstruct as `supported`.
 */
const reconstructClaimSupport = (stored: unknown, evidenceConfidence: AskAIResponse["evidenceConfidence"]): ClaimSupportStatus => {
  if (stored === "supported" || stored === "weakly_supported" || stored === "conflicting" || stored === "unsupported") return stored;
  switch (evidenceConfidence) {
    case "no_evidence": return "unsupported";
    case "conflicting": return "conflicting";
    case "weak": return "weakly_supported";
    default: return "supported"; // strong / mixed
  }
};

export function persistAskAIResponse(db: SqliteDatabase, response: AskAIResponse): void {
  db.transaction(() => {
    const repos = createRepositories(db);
    const bundle = repos.evidence.createEvidenceBundle({
      purpose: "ask_ai", query_text: response.queryUnderstanding.normalizedQuestion, status: bundleStatus(response.evidenceConfidence),
      overall_score: response.evidence.length ? Math.max(...response.evidence.map((item) => item.evidenceScore)) : null,
      metadata: { ask_ai_run_id: response.id, score_run_id: response.scoreRunId ?? null },
    });
    response.evidence.forEach((item, index) => {
      const pointer = resolveEvidencePointer(db, item.evidencePointerId);
      if (!pointer.ok || pointer.evidence.transcript_id !== item.transcriptId || pointer.evidence.span_id !== item.spanId) {
        throw new ValidationError(`Ask AI evidence pointer is broken or mismatched: ${item.evidencePointerId}`);
      }
      const sourcePointerId = item.sourcePointerId ?? pointer.evidence.source_pointer_uri;
      if (!resolveSourcePointer(db, sourcePointerId).ok) throw new ValidationError(`Ask AI source pointer is broken: ${sourcePointerId}`);
      repos.evidence.addEvidenceItem(bundle.id, {
        span_id: item.spanId, retrieval_rank: index + 1, final_score: item.evidenceScore, stance: itemStance(item.stance),
        reason: item.scoringExplanation, metadata: { evidence_pointer_id: item.evidencePointerId, source_pointer_id: sourcePointerId },
      });
    });
    const answer = repos.answers.createAnswer({
      id: response.id, question_text: response.question, answer_text: response.answerMarkdown, evidence_bundle_id: bundle.id,
      confidence: answerConfidence(response.evidenceConfidence), answer_status: answerStatus(response.evidenceConfidence),
      // Only non-secret synthesis metadata is recorded: actual mode, provider id, model id, usedFallback, reason.
      model_name: response.synthesis?.model ?? null,
      metadata: { ask_ai: true, score_run_id: response.scoreRunId ?? null, synthesis: response.synthesis ?? null },
    });
    const selected = new Map(response.evidence.map((item) => [item.evidencePointerId, item]));
    response.claims.forEach((claim, index) => {
      const stored = createAnswerClaim(db, { answerId: answer.id, claimText: claim.text, claimOrder: index });
      // Persist the LIVE per-claim support state (Ask-AI-owned). answer_claims.support_status is set
      // separately by provenance pointer promotion and can read stronger; reconstruction prefers THIS value.
      db.prepare("INSERT INTO ask_ai_claim_metadata(answer_claim_id,kind,explanation,support_status) VALUES (?,?,?,?)")
        .run(stored.answer_claim_id, claim.kind, claim.explanation ?? null, claim.supportStatus);
      claim.evidencePointerIds.forEach((pointerId) => {
        const item = selected.get(pointerId);
        if (!item) throw new ValidationError(`Ask AI claim references unselected evidence: ${pointerId}`);
        linkAnswerClaimToEvidence(db, {
          answerClaimId: stored.answer_claim_id, transcriptId: item.transcriptId, spanId: item.spanId,
          evidenceRole: pointerRole(item.stance), evidenceStrength: pointerStrength(item.evidenceConfidence), confidence: item.evidenceScore,
          scores: { relevanceScore: item.relevanceScore, finalScore: item.evidenceScore },
        });
      });
    });
    createCitationLinksForAnswer(db, { answerId: answer.id });
    db.prepare(`INSERT INTO ask_ai_runs(
      id,question,normalized_question,answer_markdown,evidence_confidence,query_understanding_json,answer_id,score_run_id,not_enough_evidence,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      response.id, response.question, response.queryUnderstanding.normalizedQuestion, response.answerMarkdown,
      response.evidenceConfidence, JSON.stringify(response.queryUnderstanding), answer.id, response.scoreRunId ?? null,
      response.notEnoughEvidence ? 1 : 0, response.createdAt,
    );
    response.evidence.forEach((item, index) => db.prepare(`INSERT INTO ask_ai_run_evidence(
      ask_ai_run_id,evidence_pointer_id,source_pointer_id,transcript_id,span_id,rank,evidence_score,evidence_confidence,quote_preview,scoring_explanation
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      response.id, item.evidencePointerId, item.sourcePointerId ?? null, item.transcriptId, item.spanId, index + 1,
      item.evidenceScore, item.evidenceConfidence, item.quotePreview, item.scoringExplanation,
    ));
    response.suggestedFollowups.forEach((text, index) => db.prepare(
      "INSERT INTO ask_ai_suggested_followups(id,ask_ai_run_id,text,rank) VALUES (?,?,?,?)",
    ).run(createId("aif_"), response.id, text, index + 1));
    response.conflicts.forEach((conflict) => db.prepare(
      "INSERT INTO ask_ai_run_conflicts(ask_ai_run_id,conflict_assessment_id) VALUES (?,?)",
    ).run(response.id, conflict.id));
    // LIVE-ONLY AI analysis (Step 3): stored in a separate table with NO evidence/citation/support columns.
    // Guard before insert so a future bug can never slip a cited/supported analysis item into persistence.
    (response.analysis ?? []).forEach((item, index) => {
      if (item.supportStatus !== "ai_analysis" || item.evidencePointerIds.length || item.citationIds.length) {
        throw new ValidationError(`AI analysis item must be uncited and unsupported: ${item.id}`);
      }
      db.prepare(`INSERT INTO ask_ai_analysis_claims(id,ask_ai_run_id,position,kind,text,explanation,warning,metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?, '{}', ?)`).run(item.id, response.id, index, item.kind, item.text, item.explanation ?? null, item.warning, response.createdAt);
    });
  })();
}

export function getAskAIResponse(db: SqliteDatabase, id: string): AskAIResponse {
  const run = db.prepare("SELECT * FROM ask_ai_runs WHERE id=?").get(id) as Record<string, unknown> | undefined;
  if (!run) throw new NotFoundError(`Ask AI run not found: ${id}`);
  const evidenceRows = db.prepare("SELECT * FROM ask_ai_run_evidence WHERE ask_ai_run_id=? ORDER BY rank").all(id) as Array<Record<string, unknown>>;
  const claimRows = db.prepare(`SELECT c.*,m.kind,m.explanation,m.support_status AS claim_support_status FROM answer_claims c
    JOIN ask_ai_claim_metadata m ON m.answer_claim_id=c.answer_claim_id
    WHERE c.answer_id=? ORDER BY c.claim_order`).all(run.answer_id) as Array<Record<string, unknown>>;
  const linkRows = db.prepare(`SELECT l.*,e.source_pointer_uri,e.transcript_id,e.span_id,e.quote_preview
    FROM citation_links l JOIN evidence_pointers e ON e.evidence_pointer_id=l.evidence_pointer_id
    WHERE l.answer_id=? ORDER BY l.citation_order`).all(run.answer_id) as Array<Record<string, unknown>>;
  const followups = db.prepare("SELECT text FROM ask_ai_suggested_followups WHERE ask_ai_run_id=? ORDER BY rank").all(id) as Array<{ text: string }>;
  const conflicts = (db.prepare("SELECT conflict_assessment_id FROM ask_ai_run_conflicts WHERE ask_ai_run_id=? ORDER BY conflict_assessment_id")
    .all(id) as Array<{ conflict_assessment_id: string }>).map((row) => createConflictRepository(db).get(row.conflict_assessment_id)!).filter(Boolean);
  const evidenceConfidence = run.evidence_confidence as AskAIResponse["evidenceConfidence"];
  // Canonical user-facing evidence = the SELECTED evidence persisted for this run.
  const evidence = evidenceRows.map((item) => ({
    evidencePointerId: String(item.evidence_pointer_id), sourcePointerId: item.source_pointer_id == null ? undefined : String(item.source_pointer_id),
    transcriptId: String(item.transcript_id), spanId: String(item.span_id), quotePreview: String(item.quote_preview),
    evidenceScore: Number(item.evidence_score), evidenceConfidence: item.evidence_confidence as AskAIResponse["evidenceConfidence"],
    scoringExplanation: String(item.scoring_explanation), clickbackUri: `mv://evidence/${String(item.evidence_pointer_id)}`,
    stance: "unknown" as const, sourceKind: "raw_transcript_span" as const,
  }));
  // Re-align reconstructed citations to the SELECTED evidence pointer for their span (live buildCitations
  // cites selected pointers; persisted citation_links carry re-minted answer_claim pointers for provenance
  // only). We keep the stable citation_link_id (citation corrections rely on it) but surface the selected
  // pointer so citations line up 1:1 with evidence[].
  const selectedBySpan = new Map(evidence.map((item) => [`${item.transcriptId}::${item.spanId}`, item]));
  const citations = linkRows.map((item) => {
    const selected = selectedBySpan.get(`${String(item.transcript_id)}::${String(item.span_id)}`);
    const evidencePointerId = selected?.evidencePointerId ?? String(item.evidence_pointer_id);
    return {
      id: String(item.citation_link_id), label: String(item.citation_label), evidencePointerId,
      sourcePointerId: selected?.sourcePointerId ?? String(item.source_pointer_uri),
      transcriptId: String(item.transcript_id), spanId: String(item.span_id),
      quotePreview: selected?.quotePreview ?? String(item.quote_preview), clickbackUri: `mv://evidence/${evidencePointerId}`,
    };
  });
  const answerMeta = db.prepare("SELECT metadata_json FROM ai_answers WHERE id=?").get(run.answer_id) as { metadata_json?: string } | undefined;
  let synthesis: AskAIResponse["synthesis"];
  try {
    const parsedMeta = answerMeta?.metadata_json ? (JSON.parse(answerMeta.metadata_json) as { synthesis?: AskAIResponse["synthesis"] }) : null;
    synthesis = parsedMeta?.synthesis ?? undefined;
  } catch {
    synthesis = undefined;
  }
  // LIVE-ONLY AI analysis (Step 3): reconstructed from its OWN table. supportStatus / pointers / citations
  // are hard-coded here (the table has no such columns), so analysis can never reload as supported or cited,
  // and never passes through reconstructClaimSupport. Old runs / Step-2-window runs have no rows -> [].
  const analysis = (db.prepare("SELECT id,kind,text,explanation,warning FROM ask_ai_analysis_claims WHERE ask_ai_run_id=? ORDER BY position").all(id) as Array<Record<string, unknown>>)
    .map((item): AskAIAnalysisClaim => ({
      id: String(item.id), kind: item.kind as ClaimKind, text: String(item.text),
      supportStatus: "ai_analysis", evidencePointerIds: [], citationIds: [],
      warning: AI_ANALYSIS_WARNING, explanation: item.explanation == null ? undefined : String(item.explanation),
    }));
  return {
    id, question: String(run.question), answerMarkdown: String(run.answer_markdown),
    evidenceConfidence,
    notEnoughEvidence: Boolean(run.not_enough_evidence), createdAt: String(run.created_at),
    queryUnderstanding: JSON.parse(String(run.query_understanding_json)), scoreRunId: run.score_run_id == null ? undefined : String(run.score_run_id),
    evidence,
    ...(analysis.length ? { analysis, hasAnalysis: true } : {}),
    claims: claimRows.map((item) => {
      const claimCitations = citations.filter((citation) => linkRows.some((link) => link.answer_claim_id === item.answer_claim_id && link.citation_link_id === citation.id));
      return {
        id: String(item.answer_claim_id), kind: item.kind as ClaimKind, text: String(item.claim_text),
        supportStatus: reconstructClaimSupport(item.claim_support_status, evidenceConfidence),
        evidencePointerIds: claimCitations.map((citation) => citation.evidencePointerId), citationIds: claimCitations.map((citation) => citation.id),
        explanation: item.explanation == null ? undefined : String(item.explanation),
      };
    }),
    citations, suggestedFollowups: followups.map((item) => item.text), conflicts, synthesis,
  };
}
