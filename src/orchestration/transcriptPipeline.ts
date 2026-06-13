import type { SqliteDatabase } from "../db/connection.js";
import type { MemoryExtractor } from "../memory/extraction/index.js";
import { createDefaultAgentRegistry } from "./defaultRegistry.js";
import { runPipeline } from "./runner.js";
import type { JsonRecord } from "./types.js";

const steps = ["ingestion", "chunking_span", "extraction", "evidence_validation", "contradiction_detection", "cleanup_reprocessing"] as const;
export function runTranscriptImportPipeline(db: SqliteDatabase, input: { sourceName: string; rawText: string }, options: { extractor?: MemoryExtractor; idempotencyKey?: string; now?: () => Date } = {}) {
  return runPipeline(db, createDefaultAgentRegistry({ extractor: options.extractor }), { pipelineType: "transcript_import", input, idempotencyKey: options.idempotencyKey, now: options.now, steps: steps.map((agentType) => ({ agentType, required: agentType !== "contradiction_detection" && agentType !== "cleanup_reprocessing" })) });
}
export function runTranscriptReprocessPipeline(db: SqliteDatabase, input: JsonRecord & { transcriptId: string }, options: { extractor?: MemoryExtractor; idempotencyKey?: string; now?: () => Date } = {}) {
  const registry = createDefaultAgentRegistry({ extractor: options.extractor });
  const reprocessOldMemoryIds = (db.prepare(`SELECT DISTINCT m.id FROM memory_objects m JOIN memory_object_evidence e ON e.memory_id=m.id
    JOIN transcript_spans s ON s.id=e.span_id WHERE s.transcript_id=? AND m.status!='superseded'`).all(input.transcriptId) as Array<{ id: string }>).map((row) => row.id);
  return runPipeline(db, registry, { pipelineType: "transcript_reprocess", input: { ...input, reprocessOldMemoryIds }, idempotencyKey: options.idempotencyKey, now: options.now, steps: ["chunking_span", "extraction", "evidence_validation", "contradiction_detection", "cleanup_reprocessing"].map((agentType) => ({ agentType: agentType as typeof steps[number], required: agentType !== "contradiction_detection" && agentType !== "cleanup_reprocessing" })) });
}
