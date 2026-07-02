// DORMANT / EXPERIMENTAL — NOT wired into the live product.
//
// This orchestration Ask AI pipeline (and the Hermes personalization it can apply) is NOT invoked by the
// live Obsidian frontend Ask AI, the dashboard, or the MCP `ask_vault` path — those call the evidence-first
// `askAI` pipeline directly (see src/frontend/sqliteApi.ts and src/mcp/server.ts), with no Hermes step.
// Negative tests (tests/liveAskAiNoHermes.test.ts) fail if the live module graph ever loads this path.
//
// If it is ever wired live, it already enforces the production rule: answer synthesis runs with
// `requireLlm` always on, so an external LLM must be injected via `options.synthesis` — otherwise the
// pipeline fails closed (setup-required). It can never emit deterministic/dev output.

import type { SqliteDatabase } from "../db/connection.js";
import { applyHermesDefaultFilters, buildHermesContext } from "../hermes/index.js";
import { createDefaultAgentRegistry } from "./defaultRegistry.js";
import { runPipeline } from "./runner.js";
import type { OrchestrationSynthesis } from "./types.js";

export function runAskAIOrchestrationPipeline(db: SqliteDatabase, input: { question: string; transcriptIds?: string[]; userId?: string }, options: { idempotencyKey?: string; now?: () => Date; synthesis?: OrchestrationSynthesis } = {}) {
  const profile = input.userId ? buildHermesContext(input.userId, db) : undefined;
  const filters = profile ? applyHermesDefaultFilters({ transcriptIds: input.transcriptIds }, profile).filters : { transcriptIds: input.transcriptIds };
  return runPipeline(db, createDefaultAgentRegistry(), {
    pipelineType: "ask_ai", input: { ...input, transcriptIds: filters.transcriptIds }, idempotencyKey: options.idempotencyKey, now: options.now, hermesProfile: profile,
    synthesis: options.synthesis,
    steps: ["retrieval_ranking", "evidence_validation", "contradiction_detection", "answer_synthesis"].map((agentType) => ({ agentType: agentType as "retrieval_ranking", required: true })),
  });
}
