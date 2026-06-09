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

## Topic Segmentation Agent

The AI-assisted topic segmentation layer reads validated processed transcript
JSON, groups adjacent turns into broad topic ranges, and converts AI-provided
exact text anchors into source-traceable character offsets. Core segmentation
logic accepts an injectable AI client; the verification suite uses mock AI
only.

Run the real OpenAI adapter with:

```bash
OPENAI_API_KEY=... OPENAI_MODEL=... node scripts/segment-topics.mjs
```

`OPENAI_MODEL` is optional; the adapter has its own default. Force rewriting
unchanged topic files with:

```bash
OPENAI_API_KEY=... OPENAI_MODEL=... node scripts/segment-topics.mjs --force
```

Topic files are written atomically to:

```text
vault/02 Topic Analyses/<transcript_id>.topics.json
```

Structural problems fail only the affected transcript and do not write output.
Quality concerns produce valid topic files with structured warnings. Main
topic ranges always cover every turn exactly once; optional segments store
character offsets rather than anchor or quote text.

Run mock-only verification with:

```bash
node scripts/verify-topic-segmentation.mjs
```

## Topic Analysis Writer

The topic analysis writer reads processed transcript JSON and matching topic
segmentation JSON, sends only each topic's selected turns to the AI client, and
renders compact Markdown summaries deterministically. It creates one note per
transcript-topic, not global cross-interview themes.

Run the real OpenAI adapter with:

```bash
OPENAI_API_KEY=... OPENAI_MODEL=... node scripts/write-topic-analyses.mjs
```

Force rewriting unchanged generated notes with:

```bash
OPENAI_API_KEY=... OPENAI_MODEL=... node scripts/write-topic-analyses.mjs --force
```

Notes are written atomically to:

```text
vault/02 Topic Analyses/<transcript_id>__<topic_slug>.md
```

Unchanged generated notes are skipped. Notes without the
`<!-- generated: topic-analysis-writer -->` marker are treated as manual notes
and are never overwritten, including during forced runs. Topic analyses contain
compact synthesis without transcript quotes or pasted transcript sections.

Run mock-only verification with:

```bash
node scripts/verify-topic-analysis-writer.mjs
```

## Evidence Candidate Extractor

The evidence candidate extractor reads each processed transcript and its
matching topic segmentation file. It asks the AI for zero to five useful
candidate quotes per topic, then deterministic code verifies that every saved
quote exactly matches its turn-relative character pointer. Invalid candidates
are rejected with warnings.

Run the real OpenAI adapter for all available transcripts with:

```bash
OPENAI_API_KEY=... OPENAI_MODEL=... node scripts/extract-evidence-candidates.mjs
```

Use `--transcript <transcript_id>` to process one transcript or `--force` to
rewrite unchanged output. One validated JSON file per transcript is written
atomically to:

```text
vault/03 Evidence/Candidates/<transcript_id>.evidence_candidates.json
```

Candidate IDs are deterministic within each topic. Unchanged files are skipped,
missing inputs are reported clearly, and invalid AI JSON never replaces an
existing valid candidate file. Candidate files support later human review and
evidence-card creation; they are not reviewed evidence cards themselves.
Part 9 scores and filters these candidates, Part 10 creates final evidence
cards, and Part 11 decides official tags and themes. Part 8 `suggested_tags`
remain temporary suggestions only.

Run mock-only verification with:

```bash
node scripts/verify-evidence-candidate-extractor.mjs
```
