import type { SqliteDatabase } from "../db/connection.js";
import { ValidationError } from "../db/errors.js";
import { AgentRegistry } from "./agentRegistry.js";
import { createOrchestrationRepository } from "./repository.js";
import type { AgentContext, JsonRecord, PipelineResult, RunPipelineOptions } from "./types.js";

const errorRecord = (error: unknown): JsonRecord => ({ message: error instanceof Error ? error.message : String(error) });

export async function runPipeline<I extends JsonRecord, O extends JsonRecord = JsonRecord>(
  db: SqliteDatabase, registry: AgentRegistry, options: RunPipelineOptions<I>,
): Promise<PipelineResult<O>> {
  const repo = createOrchestrationRepository(db, { now: options.now });
  if (options.idempotencyKey) {
    const existing = repo.getPipelineRunByIdempotencyKey(options.idempotencyKey);
    if (existing?.status === "completed") return { pipelineRunId: existing.id, status: "completed", output: existing.output as O, reused: true };
    if (existing) throw new ValidationError(`Pipeline with idempotency key is already ${existing.status}: ${options.idempotencyKey}`);
  }
  registry.verify(options.steps.filter((step) => !step.run).map((step) => step.agentType));
  const pipeline = repo.createPipelineRun({ pipelineType: options.pipelineType, input: options.input, idempotencyKey: options.idempotencyKey });
  repo.startPipelineRun(pipeline.id);
  repo.appendPipelineEvent({ pipelineRunId: pipeline.id, eventType: "pipeline_started", message: `${options.pipelineType} pipeline started` });
  let state: JsonRecord = { ...options.input };
  try {
    for (const step of options.steps) {
      const run = repo.createAgentRun({ pipelineRunId: pipeline.id, agentType: step.agentType, input: state });
      repo.startAgentRun(run.id);
      const logger = { event: (eventType: string, message: string, metadata: JsonRecord = {}) => repo.appendPipelineEvent({ pipelineRunId: pipeline.id, agentRunId: run.id, eventType, message, metadata }) };
      const context: AgentContext = { pipelineRunId: pipeline.id, agentRunId: run.id, now: options.now ?? (() => new Date()), db, logger, hermesProfile: options.hermesProfile, synthesis: options.synthesis };
      logger.event("agent_started", `${step.agentType} started`);
      try {
        const output = await (step.run ? step.run(state, context) : registry.get(step.agentType).run(state, context)) as unknown;
        const objectOutput: JsonRecord = typeof output === "object" && output != null ? output as JsonRecord : { value: output };
        state = { ...state, ...objectOutput };
        repo.completeAgentRun(run.id, objectOutput);
        logger.event("agent_completed", `${step.agentType} completed`);
      } catch (error) {
        const failure = errorRecord(error);
        repo.failAgentRun(run.id, failure);
        logger.event("agent_failed", `${step.agentType} failed`, failure);
        if (step.required) throw error;
        state = { ...state, warnings: [...(Array.isArray(state.warnings) ? state.warnings : []), `${step.agentType}: ${failure.message}`] };
      }
    }
    repo.completePipelineRun(pipeline.id, state);
    repo.appendPipelineEvent({ pipelineRunId: pipeline.id, eventType: "pipeline_completed", message: `${options.pipelineType} pipeline completed` });
    return { pipelineRunId: pipeline.id, status: "completed", output: state as O, reused: false };
  } catch (error) {
    const failure = errorRecord(error);
    repo.failPipelineRun(pipeline.id, failure);
    repo.appendPipelineEvent({ pipelineRunId: pipeline.id, eventType: "pipeline_failed", message: `${options.pipelineType} pipeline failed`, metadata: failure });
    return { pipelineRunId: pipeline.id, status: "failed", error: failure, reused: false };
  }
}
