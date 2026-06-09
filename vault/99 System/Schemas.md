# Vault Schemas

Use stable IDs and ISO 8601 dates (`YYYY-MM-DD`). Paths should be relative to
the vault when practical. Optional values may be empty, but required
traceability fields must not be removed.

## Transcript Metadata

| Field | Description |
| --- | --- |
| `transcript_id` | Stable canonical snake_case transcript ID, such as `example_interview`. |
| `participant_id` | Anonymous participant ID, such as `P001`. |
| `source_file` | Path to the raw source-of-truth transcript. |
| `processed_file` | Path to the cleaned, machine-readable transcript. |
| `status` | Processing state, such as `raw`, `processed`, or `reviewed`. |
| `version` | Version of the processed transcript or schema. |
| `created_date` | Date the vault record was created. |
| `last_updated` | Date the vault record was last changed. |

## Quote / Evidence Metadata

| Field | Description |
| --- | --- |
| `quote_id` | Stable quote ID, such as `Q-example_interview-001`. |
| `transcript_id` | Source transcript ID. |
| `participant_id` | Anonymous source participant ID. |
| `timestamp` | Source timestamp or another precise source locator. |
| `source_file` | Path to the source transcript. |
| `evidence_type` | Kind of support, such as `perception`, `behavior`, or `fact`. |
| `participant_fit` | How well the participant fits the relevant research segment. |
| `confidence` | Confidence in interpretation, such as `low`, `medium`, or `high`. |

## Processed Speaker Turn Transcript

Processed transcripts are JSON files at
`01 Transcripts/Processed/<transcript_id>.processed.json`.

| Field | Description |
| --- | --- |
| `transcript_id` | Canonical snake_case ID shared with the raw loader and metadata. |
| `source_file` | Original raw transcript filename. |
| `source_hash` | SHA-256 hash of the raw source contents. |
| `parser_version` | Deterministic parser version, such as `speaker-turn-parser-v1`. |
| `preamble_text` | Source text before the first valid speaker label. |
| `speakers` | Unique cleaned display names found in non-empty turns. |
| `warnings` | Structured parser warning objects. |
| `turns` | Ordered speaker turn objects. |

Each turn contains `turn_id`, `speaker`, `speaker_id`, `text`, `position`,
`source_line_start`, and `source_line_end`. Turn IDs, positions, and source
line numbers are deterministic and 1-indexed.

## Evidence Card Metadata

| Field | Description |
| --- | --- |
| `evidence_card_id` | Stable evidence card ID, such as `EC001`. |
| `quote_id` | ID of the selected source quote. |
| `transcript_id` | Source transcript ID. |
| `participant_id` | Anonymous source participant ID. |
| `topic_tags` | Topics associated with the evidence. |
| `theme_links` | Related theme IDs. |
| `finding_links` | Related finding IDs. |
| `evidence_type` | Kind of support provided by the evidence. |
| `confidence` | Confidence in the evidence interpretation. |

## Theme Metadata

| Field | Description |
| --- | --- |
| `theme_id` | Stable theme ID, such as `THEME-001`. |
| `title` | Short, descriptive theme title. |
| `description` | Concise description of the repeated pattern. |
| `related_topics` | Topic tags associated with the theme. |
| `supporting_evidence_cards` | Evidence card IDs that support the theme. |
| `status` | Theme state, such as `candidate`, `validated`, or `retired`. |

## Finding Metadata

| Field | Description |
| --- | --- |
| `finding_id` | Stable finding ID, such as `FINDING-001`. |
| `title` | Short finding title. |
| `claim` | High-level conclusion supported by evidence. |
| `supported_by` | Evidence card IDs supporting the claim. |
| `confidence` | Confidence in the finding. |
| `notes` | Limitations, caveats, or review notes. |
