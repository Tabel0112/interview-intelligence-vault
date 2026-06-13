export * from "./connection.js";
export * from "./errors.js";
export * from "./ids.js";
export * from "./schema.js";
export * from "./migrations/index.js";
export * from "./repositories/transcriptsRepo.js";
export * from "./repositories/spansRepo.js";
export * from "./repositories/runsRepo.js";
export * from "./repositories/memoryObjectsRepo.js";
export * from "./repositories/evidenceRepo.js";
export * from "./repositories/answersRepo.js";
export * from "./repositories/graphRepo.js";
export * from "./repositories/correctionsRepo.js";
export * from "./repositories/searchRepo.js";

import type { SqliteDatabase } from "./connection.js";
import { createAnswersRepo } from "./repositories/answersRepo.js";
import { createCorrectionsRepo } from "./repositories/correctionsRepo.js";
import { createEvidenceRepo } from "./repositories/evidenceRepo.js";
import { createGraphRepo } from "./repositories/graphRepo.js";
import { createMemoryObjectsRepo } from "./repositories/memoryObjectsRepo.js";
import { createRunsRepo } from "./repositories/runsRepo.js";
import { createSearchRepo } from "./repositories/searchRepo.js";
import { createSpansRepo } from "./repositories/spansRepo.js";
import { createTranscriptsRepo } from "./repositories/transcriptsRepo.js";

export function createRepositories(db: SqliteDatabase) {
  return {
    transcripts: createTranscriptsRepo(db),
    spans: createSpansRepo(db),
    runs: createRunsRepo(db),
    memoryObjects: createMemoryObjectsRepo(db),
    evidence: createEvidenceRepo(db),
    answers: createAnswersRepo(db),
    graph: createGraphRepo(db),
    corrections: createCorrectionsRepo(db),
    search: createSearchRepo(db),
  };
}
