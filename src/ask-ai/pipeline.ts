import { createId } from "../db/ids.js";
import { saveEvidenceScoreRun, scoreEvidenceBundle, type EvidenceBundleAssessment, type EvidenceUseType } from "../evidence/index.js";
import { addConflictContext, confidenceWithConflicts, conflictEvidenceForAnswer } from "../conflicts/index.js";
import { buildAnalysisClaim } from "./analysisGeneration.js";
import { buildCitations } from "./citations.js";
import { generateClaimsFromEvidence } from "./claimGeneration.js";
import { selectEvidenceForAnswer } from "./evidenceSelection.js";
import { suggestFollowups } from "./followups.js";
import { persistAskAIResponse } from "./repository.js";
import { renderAnswer } from "./answerRendering.js";
import { understandQuestion } from "./queryUnderstanding.js";
import type { AnswerSynthesis, AskAIAnalysisClaim, AskAIDependencies, AskAIRequest, AskAIResponse, AskAIUnconfirmedItem, ClaimKind, QueryUnderstanding } from "./types.js";

const useType = (kind: ClaimKind): EvidenceUseType =>
  kind === "fact" ? "direct_fact" : kind === "pattern" ? "pattern" : kind;

/** Build the non-secret, runtime-accurate synthesis record. No keys/prompts/provider objects. */
function resolveAnswerSynthesis(deps: AskAIDependencies, actualMode: "llm" | "deterministic" | "conflict"): AnswerSynthesis {
  const configured = deps.synthesisInfo ?? { mode: deps.llm ? "external_llm" : "deterministic" };
  const mode: AnswerSynthesis["mode"] = actualMode === "llm" ? "external_llm" : actualMode;
  // Runtime fallback: an external LLM was available but the deterministic path was actually taken.
  const runtimeFallback = deps.llm != null && actualMode === "deterministic";
  const usedFallback = Boolean(configured.usedFallback) || runtimeFallback;
  const reason = runtimeFallback
    ? `Configured external LLM "${configured.provider ?? "external"}" did not produce grounded claims; used deterministic synthesis.`
    : configured.usedFallback
      ? "External LLM was selected but not fully configured; used deterministic synthesis."
      : undefined;
  return { mode, provider: configured.provider, model: configured.model, usedFallback, reason };
}

