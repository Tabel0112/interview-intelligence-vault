// DORMANT / EXPERIMENTAL agent — not invoked by any live product path (see askAiPipeline.ts header).
//
// HARDENED: this agent enforces the SAME production rule as the live Ask AI wiring — `requireLlm` is
// ALWAYS on. Synthesis uses the external LLM injected via `context.synthesis` (the same explicit-injection
// seam the live app uses); with evidence selected and no LLM injected, askAI throws
// SynthesisSetupRequiredError and the pipeline fails closed. It can never silently fall back to the
// deterministic dev/test synthesis. (No-evidence questions still refuse deterministically BEFORE the LLM
// gate, exactly like the live path.)

import { askAI } from "../../ask-ai/index.js";
import { createConflictRepository } from "../../conflicts/index.js";
import { getEvidenceCandidatesForTarget, scoreEvidenceBundle } from "../../evidence/index.js";
import { assertHermesOnlyChangedPresentationOrAllowedRanking, buildSuggestedFollowups, formatAnswerWithHermesStyle } from "../../hermes/index.js";
import type { Agent } from "../types.js";

export const answerSynthesisAgent: Agent<{ question: string; validatedPointerIds?: string[] }, Record<string, unknown>> = {
  type: "answer_synthesis",
  async run(input, context) {
    const allowed = new Set(input.validatedPointerIds ?? []);
    const response = await askAI({ question: input.question }, {
      db: context.db, now: context.now,
      // Production LLM requirement — identical to the live app's askGated wiring. Never deterministic.
      llm: context.synthesis?.llm, synthesisInfo: context.synthesis?.info, requireLlm: true,
      retrieveCandidates: async () => [...allowed].flatMap((id) => {
        const pointer = context.db.prepare("SELECT target_type,target_id FROM evidence_pointers WHERE evidence_pointer_id=?").get(id) as { target_type: Parameters<typeof getEvidenceCandidatesForTarget>[1]; target_id: string } | undefined;
        return pointer ? getEvidenceCandidatesForTarget(context.db, pointer.target_type, pointer.target_id).filter((item) => item.evidencePointerId === id) : [];
      }),
      scoreEvidence: async (question, candidates) => scoreEvidenceBundle({ claimText: question, useType: "direct_fact", candidates, now: context.now().toISOString() }),
      findConflicts: async (evidence) => createConflictRepository(context.db, { now: context.now }).listActiveForEvidencePointers(evidence.map((item) => item.evidencePointerId)),
    });
    let renderedAnswer = response.answerMarkdown, suggestedFollowups = response.suggestedFollowups;
    let hermesPersonalizationSummary: unknown;
    if (context.hermesProfile) {
      const styled = formatAnswerWithHermesStyle(response.answerMarkdown, context.hermesProfile);
      const followups = buildSuggestedFollowups(response.answerMarkdown, response.evidence, context.hermesProfile);
      const after = { ...response, answerMarkdown: styled.answer, suggestedFollowups: followups.followups };
      assertHermesOnlyChangedPresentationOrAllowedRanking(response, after);
      renderedAnswer = styled.answer; suggestedFollowups = followups.followups;
      hermesPersonalizationSummary = { personalizationOnly: true, style: styled.personalizationSummary, followups: followups.personalizationSummary };
    }
    return { answerId: response.id, claimIds: response.claims.map((item) => item.id), citationIds: response.citations.map((item) => item.id), renderedAnswer, selectedEvidencePointerIds: response.evidence.map((item) => item.evidencePointerId), evidenceQualitySummary: response.evidenceConfidence, contradictionSummary: response.conflicts.map((item) => item.summary), evidenceQualityNotice: response.evidenceConfidence === "weak" || response.evidenceConfidence === "no_evidence" ? "Evidence is weak or missing." : undefined, conflictNotice: response.evidenceConfidence === "conflicting" ? "Evidence conflicts; both sides are shown." : undefined, suggestedFollowups, hermesPersonalizationSummary, warnings: [] };
  },
};
