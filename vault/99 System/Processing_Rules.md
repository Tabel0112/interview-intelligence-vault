# Processing Rules

## Layer Responsibilities

- Raw transcripts keep the full original transcript, remain the source of
  truth, and are read-only to the pipeline.
- Processed transcripts are generated JSON and never replace the raw transcript.
- Processed JSON should not be manually edited and should be committed to Git
  for now.
- Old processed JSON versions are overwritten rather than archived.
- Topic analyses are short summaries of what one transcript or one topic says.
- Part 8 creates evidence candidates only.
- Part 9 scores and filters evidence candidates.
- Part 10 creates final evidence cards containing selected important quotes.
- Part 11 decides official tags and themes across transcripts.
- Candidate tags are temporary suggestions and are never official tags.
- Findings are high-level conclusions and must link back to evidence cards.

## Traceability

- Every analysis object must be traceable using one or more of:
  `transcript_id`, `participant_id`, `quote_id`, `timestamp`, or `source_file`.
- Findings must link to evidence cards, and evidence cards must link to their
  selected quote and source transcript.
- Raw transcripts are used to verify quotations and source context.
- Findings must not rely on unsupported opinions.
- A quote can support a participant's perception even when it does not prove an
  objective fact. Label the evidence type accordingly.

## Privacy

- Normal analysis files use participant IDs such as `P001`, never real names.
- Original names and details are allowed in Raw and Processed for internal use.
- Future analysis layers should use participant IDs instead of real names.
- The private ID map is restricted and must not be committed to version control.
- `ID_Map_Private.example.json` is a schema example only and must contain no
  real participant data.

## Duplication

- Avoid duplicating full text across layers.
- Keep the full original only in Raw. Processed stores structured speaker turns.
- Store selected quotes in evidence cards and concise summaries elsewhere.
- Future direct quote references use exact `type`, `transcript_id`, `turn_id`,
  `char_start`, `char_end`, and `source_hash` pointers.
- Future evidence, topic, theme, and finding objects should not duplicate source
  text unnecessarily.

## Topic Segmentation

- Main topic ranges are strict: continuous, non-overlapping, gap-free, and
  cover every processed turn exactly once.
- Optional segments identify important or multi-topic passages within turns.
- The AI supplies exact text anchors; deterministic code converts them to
  inclusive `start_char` and exclusive `end_char` offsets.
- Saved topic files keep offsets and summaries, not anchor text or full quotes.
- Segments within one turn must not overlap.
- Multiple topics may reference one bridge segment through `key_spans`.
- Structural failures prevent writing the affected topic file.
- Quality concerns save valid output with structured warnings.

## Topic Analysis Notes

- Create one compact Markdown note per transcript-topic.
- Topic analysis notes summarize only the processed turns inside their topic
  range.
- Do not paste transcript sections or include evidence quotes.
- Key points synthesize related ideas rather than listing disconnected
  fragments.
- Include design implications only when directly supported by the selected
  turns.
- Do not use outside knowledge or invent unsupported claims.
- Generated notes include `<!-- generated: topic-analysis-writer -->`.
- Never overwrite a topic note that does not contain the generated marker.
- Global cross-interview themes are not topic analysis notes.

## Evidence Candidates

- Extract zero to five candidates per topic, usually zero to three.
- Send only the selected topic turns to the AI.
- Save only exact quotes that deterministic code verifies against one
  turn-relative character pointer.
- Reject candidates with invalid pointers, unsupported categories or strength,
  empty required text, or duplicate quotes within the same topic.
- Candidate IDs are deterministic and assigned only after validation.
- Candidate tags are temporary and do not establish project-wide taxonomy.
- Candidate output is generated JSON, not a reviewed evidence card.
- Part 9 scores and filters candidates before Part 10 creates final evidence
  cards.
- Part 11, not Part 8, decides official tags and themes.
- Skip unchanged valid output unless forced.
- Write candidate files atomically. Invalid AI JSON must never replace an
  existing valid file.
- Never write to or modify the Raw transcript folder.
