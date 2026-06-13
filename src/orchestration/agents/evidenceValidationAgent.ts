import { resolveEvidencePointer } from "../../provenance/index.js";
import type { Agent } from "../types.js";
export interface EvidenceValidationOutput { validatedPointerIds: string[]; brokenPointerIds: string[]; unsupportedGeneratedObjectIds: string[]; validationSummary: { strong: number; weak: number; missing: number; conflicting: number }; warnings: string[]; }
export const evidenceValidationAgent: Agent<{ selectedEvidencePointerIds?: string[]; transcriptId?: string }, EvidenceValidationOutput> = {
  type: "evidence_validation",
  async run(input, context) {
    const ids = input.selectedEvidencePointerIds ?? (context.db.prepare(`SELECT e.evidence_pointer_id FROM evidence_pointers e
      ${input.transcriptId ? "WHERE e.transcript_id=?" : ""} ORDER BY e.created_at,e.evidence_pointer_id`).all(...(input.transcriptId ? [input.transcriptId] : [])) as Array<{ evidence_pointer_id: string }>).map((row) => row.evidence_pointer_id);
    const validatedPointerIds = ids.filter((id) => resolveEvidencePointer(context.db, id).ok);
    const brokenPointerIds = ids.filter((id) => !validatedPointerIds.includes(id));
    const unsupported = context.db.prepare(`SELECT id FROM memory_objects WHERE status IN ('active','needs_review') AND NOT EXISTS (
      SELECT 1 FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id=memory_objects.id
    ) AND NOT EXISTS (SELECT 1 FROM memory_object_evidence WHERE memory_id=memory_objects.id)`).all() as Array<{ id: string }>;
    const strengths = validatedPointerIds.map((id) => (context.db.prepare("SELECT evidence_strength FROM evidence_pointers WHERE evidence_pointer_id=?").get(id) as { evidence_strength: string }).evidence_strength);
    return { validatedPointerIds, brokenPointerIds, unsupportedGeneratedObjectIds: unsupported.map((row) => row.id), validationSummary: { strong: strengths.filter((x) => x === "strong").length, weak: strengths.filter((x) => x === "weak" || x === "unknown").length, missing: brokenPointerIds.length, conflicting: strengths.filter((x) => x === "conflicting").length }, warnings: brokenPointerIds.length ? ["Broken evidence pointers were excluded."] : [] };
  },
};
