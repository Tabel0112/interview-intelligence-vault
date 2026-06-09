# Interview Intelligence Vault

Local, privacy-aware storage and processing tools for user interview
transcripts.

## Raw Transcript Loader

Place raw Markdown transcripts directly inside:

```text
vault/01 Transcripts/Raw/
```

Run the manual loader check with:

```bash
node scripts/load-raw-transcripts.mjs
```

The loader reads only immediate, non-hidden `.md` files from the Raw folder. It
skips empty and unreadable files, does not scan subfolders, and never writes to
the Raw folder. The script prints transcript metadata but does not print raw
transcript text. Transcript IDs use the project-wide canonical `snake_case`
format. Notion-style trailing hashes are removed, and collisions receive a
stable short hash suffix.

## Metadata Parser

The deterministic metadata parser reads transcripts through the raw transcript
loader and extracts simple YAML frontmatter or property lines near the top of
each file. It normalizes transcript-level fields for filtering without parsing
or rewriting transcript dialogue.

Run the parser with:

```bash
node scripts/parse-metadata.mjs
```

Normalized metadata is written to:

```text
vault/02 Transcripts/Metadata/
```

Each transcript receives a `<transcript_id>.metadata.json` file, and all
metadata is included in the sorted `metadata_index.json`. The required
`transcript_id` is generated deterministically from the cleaned source
filename using the same shared utility as the raw loader, so raw transcript and
metadata IDs always match. Missing status, category, date, or participants use
stable defaults and produce warnings. Optional timestamps remain `null` when
absent.

The parser and CLI never modify files inside `vault/01 Transcripts/Raw/`.

Run the dependency-free fixture verification with:

```bash
node scripts/verify-metadata-parser.mjs
```

## Speaker Turn Parser

The strict speaker turn parser structures raw transcript wording into
source-traceable speaker turns. It recognizes bold Markdown speaker labels and
plain labels only for speakers already known from an earlier bold label or the
metadata participant list. It does not summarize, clean meaning, or create one
note per turn.

Run transcript processing with:

```bash
node scripts/process-transcripts.mjs
```

Unchanged transcripts are skipped when the source hash, schema version, and
analysis version match the existing processed JSON. Force a validated rewrite
with:

```bash
node scripts/process-transcripts.mjs --force
```

One JSON file per raw transcript is written to:

```text
vault/01 Transcripts/Processed/<transcript_id>.processed.json
```

Each generated file contains version markers, transcript metadata, source
identity, structured warnings, and deterministic turns with speaker IDs and
1-indexed source line numbers. Writes are validated and atomic. Processed JSON
is generated, should not be manually edited, and is committed to Git for now.
Old processed versions are overwritten rather than archived. Raw transcript
files are read-only to the pipeline and are never modified.

Run the dependency-free speaker parser verification with:

```bash
node scripts/verify-speaker-turn-parser.mjs
```

Run the processed writer verification with:

```bash
node scripts/verify-processed-transcript-writer.mjs
```
