import type { SqliteDatabase } from "../db/connection.js";
import { createConflictRepository } from "../conflicts/index.js";
import { renderEvidenceCitation } from "./citations.js";
import { frontmatter, generatedWarning, makeGeneratedFile } from "./markdown.js";
import { conflictPath, memoryPath, wikiLink } from "./paths.js";
import type { GeneratedFile } from "./types.js";

export function generateConflictNotes(db: SqliteDatabase, maxQuoteLength = 300): GeneratedFile[] {
  return (db.prepare("SELECT id FROM conflict_assessments ORDER BY id").all() as Array<{ id: string }>).map(({ id }) => {
    const conflict = createConflictRepository(db).getConflictAssessment(id)!;
    const side = (targetType: string, targetId: string, name: string) => {
      const memory = targetType === "memory_object" || targetType === "claim" || targetType === "summary"
        ? db.prepare("SELECT title,generated_text,type FROM memory_objects WHERE id=?").get(targetId) as { title: string | null; generated_text: string; type: string } | undefined : undefined;
      const links = conflict.evidenceLinks.filter((item) => item.side === name.toLowerCase()).map((item) => renderEvidenceCitation(db, item.evidencePointerId, maxQuoteLength).markdown).join("\n\n");
      return `### ${name} Side

**Target:** ${memory ? wikiLink(memoryPath(memory.title ?? memory.generated_text.slice(0, 80), targetId, memory.type), memory.title ?? targetId) : `\`${targetType}:${targetId}\``}

${links || "> [!danger] Missing side evidence"}`;
    };
    return makeGeneratedFile("conflict_note", conflictPath(conflict.summary, id), `${frontmatter({ mv_entity_type: "conflict", mv_entity_id: id, mv_generated: true, mv_source_of_truth: "sqlite", mv_support_status: conflict.status, mv_confidence: conflict.confidence })}
# ${conflict.summary}

${generatedWarning}

> [!warning] Conflict / tension
> Both sides are shown. This generated view does not resolve transcript truth.

**Type:** ${conflict.kind}  
**Status:** ${conflict.status}  
**Confidence:** ${conflict.confidence.toFixed(3)}  
**Resolution:** ${conflict.resolutionNote ?? "Unresolved"}

${side(conflict.leftTargetType, conflict.leftTargetId, "Left")}

${side(conflict.rightTargetType, conflict.rightTargetId, "Right")}

## Generated Explanation

${conflict.explanation}`, "conflict", id);
  });
}
