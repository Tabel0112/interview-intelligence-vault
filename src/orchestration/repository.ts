import type { SqliteDatabase } from "../db/connection.js";
import { NotFoundError, ValidationError } from "../db/errors.js";
import { createId } from "../db/ids.js";
import type { AgentRun, AgentStatus, AgentType, JsonRecord, PipelineEvent, PipelineRun, PipelineStatus, PipelineType, ReprocessingJob } from "./types.js";

type Row = Record<string, unknown>;
const parseJson = (value: unknown): JsonRecord | null => value == null ? null : JSON.parse(String(value));
const pipeline = (row: Row): PipelineRun => ({ id: String(row.id), pipelineType: row.pipeline_type as PipelineType, status: row.status as PipelineStatus, input: parseJson(row.input_json)!, output: parseJson(row.output_json), error: parseJson(row.error_json), createdAt: String(row.created_at), startedAt: row.started_at == null ? null : String(row.started_at), completedAt: row.completed_at == null ? null : String(row.completed_at), idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key) });
const agent = (row: Row): AgentRun => ({ id: String(row.id), pipelineRunId: String(row.pipeline_run_id), agentType: row.agent_type as AgentType, status: row.status as AgentStatus, input: parseJson(row.input_json)!, output: parseJson(row.output_json), error: parseJson(row.error_json), createdAt: String(row.created_at), startedAt: row.started_at == null ? null : String(row.started_at), completedAt: row.completed_at == null ? null : String(row.completed_at) });
const job = (row: Row): ReprocessingJob => ({ id: String(row.id), transcriptId: String(row.transcript_id), reason: row.reason as ReprocessingJob["reason"], status: row.status as PipelineStatus, requestedBy: String(row.requested_by), createdAt: String(row.created_at), startedAt: row.started_at == null ? null : String(row.started_at), completedAt: row.completed_at == null ? null : String(row.completed_at), error: parseJson(row.error_json) });

