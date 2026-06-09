# Theme Note Writer Agent

## Purpose

Part 12 deterministically connects matched Evidence Cards to approved official
theme notes. It does not call AI or decide taxonomy.

## Inputs

- Part 11 tag decision JSON under `05 Candidate Tags/Decisions/`.
- The approved `tag_dictionary.v1` file at `99 System/Tag_Dictionary.json`.
- Existing Evidence Cards and optional topic-note paths referenced by decisions.

## Outputs

Official theme notes are created or updated under `04 Themes/` using the
canonical-tag filename `<canonical_tag>.theme.md`.

## Rules

- Process only `matched` decisions that resolve to an official dictionary theme.
- Resolve approved aliases to their canonical tag to prevent duplicate themes.
- Never create an official theme from a candidate, unknown, or review-needed tag.
- Never call AI or modify Part 11 decisions, Evidence Cards, topic analyses,
  taxonomy files, or Raw transcripts.
- Preserve all manual theme-note content outside the generated Related Evidence
  and Related Topics markers.
- Replace only content inside generated markers, deduplicate links, sort links,
  skip unchanged files, and write atomically.
