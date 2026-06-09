# Evidence Candidate Extractor Agent

## Purpose

Identify useful evidence candidates within one supplied transcript topic.
Candidates support later review; they are not final evidence cards.

## Rules

- Use only the supplied topic turns.
- Return zero to five candidates, usually zero to three.
- Every quote must be exact and must match its turn-relative character pointer.
- Do not paraphrase, normalize, combine turns, hallucinate, or use outside
  knowledge.
- Prefer meaningful, self-contained quotes over generic statements.
- `suggested_tags` are temporary suggestions only. They are not official tags.
- Part 9 scores and filters candidates.
- Part 10 creates final evidence cards from reviewed candidates.
- Part 11 matches existing taxonomy or suggests candidates for human approval.
