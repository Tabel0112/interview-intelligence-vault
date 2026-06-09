# Processing Rules

## Layer Responsibilities

- Raw transcripts keep the full original transcript and remain the source of truth.
- Processed transcripts are cleaned and machine-readable, but never replace the raw transcript.
- Topic analyses are short summaries of what one transcript or one topic says.
- Evidence cards store only selected important quotes, not every quote.
- Themes group repeated patterns across transcripts.
- Candidate tags are temporary and may later become stable tags.
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
- Real names must not appear outside raw transcripts or the private ID map.
- The private ID map is restricted and must not be committed to version control.
- `ID_Map_Private.example.json` is a schema example only and must contain no
  real participant data.

## Duplication

- Avoid duplicating full text across layers.
- Keep the full original only in Raw and cleaned full text only in Processed.
- Store selected quotes in evidence cards and concise summaries elsewhere.