export async function askAI(request: AskAIRequest, deps: AskAIDependencies): Promise<AskAIResponse> {
  const query = understandQuestion(request.question, request);
  const timestamp = deps.now?.() ?? new Date();
  const candidates = await deps.retrieveCandidates(query);
  const assessment: EvidenceBundleAssessment = deps.scoreEvidence
    ? await deps.scoreEvidence(query.normalizedQuestion, candidates, query)
    : scoreEvidenceBundle({
        claimText: query.normalizedQuestion, useType: useType(query.requestedClaimKinds[0] ?? "fact"),
        candidates, now: timestamp.toISOString(),
      });
  const materialized = deps.createEvidencePointers ? await deps.createEvidencePointers(assessment.usableEvidence) : undefined;
  const selection = selectEvidenceForAnswer(assessment, { maxEvidenceItems: request.maxEvidenceItems, materializedEvidence: materialized });
  const conflicts = deps.findConflicts ? await deps.findConflicts(selection.evidence) : [];
  const selectedEvidence = [...new Map([...selection.evidence, ...conflictEvidenceForAnswer(conflicts)].map((item) => [item.evidencePointerId, item])).values()];
  const citations = buildCitations(selectedEvidence);
  const selectedConfidence = confidenceWithConflicts(selection.confidence, conflicts);
  let actualMode: "llm" | "deterministic" | "conflict" = "deterministic";
  const claims = await generateClaimsFromEvidence(query, selectedEvidence, citations, {
    confidence: selectedConfidence, llm: deps.llm, requireLlm: deps.requireLlm, onSynthesis: (mode) => { actualMode = mode; },
  });
  const confidence = claims.length ? selectedConfidence : "no_evidence";
  const usedPointers = new Set(claims.flatMap((claim) => claim.evidencePointerIds));
  const finalEvidence = selectedEvidence.filter((item) => usedPointers.has(item.evidencePointerId));
  const finalCitations = citations.filter((item) => usedPointers.has(item.evidencePointerId));
  // LIVE-ONLY AI analysis branch (Step 2 Option A). Only advice/strategy/planning contracts (which allow
  // reasoning AND do not require evidence) enter here, so factual/decision/evidence/comparison/summary
  // lookups are completely unaffected and still refuse on no evidence. Analysis is additive, never
  // transcript-backed, never persisted (it is not added to `claims`).
  const contract = query.answerContract;
  const allowAnalysis = (contract.allowGeneralReasoning || contract.allowRecommendations || contract.allowDrafting) && !contract.refuseIfNoEvidence;
  let analysis: AskAIAnalysisClaim[] = [];
  let analysisUnavailable = false;
  if (allowAnalysis && deps.analysis) {
    try {
      analysis = (await deps.analysis.analyze({ query, evidence: selectedEvidence })).map((item, index) => buildAnalysisClaim(index, item));
    } catch {
      // AI analysis is OPTIONAL, non-transcript enrichment. If it fails (provider error/timeout/bad
      // shape), degrade gracefully: keep the evidence-driven answer (cited claims or refusal) plus any
      // unconfirmed context, and flag that analysis was unavailable — never fail the whole answer for it.
      // No secrets are surfaced (the error is swallowed; only a boolean flag remains).
      analysisUnavailable = true;
    }
  }
  // LIVE-ONLY unconfirmed/tentative/conflict surfacing (sub-step A). Gated on the contract — factual_lookup
  // and strict summary have neither flag, so they never enter here and their refusal is unchanged. Conflicts
  // already surfaced via the selected-evidence `conflicts` set are removed to avoid double-counting. Never
  // added to `claims`; never persisted in sub-step A.
  let unconfirmed: AskAIUnconfirmedItem[] = [];
  if ((contract.includeReviewOnlyItems || contract.includeConflicts) && deps.retrieveUnconfirmed) {
    try {
      const selectedConflictIds = new Set(conflicts.map((conflict) => conflict.id));
      unconfirmed = (await deps.retrieveUnconfirmed(query)).filter((item) => !(item.conflictId && selectedConflictIds.has(item.conflictId)));
    } catch {
      unconfirmed = []; // optional supplemental context; never fail the answer because this retrieval failed
    }
  }
  const response: AskAIResponse = {
    id: createId("ask_"), question: request.question,
    answerMarkdown: addConflictContext(renderAnswer({ confidence, claims, citations: finalCitations, analysis, unconfirmed }), conflicts),
    evidenceConfidence: confidence, claims, citations: finalCitations, evidence: finalEvidence,
    suggestedFollowups: request.includeSuggestedFollowups === false ? [] : suggestFollowups(confidence, query),
    notEnoughEvidence: confidence === "no_evidence", createdAt: timestamp.toISOString(), queryUnderstanding: query, conflicts,
    synthesis: resolveAnswerSynthesis(deps, actualMode),
    ...(analysis.length ? { analysis, hasAnalysis: true } : {}),
    ...(analysisUnavailable ? { analysisUnavailable: true } : {}),
    // Always present (array + boolean) so live and reconstructed answers share one contract.
    unconfirmed, hasUnconfirmed: unconfirmed.length > 0,
  };
  if (deps.persistAnswer) await deps.persistAnswer(response);
  else if (deps.db) {
    deps.db.transaction(() => {
      response.scoreRunId = saveEvidenceScoreRun(deps.db!, assessment, { targetType: "ask_ai", targetId: response.id });
      persistAskAIResponse(deps.db!, response);
    })();
  }
  return response;
}

export const retrieveEvidenceForQuestion = async (query: QueryUnderstanding, deps: Pick<AskAIDependencies, "retrieveCandidates">) =>
  deps.retrieveCandidates(query);
