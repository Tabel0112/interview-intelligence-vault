import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import {
  AgentRegistry, createOrchestrationRepository, runAskAIOrchestrationPipeline, runPendingReprocessingJobs,
  runPipeline, runTranscriptImportPipeline, runTranscriptReprocessPipeline,
} from "../src/orchestration/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";

const fixedNow = () => new Date("2026-06-12T12:00:00.000Z");

describe("generic orchestration runner", () => {
  let db: SqliteDatabase;
  beforeEach(() => { db = openDatabase(":memory:"); });
  afterEach(() => db.close());

  it("persists ordered agent runs/events, output, and completed idempotency reuse", async () => {
    const order: string[] = [], registry = new AgentRegistry();
    registry.register({ type: "ingestion", run: async () => { order.push("ingestion"); return { transcriptId: "tr_1" }; } });
    registry.register({ type: "chunking_span", run: async () => { order.push("chunking_span"); return { spanIds: ["sp_1"] }; } });
    const options = { pipelineType: "transcript_import" as const, input: { sourceName: "x", rawText: "raw" }, idempotencyKey: "import:x", now: fixedNow, steps: [{ agentType: "ingestion" as const, required: true }, { agentType: "chunking_span" as const, required: true }] };
    const first = await runPipeline(db, registry, options);
    const second = await runPipeline(db, registry, options);
    expect(order).toEqual(["ingestion", "chunking_span"]);
    expect(second).toMatchObject({ reused: true, pipelineRunId: first.pipelineRunId });
    const repo = createOrchestrationRepository(db, { now: fixedNow });
    expect(repo.listAgentRunsForPipeline(first.pipelineRunId).map((run) => run.agentType)).toEqual(order);
    expect(db.prepare("SELECT COUNT(*) count FROM pipeline_events WHERE pipeline_run_id=?").get(first.pipelineRunId)).toEqual({ count: 6 });
    expect(repo.getPipelineRun(first.pipelineRunId)?.output).toMatchObject({ transcriptId: "tr_1", spanIds: ["sp_1"] });
    expect(() => db.prepare("DELETE FROM pipeline_events WHERE pipeline_run_id=?").run(first.pipelineRunId)).toThrow();
  });

  it("fails safely for duplicate running keys and required failures, but continues optional failures", async () => {
    const registry = new AgentRegistry();
    registry.register({ type: "ingestion", run: async () => { throw new Error("required failed"); } });
    registry.register({ type: "contradiction_detection", run: async () => { throw new Error("optional failed"); } });
    registry.register({ type: "cleanup_reprocessing", run: async () => ({ preservedRawTranscriptIds: [] }) });
    const failed = await runPipeline(db, registry, { pipelineType: "cleanup", input: {}, now: fixedNow, steps: [{ agentType: "ingestion", required: true }] });
    expect(failed.status).toBe("failed");
    const continued = await runPipeline(db, registry, { pipelineType: "cleanup", input: {}, now: fixedNow, steps: [{ agentType: "contradiction_detection", required: false }, { agentType: "cleanup_reprocessing", required: true }] });
    expect(continued).toMatchObject({ status: "completed", output: { preservedRawTranscriptIds: [] } });
    createOrchestrationRepository(db, { now: fixedNow }).createPipelineRun({ pipelineType: "cleanup", input: {}, idempotencyKey: "running" });
    await expect(runPipeline(db, registry, { pipelineType: "cleanup", input: {}, idempotencyKey: "running", steps: [] })).rejects.toThrow("already pending");
  });

  it("runs the real transcript pipeline in order and preserves immutable raw text", async () => {
    const result = await runTranscriptImportPipeline(db, { sourceName: "meeting.txt", rawText: "Alex: Raw transcript truth remains immutable." }, { now: fixedNow });
    expect(result.status).toBe("completed");
    const output = result.output as { transcriptId: string; preservedRawTranscriptIds: string[] };
    expect(output.preservedRawTranscriptIds).toContain(output.transcriptId);
    expect(createOrchestrationRepository(db).listAgentRunsForPipeline(result.pipelineRunId).map((run) => run.agentType)).toEqual([
      "ingestion", "chunking_span", "extraction", "evidence_validation", "contradiction_detection", "cleanup_reprocessing",
    ]);
    expect(() => db.prepare("UPDATE transcripts SET raw_text='changed' WHERE id=?").run(output.transcriptId)).toThrow();
  });

  it("runs evidence-first Ask AI orchestration and persisted reprocessing jobs", async () => {
    const imported = await runTranscriptImportPipeline(db, { sourceName: "ask.txt", rawText: "Alex: Evidence is required." }, { now: fixedNow });
    const transcriptId = (imported.output as { transcriptId: string }).transcriptId;
    const answer = await runAskAIOrchestrationPipeline(db, { question: "What is required?", userId: "user_1" }, { now: fixedNow });
    expect(createOrchestrationRepository(db).listAgentRunsForPipeline(answer.pipelineRunId).map((run) => run.agentType)).toEqual([
      "retrieval_ranking", "evidence_validation", "contradiction_detection", "answer_synthesis",
    ]);
    expect(answer.output).toMatchObject({ evidenceQualitySummary: "no_evidence", evidenceQualityNotice: "Evidence is weak or missing." });
    const repo = createOrchestrationRepository(db, { now: fixedNow });
    const job = repo.createReprocessingJob({ transcriptId, reason: "manual_reprocess" });
    expect(await runPendingReprocessingJobs(db, { now: fixedNow })).toHaveLength(1);
    expect(db.prepare("SELECT status FROM reprocessing_jobs WHERE id=?").get(job.id)).toEqual({ status: "completed" });
  });

  it("uses validated evidence before answer synthesis and persists claims with citations", async () => {
    const imported = await runTranscriptImportPipeline(db, { sourceName: "evidence.txt", rawText: "Alex: SQLite is the structured source of truth." }, { now: fixedNow });
    const transcriptId = (imported.output as { transcriptId: string }).transcriptId;
    const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(transcriptId) as { id: string };
    const memory = createRepositories(db).memoryObjects.createMemoryObject(
      { type: "decision", generated_text: "SQLite is authoritative.", confidence: 0.95, created_by: "agent" },
      [{ span_id: span.id, role: "supports", evidence_score: 0.95 }],
    );
    const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId, spanId: span.id, evidenceStrength: "strong", confidence: 0.95 });
    await indexEvidencePointerForSearch(db, pointer.evidence_pointer_id);
    const result = await runAskAIOrchestrationPipeline(db, { question: "SQLite source truth", userId: "user" }, { now: fixedNow });
    expect(result.output).toMatchObject({ evidenceQualitySummary: "weak", evidenceQualityNotice: "Evidence is weak or missing.", selectedEvidencePointerIds: [pointer.evidence_pointer_id] });
    const output = result.output as { answerId: string; claimIds: string[]; citationIds: string[] };
    expect(output.claimIds).toHaveLength(1);
    expect(output.citationIds).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) count FROM citation_links WHERE answer_id=?").get(output.answerId)).toEqual({ count: 1 });
  });

  it("reprocessing supersedes generated objects when replacements exist without changing raw text", async () => {
    const imported = await runTranscriptImportPipeline(db, { sourceName: "reprocess.txt", rawText: "Alex: Keep provenance visible." }, { now: fixedNow });
    const transcriptId = (imported.output as { transcriptId: string }).transcriptId;
    const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(transcriptId) as { id: string };
    const old = createRepositories(db).memoryObjects.createMemoryObject(
      { type: "claim", generated_text: "Old generated view", confidence: 0.9, created_by: "agent" },
      [{ span_id: span.id, role: "supports", evidence_score: 0.9 }],
    );
    const rawBefore = (db.prepare("SELECT raw_text FROM transcripts WHERE id=?").get(transcriptId) as { raw_text: string }).raw_text;
    const direct = await runTranscriptReprocessPipeline(db, { transcriptId }, {
      now: fixedNow,
      extractor: { kind: "test", extract: async (window) => [{ type: "decision", title: "Visible provenance", body: "Keep provenance visible.", evidenceSpanIds: [window.spans[0].spanId], confidence: 0.95 }] },
    });
    expect(direct.output).toMatchObject({ supersededGeneratedObjectIds: [old.id] });
    expect(createRepositories(db).memoryObjects.getMemoryObject(old.id)?.status).toBe("superseded");
    expect((db.prepare("SELECT raw_text FROM transcripts WHERE id=?").get(transcriptId) as { raw_text: string }).raw_text).toBe(rawBefore);
  });
});
