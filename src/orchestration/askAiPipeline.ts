import type { SqliteDatabase } from "../db/connection.js";
import { applyHermesDefaultFilters, buildHermesContext } from "../hermes/index.js";
import { createDefaultAgentRegistry } from "./defaultRegistry.js";
import { runPipeline } from "./runner.js";

export function runAskAIOrchestrationPipeline(db: SqliteDatabase, input: { question: string; transcriptIds?: string[]; userId?: string }, options: { idempotencyKey?: string; now?: () => Date } = {}) {
  const profile = input.userId ? buildHermesContext(input.userId, db) : undefined;
  const filters = profile ? applyHermesDefaultFilters({ transcriptIds: input.transcriptIds }, profile).filters : { transcriptIds: input.transcriptIds };
  return runPipeline(db, createDefaultAgentRegistry(), {
    pipelineType: "ask_ai", input: { ...input, transcriptIds: filters.transcriptIds }, idempotencyKey: options.idempotencyKey, now: options.now, hermesProfile: profile,
    steps: ["retrieval_ranking", "evidence_validation", "contradiction_detection", "answer_synthesis"].map((agentType) => ({ agentType: agentType as "retrieval_ranking", required: true })),
  });
}
