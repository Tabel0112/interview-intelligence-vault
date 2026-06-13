Read CLAUDE.md and docs/CLAUDE_ARCHITECTURE_REVIEW.md.

Do not modify production code.

Create docs/APP_SPEC.md.

Important correction: the intended MVP was supposed to include real external LLM integration and real semantic embedding-model vectors. The current deterministic Ask AI and token-hash-v1 vectors are fallback/test/local modes, not the complete intended MVP.

The spec must clearly distinguish:
1. current implemented behavior,
2. intended MVP behavior,
3. future post-MVP behavior.

Include:
- product goal
- user workflow
- transcript ingestion
- immutable raw-source model
- evidence/provenance/citation model
- current token-hash retrieval fallback
- intended real embedding provider system
- no mixing vectors from different providers/models
- current deterministic Ask AI fallback
- intended external LLM grounded synthesis
- API key/settings requirements
- model/provider selection
- local/offline/test mode
- claim validation after LLM generation
- refusal/warning behavior for weak/missing/conflicting evidence
- Hermes personalization boundaries
- Obsidian generated Markdown rules
- known legacy/duplicated systems
- non-negotiable trust rules

Do not invent that external LLM/embedding integration already exists.
Write this as the architecture contract Claude Code should follow for future implementation.
