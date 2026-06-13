import type { SqliteDatabase } from "../db/connection.js";
import { resolveEvidencePointer } from "../provenance/index.js";
import { frontmatter, generatedWarning, makeGeneratedFile, quote } from "./markdown.js";
import { evidencePath, transcriptPath, wikiLink } from "./paths.js";
import type { GeneratedFile } from "./types.js";

export function generateEvidenceNotes(db: SqliteDatabase, maxQuoteLength = 300): { files: GeneratedFile[]; warnings: string[] } {
  const rows = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers ORDER BY evidence_pointer_id").all() as Array<{ evidence_pointer_id: string }>;
  const warnings: string[] = [];
  const files = rows.map(({ evidence_pointer_id }) => {
    const resolved = resolveEvidencePointer(db, evidence_pointer_id);
    if (!resolved.ok) {
      warnings.push(`Broken evidence pointer ${evidence_pointer_id}: ${resolved.reason}`);
      return makeGeneratedFile("evidence_note", evidencePath(evidence_pointer_id), `${frontmatter({ mv_entity_type: "evidence", mv_entity_id: evidence_pointer_id, mv_generated: true, mv_source_of_truth: "sqlite" })}\n# Evidence ${evidence_pointer_id}\n\n${generatedWarning}\n\n> [!danger] Broken evidence pointer\n> ${resolved.reason}`, "evidence", evidence_pointer_id);
    }
    const title = (db.prepare("SELECT title FROM transcripts WHERE id=?").get(resolved.evidence.transcript_id) as { title: string }).title;
    const content = `${frontmatter({ mv_entity_type: "evidence", mv_entity_id: evidence_pointer_id, mv_generated: true, mv_source_of_truth: "sqlite", mv_support_status: resolved.evidence.evidence_strength, mv_confidence: resolved.evidence.confidence })}
# Evidence ${evidence_pointer_id}

${generatedWarning}

**Target:** \`${resolved.evidence.target_type}:${resolved.evidence.target_id}\`  
**Role:** ${resolved.evidence.evidence_role}  
**Strength:** ${resolved.evidence.evidence_strength}  
**Evidence URI:** \`${resolved.evidence.pointer_uri}\`  
**Source URI:** \`${resolved.evidence.source_pointer_uri}\`  
**Transcript span:** ${wikiLink(transcriptPath(title, resolved.evidence.transcript_id), `${title}, ${resolved.evidence.span_id}`, resolved.evidence.span_id)}

## Immutable Source Quote

${quote(resolved.spanText, maxQuoteLength)}`;
    return makeGeneratedFile("evidence_note", evidencePath(evidence_pointer_id), content, "evidence", evidence_pointer_id);
  });
  return { files, warnings };
}
