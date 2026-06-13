import type { Agent } from "../types.js";
export const cleanupReprocessingAgent: Agent<{ transcriptId?: string; reprocessOldMemoryIds?: string[]; memoryObjectIds?: string[] }, Record<string, unknown>> = {
  type: "cleanup_reprocessing",
  async run(input, context) {
    const preserved = input.transcriptId ? [input.transcriptId] : (context.db.prepare("SELECT id FROM transcripts ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id);
    const supersededGeneratedObjectIds = input.memoryObjectIds?.length ? (input.reprocessOldMemoryIds ?? []).filter((id) => {
      const result = context.db.prepare(`UPDATE memory_objects SET status='superseded',
        extraction_status=CASE WHEN extraction_status IS NULL THEN NULL ELSE 'superseded' END,updated_at=?
        WHERE id=? AND user_corrected=0 AND status!='superseded'`).run(context.now().toISOString(), id);
      return result.changes > 0;
    }) : [];
    return { supersededGeneratedObjectIds, preservedRawTranscriptIds: preserved, warnings: [] };
  },
};
