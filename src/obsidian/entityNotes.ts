import type { SqliteDatabase } from "../db/connection.js";
import { renderEvidenceCitation } from "./citations.js";
import { frontmatter, generatedWarning, makeGeneratedFile } from "./markdown.js";
import { entityPath, wikiLink } from "./paths.js";
import type { GeneratedFile } from "./types.js";

export function generateEntityNotes(db: SqliteDatabase): GeneratedFile[] {
  const graphRows = db.prepare("SELECT * FROM graph_nodes WHERE node_type IN ('entity','topic') ORDER BY node_type,id").all() as Array<Record<string, unknown>>;
  const decisions = db.prepare("SELECT id,title,generated_text,status FROM memory_objects WHERE COALESCE(extraction_type,type)='decision' ORDER BY id").all() as Array<Record<string, unknown>>;
  const graphNotes = graphRows.map((row) => {
    const kind = row.node_type === "entity" ? "person" : "topic";
    const evidence = (db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type='graph_node' AND target_id=? ORDER BY evidence_pointer_id").all(row.id) as Array<{ evidence_pointer_id: string }>)
      .map((item) => renderEvidenceCitation(db, item.evidence_pointer_id).markdown).join("\n\n") || "_No direct source evidence pointers._";
    const related = (db.prepare(`SELECT other.label,other.node_type,other.ref_id,e.edge_type FROM graph_edges e
      JOIN graph_nodes other ON other.id=CASE WHEN e.from_node_id=? THEN e.to_node_id ELSE e.from_node_id END
      WHERE e.from_node_id=? OR e.to_node_id=? ORDER BY other.label`).all(row.id, row.id, row.id) as Array<{ label: string; node_type: string; ref_id: string; edge_type: string }>)
      .map((item) => `- ${item.edge_type}: ${item.node_type === "entity" || item.node_type === "topic" ? wikiLink(entityPath(item.node_type === "entity" ? "person" : "topic", item.label, item.ref_id), item.label) : item.label}`).join("\n") || "_No related graph objects._";
    return makeGeneratedFile(kind === "person" ? "person_note" : "topic_note", entityPath(kind, String(row.label), String(row.ref_id)), `${frontmatter({ mv_entity_type: kind, mv_entity_id: String(row.ref_id), mv_generated: true, mv_source_of_truth: "sqlite" })}
# ${row.label}

${generatedWarning}

This is a generated ${kind} view. Related source-backed relationships appear in graph views.

**Graph node:** \`${row.id}\`

## Source Evidence

${evidence}

## Related

${related}`, kind, String(row.ref_id));
  });
  const decisionNotes = decisions.map((row) => {
    const evidence = (db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id=? ORDER BY evidence_pointer_id").all(row.id) as Array<{ evidence_pointer_id: string }>)
      .map((item) => renderEvidenceCitation(db, item.evidence_pointer_id).markdown).join("\n\n") || "> [!danger] Unsupported decision\n> No evidence pointers.";
    return makeGeneratedFile("decision_note", entityPath("decision", String(row.title ?? row.generated_text), String(row.id)), `${frontmatter({ mv_entity_type: "decision", mv_entity_id: String(row.id), mv_generated: true, mv_source_of_truth: "sqlite", mv_support_status: String(row.status) })}
# ${row.title ?? "Decision"}

${generatedWarning}

> [!note] Generated decision text
> ${String(row.generated_text).replace(/\n/g, "\n> ")}

## Source Evidence

${evidence}`, "decision", String(row.id));
  });
  return [...graphNotes, ...decisionNotes];
}
