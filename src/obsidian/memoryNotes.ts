import type { SqliteDatabase } from "../db/connection.js";
import { createConflictRepository } from "../conflicts/index.js";
import { getCanonicalMemoryObject, isStrongMemoryObject, type RawMemoryObjectForCanonical } from "../memory/canonical.js";
import { renderEvidenceCitation } from "./citations.js";
import { frontmatter, generatedWarning, makeGeneratedFile } from "./markdown.js";
import { conflictPath, memoryPath, wikiLink } from "./paths.js";
import type { GeneratedFile } from "./types.js";

export function generateMemoryNotes(db: SqliteDatabase, maxQuoteLength = 300): GeneratedFile[] {
  // Generate a note only for CANONICAL memories — duplicate/superseded/rejected rows are a disposable view
  // concern, excluded so the native graph shows one node per claim (full ids still live in SQLite).
  const rows = db.prepare(`SELECT * FROM memory_objects
    WHERE duplicate_of_id IS NULL AND status NOT IN ('superseded','rejected')
      AND (extraction_status IS NULL OR extraction_status NOT IN ('superseded','rejected'))
    ORDER BY id`).all() as RawMemoryObjectForCanonical[];
  return rows.map((row) => {
    const pointers = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id=? ORDER BY evidence_pointer_id").all(row.id) as Array<{ evidence_pointer_id: string }>;
    const legacy = db.prepare("SELECT span_id FROM memory_object_evidence WHERE memory_id=? ORDER BY span_id").all(row.id) as Array<{ span_id: string }>;
    const canonical = getCanonicalMemoryObject(row, [...legacy.map((x) => x.span_id)]);
    const conflicts = createConflictRepository(db).listConflictsForTarget("memory_object", row.id);
    const citations = pointers.map((pointer, index) => `${index + 1}. ${renderEvidenceCitation(db, pointer.evidence_pointer_id, maxQuoteLength).markdown}`).join("\n\n");
    const strongest = pointers.length ? (db.prepare(`SELECT evidence_strength FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id=?
      ORDER BY CASE evidence_strength WHEN 'strong' THEN 1 WHEN 'mixed' THEN 2 WHEN 'conflicting' THEN 3 WHEN 'weak' THEN 4 ELSE 5 END LIMIT 1`).get(row.id) as { evidence_strength: string }).evidence_strength : "unsupported";
    const warning = strongest === "weak" || strongest === "unknown" || !isStrongMemoryObject(canonical)
      ? "> [!caution] Weak or review-only evidence\n> This memory must not be treated as strong truth."
      : strongest === "conflicting" || conflicts.some((item) => item.status === "active")
        ? "> [!warning] Conflicting evidence\n> Both sides must be reviewed." : "";
    const title = canonical.title || canonical.body.slice(0, 80) || row.id;
    const conflictLinks = conflicts.map((item) => `- ${wikiLink(conflictPath(item.summary, item.id), item.summary)}`).join("\n") || "_None._";
    const content = `${frontmatter({ mv_entity_type: "memory", mv_entity_id: row.id, mv_generated: true, mv_source_of_truth: "sqlite", mv_support_status: strongest, mv_confidence: canonical.confidence })}
# ${title}

#tmv/memory

${generatedWarning}

${warning}

**Type:** ${canonical.type}  
**Status:** ${canonical.status}  
**Confidence:** ${canonical.confidence.toFixed(3)}  
**Evidence quality:** ${strongest}

## Generated Memory

> [!note] Generated text
> ${canonical.body.replace(/\n/g, "\n> ")}

## Source Evidence

${citations || "> [!danger] Unsupported memory\n> No evidence pointer resolves this generated object."}

## Conflicts / Tensions

${conflictLinks}`;
    return makeGeneratedFile("memory_note", memoryPath(title, row.id, String(canonical.type)), content, "memory", row.id);
  });
}
