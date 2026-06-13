import type { SqliteDatabase } from "../db/connection.js";
import type { HermesProfile } from "../hermes/types.js";

export type PipelineType = "transcript_import" | "transcript_reprocess" | "ask_ai" | "cleanup" | "contradiction_scan";
export type PipelineStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type AgentType = "ingestion" | "chunking_span" | "extraction" | "evidence_validation" | "retrieval_ranking" | "contradiction_detection" | "answer_synthesis" | "cleanup_reprocessing";
export type AgentStatus = "pending" | "running" | "completed" | "failed" | "skipped";
export type JsonRecord = Record<string, unknown>;

export interface PipelineRun { id: string; pipelineType: PipelineType; status: PipelineStatus; input: JsonRecord; output: JsonRecord | null; error: JsonRecord | null; createdAt: string; startedAt: string | null; completedAt: string | null; idempotencyKey: string | null; }
export interface AgentRun { id: string; pipelineRunId: string; agentType: AgentType; status: AgentStatus; input: JsonRecord; output: JsonRecord | null; error: JsonRecord | null; createdAt: string; startedAt: string | null; completedAt: string | null; }
export interface PipelineEvent { id: string; pipelineRunId: string; agentRunId: string | null; eventType: string; message: string; metadata: JsonRecord; createdAt: string; }
export interface ReprocessingJob { id: string; transcriptId: string; reason: "settings_changed" | "extraction_rules_changed" | "manual_reprocess" | "schema_upgrade" | "cleanup"; status: PipelineStatus; requestedBy: string; createdAt: string; startedAt: string | null; completedAt: string | null; error: JsonRecord | null; }
export interface PipelineLogger { event(eventType: string, message: string, metadata?: JsonRecord): void; }
export interface AgentContext { pipelineRunId: string; agentRunId: string; now: () => Date; db: SqliteDatabase; logger: PipelineLogger; readonly hermesProfile?: Readonly<HermesProfile>; }
export interface AgentResult<T> { ok: boolean; output?: T; error?: JsonRecord; warnings: string[]; }
export interface PipelineResult<T> { pipelineRunId: string; status: PipelineStatus; output?: T; error?: JsonRecord; reused: boolean; }
export interface Agent<I, O> { type: AgentType; run(input: I, context: AgentContext): Promise<O>; }
export interface PipelineStep<I = unknown, O = unknown> { agentType: AgentType; required: boolean; run?: (input: I, context: AgentContext) => Promise<O>; }
export interface RunPipelineOptions<I> { pipelineType: PipelineType; input: I; steps: PipelineStep[]; idempotencyKey?: string; now?: () => Date; hermesProfile?: Readonly<HermesProfile>; }
