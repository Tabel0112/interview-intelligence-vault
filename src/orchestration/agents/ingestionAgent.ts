import { importTranscript } from "../../ingest/index.js";
import type { Agent } from "../types.js";

export interface IngestionInput { sourceName: string; rawText: string; formatHint?: "txt" | "md" | "srt" | "vtt"; }
export interface IngestionOutput { transcriptId: string; duplicate: boolean; warnings: string[]; }
export const ingestionAgent: Agent<IngestionInput, IngestionOutput> = {
  type: "ingestion",
  async run(input, context) {
    const result = importTranscript(context.db, { filename: input.sourceName, rawText: input.rawText, importedAt: context.now().toISOString() });
    return { transcriptId: result.transcriptId, duplicate: result.status === "duplicate", warnings: result.warning ? [result.warning] : [] };
  },
};
