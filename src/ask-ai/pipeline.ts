import { createId } from "../db/ids.js";
import { saveEvidenceScoreRun, scoreEvidenceBundle, type EvidenceBundleAssessment, type EvidenceUseType } from "../evidence/index.js";
import { addConflictContext, confidenceWithConflicts, conflictEvidenceForAnswer } from "../conflicts/index.js";
import { buildCitations } from "./citations.js";
import { generateClaimsFromEvidence } from "./claimGeneration.js";
import { selectEvidenceForAnswer } from "./evidenceSelection.js";
import { suggestFollowups } from "./followups.js";
import { persistAskAIResponse } from "./repository.js";
import { renderAnswer } from "./answerRendering.js";
import { understandQuestion } from "./queryUnderstanding.js";
import type { AnswerSynthesis, AskAIDependencies, AskAIRequest, AskAIResponse, ClaimKind, QueryUnderstanding } from "./types.js";

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
    confidence: selectedConfidence, llm: deps.llm, onSynthesis: (mode) => { actualMode = mode; },
  });
  const confidence = claims.length ? selectedConfidence : "no_evidence";
  const usedPointers = new Set(claims.flatMap((claim) => claim.evidencePointerIds));
  const finalEvidence = selectedEvidence.filter((item) => usedPointers.has(item.evidencePointerId));
  const finalCitations = citations.filter((item) => usedPointers.has(item.evidencePointerId));
  const response: AskAIResponse = {
    id: createId("ask_"), question: request.question,
    answerMarkdown: addConflictContext(renderAnswer({ confidence, claims, citations: finalCitations }), conflicts),
    evidenceConfidence: confidence, claims, citations: finalCitations, evidence: finalEvidence,
    suggestedFollowups: request.includeSuggestedFollowups === false ? [] : suggestFollowups(confidence, query),
    notEnoughEvidence: confidence === "no_evidence", createdAt: timestamp.toISOString(), queryUnderstanding: query, conflicts,
    synthesis: resolveAnswerSynthesis(deps, actualMode),
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