export function createOrchestrationRepository(db: SqliteDatabase, options: { now?: () => Date } = {}) {
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const getPipelineRun = (id: string) => { const row = db.prepare("SELECT * FROM pipeline_runs WHERE id=?").get(id) as Row | undefined; return row ? pipeline(row) : null; };
  const finishPipeline = (id: string, status: "completed" | "failed", value: JsonRecord) => {
    const field = status === "completed" ? "output_json" : "error_json";
    const result = db.prepare(`UPDATE pipeline_runs SET status=?,${field}=?,completed_at=? WHERE id=? AND status='running'`).run(status, JSON.stringify(value), now(), id);
    if (!result.changes) throw new NotFoundError(`Running pipeline not found: ${id}`);
    return getPipelineRun(id)!;
  };
  const finishAgent = (id: string, status: "completed" | "failed" | "skipped", value: JsonRecord) => {
    const field = status === "completed" ? "output_json" : status === "failed" ? "error_json" : "output_json";
    const result = db.prepare(`UPDATE agent_runs SET status=?,${field}=?,completed_at=? WHERE id=? AND status IN ('pending','running')`).run(status, JSON.stringify(value), now(), id);
    if (!result.changes) throw new NotFoundError(`Pending/running agent not found: ${id}`);
    return agent(db.prepare("SELECT * FROM agent_runs WHERE id=?").get(id) as Row);
  };
  const finishJob = (id: string, status: "completed" | "failed", error?: JsonRecord) => {
    const result = db.prepare("UPDATE reprocessing_jobs SET status=?,error_json=?,completed_at=? WHERE id=? AND status='running'").run(status, error ? JSON.stringify(error) : null, now(), id);
    if (!result.changes) throw new NotFoundError(`Running reprocessing job not found: ${id}`);
    return job(db.prepare("SELECT * FROM reprocessing_jobs WHERE id=?").get(id) as Row);
  };
  return {
    createPipelineRun(input: { pipelineType: PipelineType; input: JsonRecord; idempotencyKey?: string }): PipelineRun {
      const id = createId("pipe_"), timestamp = now();
      db.prepare("INSERT INTO pipeline_runs(id,pipeline_type,status,input_json,created_at,idempotency_key) VALUES (?,?,?,?,?,?)")
        .run(id, input.pipelineType, "pending", JSON.stringify(input.input), timestamp, input.idempotencyKey ?? null);
      return getPipelineRun(id)!;
    },
    getPipelineRun,
    getPipelineRunByIdempotencyKey(key: string): PipelineRun | null { const row = db.prepare("SELECT * FROM pipeline_runs WHERE idempotency_key=?").get(key) as Row | undefined; return row ? pipeline(row) : null; },
    startPipelineRun(id: string): PipelineRun { db.prepare("UPDATE pipeline_runs SET status='running',started_at=? WHERE id=? AND status='pending'").run(now(), id); return getPipelineRun(id) ?? (() => { throw new NotFoundError(`Pipeline not found: ${id}`); })(); },
    completePipelineRun(id: string, output: JsonRecord): PipelineRun { return finishPipeline(id, "completed", output); },
    failPipelineRun(id: string, error: JsonRecord): PipelineRun { return finishPipeline(id, "failed", error); },
    createAgentRun(input: { pipelineRunId: string; agentType: AgentType; input: JsonRecord }): AgentRun {
      const id = createId("agent_");
      db.prepare("INSERT INTO agent_runs(id,pipeline_run_id,agent_type,status,input_json,created_at) VALUES (?,?,?,?,?,?)").run(id, input.pipelineRunId, input.agentType, "pending", JSON.stringify(input.input), now());
      return agent(db.prepare("SELECT * FROM agent_runs WHERE id=?").get(id) as Row);
    },
    startAgentRun(id: string): AgentRun { db.prepare("UPDATE agent_runs SET status='running',started_at=? WHERE id=? AND status='pending'").run(now(), id); return agent(db.prepare("SELECT * FROM agent_runs WHERE id=?").get(id) as Row); },
    completeAgentRun(id: string, output: JsonRecord): AgentRun { return finishAgent(id, "completed", output); },
    failAgentRun(id: string, error: JsonRecord): AgentRun { return finishAgent(id, "failed", error); },
    skipAgentRun(id: string, output: JsonRecord = {}): AgentRun { return finishAgent(id, "skipped", output); },
    listAgentRunsForPipeline(id: string): AgentRun[] { return (db.prepare("SELECT * FROM agent_runs WHERE pipeline_run_id=? ORDER BY rowid").all(id) as Row[]).map(agent); },
    appendPipelineEvent(input: { pipelineRunId: string; agentRunId?: string; eventType: string; message: string; metadata?: JsonRecord }): PipelineEvent {
      const row = { id: createId("pe_"), pipeline_run_id: input.pipelineRunId, agent_run_id: input.agentRunId ?? null, event_type: input.eventType, message: input.message, metadata_json: JSON.stringify(input.metadata ?? {}), created_at: now() };
      db.prepare("INSERT INTO pipeline_events(id,pipeline_run_id,agent_run_id,event_type,message,metadata_json,created_at) VALUES (@id,@pipeline_run_id,@agent_run_id,@event_type,@message,@metadata_json,@created_at)").run(row);
      return { id: row.id, pipelineRunId: row.pipeline_run_id, agentRunId: row.agent_run_id, eventType: row.event_type, message: row.message, metadata: JSON.parse(row.metadata_json), createdAt: row.created_at };
    },
    createReprocessingJob(input: { transcriptId: string; reason: ReprocessingJob["reason"]; requestedBy?: string }): ReprocessingJob {
      const id = createId("rjob_");
      db.prepare("INSERT INTO reprocessing_jobs(id,transcript_id,reason,status,requested_by,created_at) VALUES (?,?,?,?,?,?)").run(id, input.transcriptId, input.reason, "pending", input.requestedBy ?? "local_user", now());
      return job(db.prepare("SELECT * FROM reprocessing_jobs WHERE id=?").get(id) as Row);
    },
    startReprocessingJob(id: string): ReprocessingJob { const result = db.prepare("UPDATE reprocessing_jobs SET status='running',started_at=? WHERE id=? AND status='pending'").run(now(), id); if (!result.changes) throw new ValidationError(`Pending reprocessing job not found: ${id}`); return job(db.prepare("SELECT * FROM reprocessing_jobs WHERE id=?").get(id) as Row); },
    completeReprocessingJob(id: string): ReprocessingJob { return finishJob(id, "completed"); },
    failReprocessingJob(id: string, error: JsonRecord): ReprocessingJob { return finishJob(id, "failed", error); },
    listPendingReprocessingJobs(): ReprocessingJob[] { return (db.prepare("SELECT * FROM reprocessing_jobs WHERE status='pending' ORDER BY created_at,id").all() as Row[]).map(job); },
  };
}
