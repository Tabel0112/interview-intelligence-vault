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

| Evidence Card ID | Transcript ID | Topic Tags | File |
| --- | --- | --- | --- |
| EC001 | example_interview | placeholder-topic | `../03 Evidence Cards/EC001.md` |

## Evidence Candidates

Part 8 creates these generated candidates. Part 9 scores and filters them;
they are not final evidence cards.

| Transcript ID | Candidate File | Review Status |
| --- | --- | --- |
| example_interview | `../03 Evidence/Candidates/example_interview.evidence_candidates.json` | placeholder |

## Topic Segmentation

| Transcript ID | Topic File | Source Hash Status |
| --- | --- | --- |
| example_interview | `../02 Topic Analyses/example_interview.topics.json` | placeholder |

## Topic Analysis Notes

| Transcript ID | Topic ID | Analysis Note |
| --- | --- | --- |
| example_interview | topic_001 | `../02 Topic Analyses/example_interview__placeholder_topic.md` |

## Themes

Part 11 decides official tags and themes. Part 8 suggested tags are not
official.

| Theme ID | Title | Supporting Evidence | File |
| --- | --- | --- | --- |
| THEME-001 | Placeholder theme | EC001 | `../04 Themes/THEME-001.md` |

## Findings

| Finding ID | Title | Supported By | File |
| --- | --- | --- | --- |
| FINDING-001 | Placeholder finding | EC001 | `../06 Findings/FINDING-001.md` |

## Processing Status

| Transcript ID | Raw Stored | Processed | Topic Analysis | Evidence Reviewed |
| --- | --- | --- | --- | --- |
| example_interview | no | no | no | no |

## Search Guidance

1. Check findings and themes for synthesized answers.
2. Check evidence cards for selected supporting quotes and source references.
3. Check evidence candidates when reviewing possible supporting quotes.
4. Check topic analyses for concise transcript- or topic-level context.
5. Check processed transcripts when more context is required.
6. Open raw transcripts only to verify the source of truth.
