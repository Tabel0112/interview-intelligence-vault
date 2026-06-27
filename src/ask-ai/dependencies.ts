import type { SqliteDatabase } from "../db/connection.js";
import { createConflictRepository } from "../conflicts/index.js";
import { getEvidenceCandidatesForTarget, scoreEvidenceBundle, type EvidenceCandidate, type EvidenceUseType } from "../evidence/index.js";
import { searchEvidencePointers } from "../retrieval/index.js";
import type { QueryUnderstanding, AskAIDependencies, AskAILanguageModel, ClaimKind, SynthesisInfo } from "./types.js";

const useType = (kind: ClaimKind): EvidenceUseType => kind === "fact" ? "direct_fact" : kind === "pattern" ? "pattern" : kind;

async function retrieve(db: SqliteDatabase, query: QueryUnderstanding): Promise<EvidenceCandidate[]> {
  const results = await searchEvidencePointers(db, {
    query: query.normalizedQuestion, mode: "hybrid", finalLimit: 50, requireEvidencePointers: true,
    filters: {
      transcriptIds: query.transcriptIds.length ? query.transcriptIds : undefined,
      createdAfter: query.timeRange?.start, createdBefore: query.timeRange?.end,
    },
  });
  return results.flatMap((result) => {
    const pointer = db.prepare("SELECT target_type,target_id FROM evidence_pointers WHERE evidence_pointer_id=?").get(result.targetId) as
      { target_type: Parameters<typeof getEvidenceCandidatesForTarget>[1]; target_id: string } | undefined;
    if (!pointer) return [];
    return getEvidenceCandidatesForTarget(db, pointer.target_type, pointer.target_id)
      .filter((item) => item.evidencePointerId === result.targetId)
      .map((item) => ({ ...item, retrievalScore: result.finalScore, vectorScore: result.vectorScore, keywordScore: result.keywordScore }));
  });
}

export function createDatabaseAskAIDependencies(
  db: SqliteDatabase,
  options: { now?: () => Date; llm?: AskAILanguageModel; synthesisInfo?: SynthesisInfo; requireLlm?: boolean } = {},
): AskAIDependencies {
  return {
    db, now: options.now, llm: options.llm, synthesisInfo: options.synthesisInfo, requireLlm: options.requireLlm,
    retrieveCandidates: (query) => retrieve(db, query),
    scoreEvidence: async (question, candidates, query) => scoreEvidenceBundle({
      claimText: question, candidates, useType: useType(query.requestedClaimKinds[0] ?? "fact"), now: options.now?.().toISOString(),
    }),
    findConflicts: async (evidence) => createConflictRepository(db, { now: options.now }).listActiveForEvidencePointers(evidence.map((item) => item.evidencePointerId)),
  };
}
