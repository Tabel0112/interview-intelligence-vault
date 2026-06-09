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

## Processed Transcript JSON

Processed transcripts are JSON files at
`01 Transcripts/Processed/<transcript_id>.processed.json`.

| Field | Description |
| --- | --- |
| `schema_version` | Processed schema version, currently `processed_transcript.v1`. |
| `analysis_version` | Analysis contract version, currently `v1`. |
| `generated` | Always `true` for pipeline-generated files. |
| `generator` | Generator identifier, currently `transcript_pipeline`. |
| `transcript_id` | Canonical snake_case ID shared with the raw loader and metadata. |
| `metadata` | Simple title, source filename, participants, language, and interview date. |
| `turns` | Ordered speaker turn objects. |
| `summaries` | Reserved array for future summaries; currently empty. |
| `topics` | Reserved array for future topics; currently empty. |
| `evidence_candidates` | Reserved array; Part 8 candidate output is stored separately. |
| `source` | Raw path, filename, SHA-256 source hash, and modified timestamp. |
| `processed_at` | ISO timestamp updated only when the file is written. |
| `warnings` | Structured processing warning objects. |

Each turn contains `turn_id`, `speaker`, `speaker_id`, `text`, `position`,
`source_line_start`, and `source_line_end`. Turn IDs, positions, and source
line numbers are deterministic and 1-indexed.

Future direct quote references should use exact pointers containing `type`,
`transcript_id`, `turn_id`, `char_start`, `char_end`, and `source_hash`.

Processed warning objects contain `code`, `stage`, `line`, and `message`.

## Topic Segmentation JSON

Topic segmentation files are generated at
`02 Topic Analyses/<transcript_id>.topics.json`.

| Field | Description |
| --- | --- |
| `schema` | Topic schema version, currently `topic_segmentation.v1`. |
| `transcript_id` | Canonical transcript ID. |
| `source_processed_file` | Vault-relative processed transcript JSON path. |
| `source_sha256` | SHA-256 hash of the processed transcript file. |
| `generated_at` | ISO timestamp for the topic segmentation run. |
| `agent_prompt` | Vault-relative topic agent prompt path. |
| `model` | AI model identifier returned by the AI client. |
| `segments` | Optional precise passages using turn-relative character offsets. |
| `topics` | Continuous, ordered topic ranges covering every turn exactly once. |
| `warnings` | Structured quality warnings. |

Segments contain `segment_id`, `turn_id`, inclusive `start_char`, exclusive
`end_char`, and a brief `summary`. Saved topic files never contain anchor text
or full quote previews. Topics contain `topic_id`, `title`, `start_turn`,
`end_turn`, `summary`, and `key_spans`. Multiple topics may reference the same
segment through `key_spans`.

## Topic Analysis Markdown

Generated topic analysis notes are stored at
`02 Topic Analyses/<transcript_id>__<topic_slug>.md`.

YAML frontmatter contains:

| Field | Description |
| --- | --- |
| `type` | Always `topic_analysis`. |
| `schema_version` | Currently `topic_analysis.v1`. |
| `transcript_id` | Canonical source transcript ID. |
| `topic_id` | Source segmentation topic ID, such as `topic_001`. |
| `topic_slug` | Stable title-derived slug used in the filename. |
| `topic_title` | Human-readable topic title. |
| `source_transcript` | Human-readable source transcript name. |
| `input_sha256` | Hash used to skip unchanged generated notes. |
| `turn_ranges` | Source processed-turn range. |
| `generated_from` | Currently `topic_segmentation.v1`. |

Generated notes contain Summary, synthesized Key Points, optional supported
Design Implications, Source, and Turn Range sections. They contain no evidence
quotes or pasted transcript sections.

## Evidence Candidate JSON

Evidence candidate files are generated at
`03 Evidence/Candidates/<transcript_id>.evidence_candidates.json`.
They are Part 8 generated candidates, not final evidence cards.

| Field | Description |
| --- | --- |
| `schema_version` | Currently `evidence_candidates.v1`. |
| `transcript_id` | Canonical source transcript ID. |
| `source_hash` | SHA-256 hash of the processed and topic input files. |
| `generated_at` | ISO timestamp updated only when output is written. |
| `evidence_candidates` | Validated candidate quotes grouped from all transcript topics. |
| `warnings` | Structured validation and quality warnings. |

Each candidate contains deterministic `candidate_id`, `topic_id`, exact
`quote`, source `speaker`, `source_refs`, brief `context`, `meaning`,
controlled `evidence_category`, temporary `suggested_tags`, `strength`, and
`status: candidate`. Candidate IDs use
`<transcript_id>_<topic_id>_ev_<sequence>`.

Each source reference contains `turn_id`, inclusive `start_char`, and exclusive
`end_char`. The saved quote must exactly equal the referenced processed-turn
text slice. Evidence categories are:
`user_need`, `pain_point`, `behavior_or_workflow`, `barrier_or_concern`,
`decision_factor`, `motivation`, `emotion_or_attitude`, `workaround`,
`product_expectation`, `design_opportunity`, `business_or_market_insight`,
`contradiction_or_tension`, `background_context`, or `other`. Strength is
`strong`, `medium`, or `weak`.

Part 9 scores and filters candidates. Part 10 creates final evidence cards from
reviewed candidates. Part 11 decides official tags and themes;
`suggested_tags` from Part 8 never establish official taxonomy.

## Scored Evidence Candidate JSON

Part 9 scored files are generated at
`03 Analysis/Evidence_Candidates/<transcript_id>.scored_evidence.json`.

| Field | Description |
| --- | --- |
| `schema_version` | Currently `scored_evidence_candidates.v1`. |
| `transcript_id` | Canonical source transcript ID. |
| `source_candidate_file` | Vault-relative Part 8 candidate JSON path. |
| `source_hash` | SHA-256 hash of the complete Part 8 source candidate file. |
| `generated_at` | ISO timestamp updated only when output is written. |
| `selection_limits` | Deterministic per-topic, target, and hard transcript limits. |
| `scored_evidence_candidates` | Every Part 8 candidate with scoring and filtering fields. |
| `summary` | Counts for candidates, decisions, and duplicates. |
| `warnings` | Structured scoring/filtering warnings. |

Each scored candidate preserves all Part 8 fields and adds `source_turn_ids`,
the five boolean `score_reasons`, computed integer `score`,
`score_rationale`, `dedupe_status`, `dedupe_of`, deterministic `rank`, and
`filter_decision`.

Valid filter decisions are `create_evidence_card`,
`keep_in_topic_analysis`, and `raw_only`. Score 4-5 is only eligible for
selection. Deterministic code limits selections to 3 per topic and 20 per
transcript. Duplicate and capped-out eligible candidates stay in topic
analysis. All Part 8 candidates remain in this output.

## Evidence Card Metadata

Final evidence cards are created in Part 10 after candidate scoring/filtering.
Official tag and theme decisions are handled in Part 11.

Generated evidence cards are Markdown files in `03 Evidence Cards/`. YAML
frontmatter contains `type`, stable `evidence_id`, `source_candidate_id`,
source transcript ID/title, speaker, topic ID/title, confidence, score,
`status: unclassified`, `created_by: evidence-card-writer.v1`, and
`input_sha256`. The exact quote is stored only in the Markdown Quote section.

Part 10 consumes current Part 9 `filter_decision: create_evidence_card`.
`score_rationale` becomes the displayed score reason. Existing Part 8
`strength` is the confidence source and maps from `strong`, `medium`, `weak`
to `high`, `medium`, `low`.

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
