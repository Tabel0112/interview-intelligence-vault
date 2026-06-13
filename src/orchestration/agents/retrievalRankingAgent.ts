import { applyHermesRankingHints } from "../../hermes/index.js";
import { searchEvidencePointers } from "../../retrieval/index.js";
import type { Agent } from "../types.js";

export const retrievalRankingAgent: Agent<{ question: string; transcriptIds?: string[] }, Record<string, unknown>> = {
  type: "retrieval_ranking",
  async run(input, context) {
    const candidates = await searchEvidencePointers(context.db, { query: input.question, mode: "hybrid", finalLimit: 30, requireEvidencePointers: true, includeOpposition: true, filters: { transcriptIds: input.transcriptIds }, now: context.now().toISOString() });
    const personalized = context.hermesProfile ? applyHermesRankingHints(candidates, context.hermesProfile) : { candidates, personalizationSummary: undefined };
    return {
      candidateEvidenceIds: candidates.map((item) => item.targetId),
      selectedEvidencePointerIds: personalized.candidates.map((item) => item.targetId),
      rankingSummary: { totalCandidates: candidates.length, selectedCount: personalized.candidates.length, strongCount: candidates.filter((item) => (item.evidenceScore ?? 0) >= 0.75).length, weakCount: candidates.filter((item) => (item.evidenceScore ?? 0) < 0.45).length, conflictingCount: candidates.filter((item) => item.supportRole === "mixed").length },
      hermesPersonalizationSummary: personalized.personalizationSummary, warnings: [],
    };
  },
};
