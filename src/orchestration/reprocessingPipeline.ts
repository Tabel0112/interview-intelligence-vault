import type { SqliteDatabase } from "../db/connection.js";
import type { MemoryExtractor } from "../memory/extraction/index.js";
import { createOrchestrationRepository } from "./repository.js";
import { runTranscriptReprocessPipeline } from "./transcriptPipeline.js";

export async function runPendingReprocessingJobs(db: SqliteDatabase, options: { extractor?: MemoryExtractor; now?: () => Date } = {}) {
  const repo = createOrchestrationRepository(db, { now: options.now }), results = [];
  for (const pending of repo.listPendingReprocessingJobs()) {
    repo.startReprocessingJob(pending.id);
    const result = await runTranscriptReprocessPipeline(db, { transcriptId: pending.transcriptId }, { extractor: options.extractor, idempotencyKey: `reprocess:${pending.id}`, now: options.now });
    if (result.status === "completed") repo.completeReprocessingJob(pending.id);
    else repo.failReprocessingJob(pending.id, result.error ?? { message: "Reprocessing failed" });
    results.push(result);
  }
  return results;
}
