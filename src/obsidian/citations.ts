import type { SqliteDatabase } from "../db/connection.js";
import { resolveEvidencePointer } from "../provenance/index.js";
import { evidencePath, transcriptPath, wikiLink } from "./paths.js";
import { quote } from "./markdown.js";

export function renderEvidenceCitation(db: SqliteDatabase, evidencePointerId: string, maxQuoteLength = 300): { markdown: string; broken: boolean } {
  const resolved = resolveEvidencePointer(db, evidencePointerId);
  if (!resolved.ok) return { markdown: `> [!danger] Broken evidence pointer\n> \`${evidencePointerId}\`: ${resolved.reason}`, broken: true };
  const title = (db.prepare("SELECT title FROM transcripts WHERE id=?").get(resolved.evidence.transcript_id) as { title: string }).title;
  const score = resolved.evidence.final_score ?? resolved.evidence.confidence;
  return {
    broken: false,
    markdown: `${wikiLink(transcriptPath(title, resolved.evidence.transcript_id), `${title}, ${resolved.evidence.span_id}`, resolved.evidence.span_id)}  \n${wikiLink(evidencePath(evidencePointerId), "Evidence note")}  \n\`${resolved.evidence.pointer_uri}\`  \n\`${resolved.evidence.source_pointer_uri}\`  \n**Role:** ${resolved.evidence.evidence_role} · **Strength:** ${resolved.evidence.evidence_strength} · **Score:** ${score.toFixed(3)}\n\n${quote(resolved.spanText, maxQuoteLength)}`,
  };
}
