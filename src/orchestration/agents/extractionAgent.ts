import { extractMemoryObjectsForTranscript, type MemoryExtractor } from "../../memory/extraction/index.js";
import type { Agent } from "../types.js";

export function createExtractionAgent(extractor?: MemoryExtractor): Agent<{ transcriptId: string }, Record<string, unknown>> {
  return {
    type: "extraction",
    async run(input, context) {
      if (!extractor) return { transcriptId: input.transcriptId, memoryObjectIds: [], warnings: ["Extraction skipped because no extractor was configured."] };
      const before = new Set((context.db.prepare("SELECT id FROM memory_objects").all() as Array<{ id: string }>).map((row) => row.id));
      const result = await extractMemoryObjectsForTranscript(context.db, { transcriptId: input.transcriptId, extractor });
      const memoryObjectIds = (context.db.prepare("SELECT id FROM memory_objects WHERE extraction_run_id=? ORDER BY id").all(result.extractionRunId) as Array<{ id: string }>).map((row) => row.id).filter((id) => !before.has(id));
      return { transcriptId: input.transcriptId, memoryObjectIds, extractionResult: result, warnings: result.errors };
    },
  };
}
