# Evidence Card Writer

Part 10 is deterministic and does not call an AI agent.

It writes compact Obsidian Markdown evidence cards only for Part 9 candidates
with `filter_decision: create_evidence_card`. It validates exact quotes,
speakers, source pointers, required context, meaning, confidence, score reason,
transcript metadata, and topic metadata. It never decides evidence value from
scratch, rewrites quotes, modifies Raw transcripts, or creates official tags or
themes.
