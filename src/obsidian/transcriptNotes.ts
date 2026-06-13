import type { SqliteDatabase } from "../db/connection.js";
import { makeSourcePointerUri, resolveSourcePointer } from "../provenance/index.js";
import { frontmatter, generatedWarning, makeGeneratedFile, quote } from "./markdown.js";
import { transcriptPath } from "./paths.js";
import type { GeneratedFile } from "./types.js";

const time = (ms: number | null) => ms == null ? "Unknown" : `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
export function generateTranscriptNotes(db: SqliteDatabase, maxQuoteLength = 10000): GeneratedFile[] {
  const transcripts = db.prepare("SELECT * FROM transcripts ORDER BY id").all() as Array<Record<string, unknown>>;
  return transcripts.map((item) => {
    const spans = db.prepare("SELECT * FROM transcript_spans WHERE transcript_id=? ORDER BY ordinal,id").all(item.id) as Array<Record<string, unknown>>;
    const sections = spans.map((span) => {
      const sourceUri = makeSourcePointerUri({ transcriptId: String(item.id), spanId: String(span.id) });
      const source = resolveSourcePointer(db, sourceUri);
      return `### Span ${span.id}

<span id="${span.id}"></span>

**Speaker:** ${span.speaker_label ?? "Unknown"}  
**Time:** ${time(span.start_time_ms as number | null)}-${time(span.end_time_ms as number | null)}  
**Source URI:** ${source.ok ? `\`${sourceUri}\`` : "_No validated source pointer for this span._"}

> [!quote] Immutable raw source text
${quote(String(span.text ?? span.text_preview), maxQuoteLength)}
`;
    }).join("\n");
    const content = `${frontmatter({ mv_entity_type: "transcript", mv_entity_id: String(item.id), mv_generated: true, mv_source_of_truth: "sqlite", mv_raw_hash: String(item.raw_sha256 ?? item.content_hash) })}
# ${item.title}

${generatedWarning}

> [!important] Immutable source
> Transcript text and spans are rendered from immutable SQLite source records.

**Transcript ID:** \`${item.id}\`  
**Source ID:** \`${item.source_id}\`  
**Raw hash:** \`${item.raw_sha256 ?? item.content_hash}\`  
**Imported:** ${item.imported_at}

## Transcript Spans

${sections || "_No spans found._"}`;
    return makeGeneratedFile("transcript_note", transcriptPath(String(item.title), String(item.id)), content, "transcript", String(item.id));
  });
}
