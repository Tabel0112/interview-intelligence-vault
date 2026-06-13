import { createConflictRepository, detectConflicts, type ConflictStatement } from "../../conflicts/index.js";
import type { Agent } from "../types.js";
export const contradictionDetectionAgent: Agent<{ selectedEvidencePointerIds?: string[]; transcriptId?: string }, Record<string, unknown>> = {
  type: "contradiction_detection",
  async run(input, context) {
    const repo = createConflictRepository(context.db, { now: context.now });
    if (!input.selectedEvidencePointerIds?.length && input.transcriptId) {
      const rows = context.db.prepare(`SELECT m.id,m.generated_text,m.created_at,e.evidence_pointer_id
        FROM memory_objects m JOIN evidence_pointers e ON e.target_id=m.id AND e.target_type IN ('memory_object','claim','summary')
        WHERE e.transcript_id=? AND COALESCE(m.extraction_status,m.status)='active'
        ORDER BY m.id,e.evidence_pointer_id`).all(input.transcriptId) as Array<{ id: string; generated_text: string; created_at: string; evidence_pointer_id: string }>;
      const statements = [...new Set(rows.map((row) => row.id))].map((id): ConflictStatement => {
        const targets = rows.filter((row) => row.id === id);
        return { targetId: id, targetType: "memory_object", text: targets[0].generated_text, timestamp: targets[0].created_at, evidenceIds: targets.map((row) => row.evidence_pointer_id) };
      });
      for (const detected of detectConflicts(statements)) {
        if (detected.classification.kind !== "weak_or_ambiguous") repo.createConflictAssessment(detected);
      }
    }
    const conflicts = input.selectedEvidencePointerIds?.length ? repo.listActiveForEvidencePointers(input.selectedEvidencePointerIds) : repo.listActiveConflicts();
    return { contradictionIds: conflicts.filter((item) => item.kind === "direct_contradiction").map((item) => item.id), tensionIds: conflicts.filter((item) => item.kind === "tension").map((item) => item.id), conflictGroups: conflicts.map((item) => ({ id: item.id, supportingEvidenceIds: item.evidenceLinks.filter((link) => link.side === "left").map((link) => link.evidencePointerId), opposingEvidenceIds: item.evidenceLinks.filter((link) => link.side === "right").map((link) => link.evidencePointerId), summary: item.summary })), warnings: [] };
  },
};
