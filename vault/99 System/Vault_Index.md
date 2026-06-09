# Vault Index

This index is the search map for Ask AI. Start here to locate the most useful
layer before opening raw transcripts. Keep entries concise, anonymized, and
linked by stable IDs so every analysis object can be traced to its source.

## Transcripts

| Transcript ID | Participant ID | Processed File | Status | Last Updated |
| --- | --- | --- | --- | --- |
| example_interview | P001 | `../01 Transcripts/Processed/example_interview.processed.json` | placeholder | YYYY-MM-DD |

## Participants

Use participant IDs only. Real identities belong exclusively in the private ID
map when one is created.

| Participant ID | Transcript IDs | Relevant Topics |
| --- | --- | --- |
| P001 | example_interview | placeholder-topic |

## Evidence Cards

Part 10 creates final evidence cards after Part 9 candidate scoring/filtering.
Generated cards are stored in `../03 Evidence Cards/` and remain unclassified
until Part 11 matches existing taxonomy or suggests candidates for review.

| Evidence Card ID | Transcript ID | Topic Tags | File |
| --- | --- | --- | --- |
| EC001 | example_interview | placeholder-topic | `../03 Evidence Cards/EC001.md` |

## Evidence Candidates

Part 8 creates these generated candidates. Part 9 scores and filters them;
they are not final evidence cards.

| Transcript ID | Candidate File | Review Status |
| --- | --- | --- |
| example_interview | `../03 Evidence/Candidates/example_interview.evidence_candidates.json` | placeholder |

## Scored Evidence Candidates

Part 9 preserves and scores every Part 8 candidate. Part 10 uses only candidates
with a final `create_evidence_card` decision.

| Transcript ID | Scored Evidence File | Selected Count |
| --- | --- | --- |
| example_interview | `../03 Analysis/Evidence_Candidates/example_interview.scored_evidence.json` | placeholder |

## Topic Segmentation

| Transcript ID | Topic File | Source Hash Status |
| --- | --- | --- |
| example_interview | `../02 Topic Analyses/example_interview.topics.json` | placeholder |

## Topic Analysis Notes

| Transcript ID | Topic ID | Analysis Note |
| --- | --- | --- |
| example_interview | topic_001 | `../02 Topic Analyses/example_interview__placeholder_topic.md` |

## Themes

Part 11 may match existing official taxonomy or suggest candidates. Part 12
connects matched decisions to approved official theme notes under
`../04 Themes/`. Neither part creates official taxonomy from candidate tags.
The approved canonical taxonomy is stored in
`Tag_Dictionary.json`, and the deterministic writer rules are documented in
`Agents/Theme_Note_Writer_Agent.md`.

| Theme ID | Title | Supporting Evidence | File |
| --- | --- | --- | --- |
| canonical-tag | Placeholder theme | EC001 | `../04 Themes/canonical-tag.theme.md` |

## Tag Decisions

Part 11 stores all tag decision statuses separately under the compatibility
path `../05 Candidate Tags/Decisions/`. This includes matched official tags,
candidate suggestions, and `needs_review`; the parent folder name does not mean
every decision is a candidate tag. Candidate tags and suggested theme
connections remain non-official until human approval.

| Evidence ID | Decision File | Status |
| --- | --- | --- |
| example_interview__topic_001__evidence_001 | `../05 Candidate Tags/Decisions/example_interview__topic_001__evidence_001.tag_decision.json` | placeholder |

## Findings

Part 13 writes cautious generated conclusions under `../06 Findings/` using
approved Evidence Cards and official Themes only. Active findings are available
to Ask AI. Stale findings retain history but are not current conclusions.
Manual notes without the generated marker remain protected. Generator rules are
documented in `Agents/Finding_Generator_Agent.md`.

| Finding ID | Title | Supported By | File |
| --- | --- | --- | --- |
| finding_placeholder | Placeholder finding | evidence_id | `../06 Findings/finding__placeholder.md` |

## Processing Status

| Transcript ID | Raw Stored | Processed | Topic Analysis | Evidence Reviewed |
| --- | --- | --- | --- | --- |
| example_interview | no | no | no | no |

## Search Guidance

1. Check active findings and themes for synthesized answers; ignore stale
   findings unless historical output is requested.
2. Check evidence cards for selected supporting quotes and source references.
3. Check tag decisions for existing-tag matches and candidate suggestions.
4. Check scored evidence candidates for Part 9 rankings and filter decisions.
5. Check Part 8 evidence candidates when reviewing all possible quotes.
6. Check topic analyses for concise transcript- or topic-level context.
7. Check processed transcripts when more context is required.
8. Open raw transcripts only to verify the source of truth.
