import type { Agent } from "../types.js";
export interface ChunkingOutput { transcriptId: string; turnIds: string[]; spanIds: string[]; spanCount: number; warnings: string[]; }
export const chunkingSpanAgent: Agent<{ transcriptId: string }, ChunkingOutput> = {
  type: "chunking_span",
  async run(input, context) {
    const turns = context.db.prepare("SELECT id FROM transcript_turns WHERE transcript_id=? ORDER BY turn_index").all(input.transcriptId) as Array<{ id: string }>;
    const spans = context.db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? ORDER BY span_index").all(input.transcriptId) as Array<{ id: string }>;
    return { transcriptId: input.transcriptId, turnIds: turns.map((row) => row.id), spanIds: spans.map((row) => row.id), spanCount: spans.length, warnings: spans.length ? [] : ["No transcript spans found."] };
  },
};
