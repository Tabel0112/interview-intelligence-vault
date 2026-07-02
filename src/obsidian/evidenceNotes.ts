import type { SqliteDatabase } from "../db/connection.js";
import { resolveEvidencePointer } from "../provenance/index.js";
import { frontmatter, generatedWarning, makeGeneratedFile, quote } from "./markdown.js";
import { evidencePath, memoryPath, transcriptPath, wikiLink } from "./paths.js";
import type { GeneratedFile } from "./types.js";

export function generateEvidenceNotes(db: SqliteDatabase, maxQuoteLength = 300): { files: GeneratedFile[]; warnings: string[] } {
  const rows = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers ORDER BY evidence_pointer_id").all() as Array<{ evidence_pointer_id: string }>;
  const warnings: string[] = [];
  const files = rows.map(({ evidence_pointer_id }) => {
    const resolved = resolveEvidencePointer(db, evidence_pointer_id);
    if (!resolved.ok) {
      warnings.push(`Broken evidence pointer ${evidence_pointer_id}: ${resolved.reason}`);
      return makeGeneratedFile("evidence_note", evidencePath("Broken evidence", evidence_pointer_id), `${frontmatter({ mv_entity_type: "evidence", mv_entity_id: evidence_pointer_id, mv_generated: true, mv_source_of_truth: "sqlite" })}\n# Evidence ${evidence_pointer_id}\n\n#tmv/evidence\n\n${generatedWarning}\n\n> [!danger] Broken evidence pointer\n> ${resolved.reason}`, "evidence", evidence_pointer_id);
    }
    const title = (db.prepare("SELECT title FROM transcripts WHERE id=?").get(resolved.evidence.transcript_id) as { title: string }).title;
    // Meaningful edge: evidence -> its CANONICAL target memory (linked only when that memory note exists, so
    // we never create a broken wikilink to a superseded/duplicate memory). Other target types stay as text.
    let targetLink = `\`${resolved.evidence.target_type}:${resolved.evidence.target_id}\``;
    if (["memory_object", "claim", "summary"].includes(resolved.evidence.target_type)) {
      const memory = db.prepare(`SELECT title, generated_text, COALESCE(extraction_type,type) AS type FROM memory_objects
        WHERE id=? AND duplicate_of_id IS NULL AND status NOT IN ('superseded','rejected')
          AND (extraction_status IS NULL OR extraction_status NOT IN ('superseded','rejected'))`).get(resolved.evidence.target_id) as { title: string | null; generated_text: string; type: string } | undefined;
      if (memory) {
        const memoryTitle = memory.title ?? memory.generated_text.slice(0, 80);
        // Use memoryPath (Memories/<folder>/...) — the same note conflictNotes/memoryNotes use — so the
        // chain stays consistent for every memory type, including decisions.
        targetLink = wikiLink(memoryPath(memoryTitle, resolved.evidence.target_id, memory.type), memoryTitle);
      }
    }
    const content = `${frontmatter({ mv_entity_type: "evidence", mv_entity_id: evidence_pointer_id, mv_generated: true, mv_source_of_truth: "sqlite", mv_support_status: resolved.evidence.evidence_strength, mv_confidence: resolved.evidence.confidence })}
# Evidence ${evidence_pointer_id}

#tmv/evidence

${generatedWarning}

**Target:** ${targetLink}
**Role:** ${resolved.evidence.evidence_role}
**Strength:** ${resolved.evidence.evidence_strength}
**Evidence URI:** \`${resolved.evidence.pointer_uri}\`
**Source URI:** \`${resolved.evidence.source_pointer_uri}\`
**Transcript span:** ${wikiLink(transcriptPath(title, resolved.evidence.transcript_id), `${title}, ${resolved.evidence.span_id}`, resolved.evidence.span_id)}

## Immutable Source Quote

${quote(resolved.spanText, maxQuoteLength)}`;
    return makeGeneratedFile("evidence_note", evidencePath(resolved.spanText, evidence_pointer_id), content, "evidence", evidence_pointer_id);
  });
  return { files, warnings };
}
