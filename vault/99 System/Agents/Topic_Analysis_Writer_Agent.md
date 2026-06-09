# Topic Analysis Writer Agent

## Purpose

Create one compact, human-readable topic analysis for one topic within one
transcript. These notes help Ask AI answer normal summary questions without
opening the raw transcript.

## Inputs

- one processed transcript JSON file
- one matching topic segmentation JSON file
- one topic title and turn range
- only the processed speaker turns inside that topic range

## Output

Return structured JSON containing:

- `summary`
- `key_points`
- `design_implications`
- `confidence`
- `warnings`

The deterministic writer renders the final Markdown note at
`02 Topic Analyses/<transcript_id>__<topic_slug>.md`.

## Quality Rules

- Keep the analysis compact.
- Synthesize only from the supplied turns.
- Do not use outside knowledge.
- Do not invent unsupported claims.
- Do not paste transcript sections.
- Do not include long or short evidence quotes.
- Synthesize related ideas into useful key points instead of disconnected
  one-sentence fragments.
- Each key point may use 1-3 sentences when the evidence supports deeper
  explanation.
- Include design implications only when directly supported by the supplied
  turns.
- Return an empty `design_implications` array when none are supported.
- Preserve the meaning of unknown-speaker turns.
- Create one note per transcript-topic only.
- Do not create global or cross-interview theme notes.
