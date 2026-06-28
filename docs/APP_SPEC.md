# Transcript Memory Vault — Application Specification & Architecture Contract

> **Status of this document.** This is the contract Claude Code must follow when implementing work. Every capability is marked with one of three states:
>
> - **[CURRENT]** — implemented today (verified against the committed code).
> - **[MVP]** — intended Minimum Viable Product, **not yet complete**. The remaining MVP gaps are mainly: real semantic embeddings **on by default** (the external provider exists but post-import indexing is keyword-only), deeper grounding (entailment vs. today's quote-anchoring), and live Hermes/conflict decisions.
> - **[FUTURE]** — out of MVP scope; post-MVP direction only.
>
> **Critical accuracy rule.** The live Obsidian app is **LLM-required**: Ask AI synthesis and AI memory extraction must use a configured external LLM. Deterministic Ask AI claim text and the `DeterministicRuleExtractor` are **dev-only / test-only seams** (explicit injection), never a live product mode and never a live fallback — when no LLM is configured the app shows setup-required, and when the LLM fails it shows a generic failure (no deterministic output). External embeddings remain optional (`token-hash-v1` local keyword retrieval can still run; never describe token-hash vectors as semantic).
>
> Companions: [`CLAUDE.md`](../CLAUDE.md) (non-negotiable rules + Current MVP Gap Rules) and [`docs/MVP_GAP_ANALYSIS.md`](./MVP_GAP_ANALYSIS.md) (implemented / partial / missing / deferred status). On conflict, `CLAUDE.md` wins, then this spec, then the gap analysis.

---

## 1. Product goal
An Obsidian-style, evidence-grounded memory vault for transcripts. It ingests raw transcripts, splits them into immutable spans, extracts memory objects, scores evidence, detects contradictions, answers questions ("Ask AI") **only from cited transcript evidence**, and renders Obsidian Markdown/graph views. The defining promise is **trust**: every memory, answer, claim, citation, and graph node/edge traces back to raw transcript spans via provenance pointers. SQLite is authoritative; generated Markdown and AI answers are views, never truth.

## 2. User workflow
1. **Import** a transcript (file or pasted text).
2. **Ingest** → immutable raw text, turns, spans, content hashes.
3. **Extract** memory objects automatically after import (decisions, questions, action items, objections, advice, topics, quotes) with evidence pointers; LLM-extracted memory lands in `needs_review`.
4. **Browse** dashboard, transcripts, memory, graph.
5. **Review** the queue → **approve** (promote through the append-only correction gate; becomes Ask-AI-visible) or **reject** (removed from evidence + search, audit rows kept).
6. **Ask AI** → retrieve → score → detect support/opposition/conflict → generate claims only from selected evidence → validate (grounding) → render with citations + warnings, or refuse.
7. **Generate Obsidian views** (one-way export).

**[CURRENT]** the workflow runs offline in deterministic local mode by default; when an external LLM/embedding provider + key is configured in settings, LLM-synthesized answers and LLM extraction are used (validated/grounded against evidence), and a real embedding space can be built via the manual reindex command. **[MVP]** remaining: automatic semantic embedding (not manual), deeper grounding.

## 3. Transcript ingestion
**[CURRENT]** `src/ingest/importTranscript.ts`: dedupe by `raw_sha256`; immutable turns/spans with offsets and hashes; text re-verified against offsets before insert. The contract is unchanged across provider modes — ingested transcripts stay immutable and provenance-anchored. **[FUTURE]** incremental indexing at ingest, content-aware format detection, streaming.

## 4. Immutable raw-source model
**[CURRENT]** Enforced by DB triggers (immutable sources, transcript identity, turn/span source fields); `tests/mvpSmoke.test.ts` asserts raw `UPDATE`s throw. **Contract (all states):** raw transcripts are immutable after ingestion; generated text never overwrites or masquerades as raw text; providers must not touch the raw-source tables.

## 5. Evidence / provenance / citation model
**[CURRENT]** `source_pointers` (`mv://source/…`) bind spans to exact raw offsets; `evidence_pointers` (`mv://evidence/…`) chain to source and attach to targets; `resolveSourcePointer`/`resolveEvidencePointer` validate by re-checking raw/span/offset hashes; broken/missing pointers surface as explicit problems; `citation_links` point to the evidence actually used. **Contract (all states):** every generated object and answer claim must trace to spans via validated provenance pointers, regardless of provider. **[FUTURE]** richer provenance (cross-transcript linking, pointer versioning), additive and hash-validated.

## 6. Retrieval and the post-import indexing pipeline
**[CURRENT]** Hybrid keyword (FTS5/LIKE) + vector + ranking + recency (`src/retrieval/`). **Indexing is now wired live:** after every import/extraction, `src/retrieval/transcriptIndex.ts` bridges usable memory to `evidence_pointers` and calls `rebuildRetrievalIndex(db)` **with no embedding provider — keyword-only, offline, idempotent**. The deterministic test provider (`token-hash-v1`, 32-dim SHA-256 token hashing — **not semantic**) and `NoopEmbeddingProvider` still exist; a real external embedding space is built only via the manual reindex command (§7). The user-facing **Search view still does a direct `transcript_spans`/`ask_ai_runs LIKE` scan** (`sqliteApi.searchVault`), separate from the retrieval engine that powers Ask AI and memory discovery (see §19). **[MVP]** pass the configured embedding provider into post-import indexing so semantic vectors populate automatically; unify the Search view.

## 7. Embedding provider abstraction and the real external provider
**[CURRENT]**
- `EmbeddingProvider` interface (`{ name, model, dimensions, embedTexts }`).
- **`EmbeddingSpace`** descriptor `{ provider, model, dimensions }` + helpers `embeddingSpaceOf`, `sameEmbeddingSpace`, `assertCompatibleEmbeddingSpace`, `describeEmbeddingSpace`, `isVectorCapable` (`src/retrieval/embeddingSpace.ts`).
- **Registry / default resolver** `resolveEmbeddingProvider`/`createEmbeddingProvider`: token-hash-v1 is the default; `"noop"` disables; an unavailable id falls back to token-hash with `usedFallback: true`.
- **Real external embedding provider** `src/retrieval/externalEmbeddingProvider.ts`: OpenAI-compatible, **injectable transport** (Obsidian `requestUrl` in prod via `embeddingTransport.ts`), API key held in a true ECMAScript `#private` field, redaction in errors. Used **only when configured with a valid key**.
- **Settings → embedding config adapter** `src/obsidian/embeddingSettings.ts` (`externalEmbeddingConfigFromSettings`, `resolveEmbeddingProviderFromSettings`).
- **Manual reindex command** (`runEmbeddingReindex` → Plugin "Rebuild Embedding Index"), with **reindex detection** `detectReindexNeeded(db, active)` (read-only: provider/model change ⇒ `needsReindex`).
- Storage records `embedding_provider`, `embedding_model`, `embedding_dim`, and `content_hash` (input hash) per vector.

**[MVP] — not yet automatic.** Wire the configured embedding provider into the post-import indexing path (today it is keyword-only) and refresh reindex-needed status after upload/approval. **[FUTURE]** ANN index for scale, multiple simultaneously-indexed providers, packed vector storage, provider migration tooling.

## 8. No mixing vectors across providers/models — hard rule (all states)
Cosine similarity may only compare vectors from the **same provider AND model AND dimension**. Query embeddings must use the same provider/model as the stored documents. A provider/model change is a **new embedding space**: re-embed into new rows; never compare across spaces; dimension mismatch must throw. Enforced today at query (`vectorSearch` filters by provider+model+dim), store (`search_embeddings` unique per provider+model; `validateVector` throws), and via the `embeddingSpace` helpers.

## 9. Ask AI — LLM-required synthesis
**[CURRENT]** The 9-step pipeline (`src/ask-ai/pipeline.ts`) is wired live (`Plugin → ObsidianAppApi → createSqliteFrontendApi → askAI`, via the per-ask `getSynthesis` getter) with `llmRequired: true`. Retrieval → scoring → selection always run first. When evidence is selected but **no LLM is configured**, the live path throws `SynthesisSetupRequiredError` (setup-required UI; no answer persisted). When an LLM is configured but **fails/empty**, it throws `SynthesisFailedError` (generic failure; no answer persisted). It **never produces deterministic claims in the live app**. Empty evidence → the normal refusal (`notEnoughEvidence`), no LLM needed. The deterministic claim path remains only for dev/test seams (`requireLlm` unset). Conflict claims stay deterministic — they only format already-cited opposing evidence, not fabricated prose. **[FUTURE]** streaming, multi-turn, tool-use, caching.

## 10. External LLM grounded synthesis
**[CURRENT]** A concrete `AskAILanguageModel` (`src/ask-ai/llmSynthesis.ts`, `createLlmAskAILanguageModel`) backed by the LLM provider abstraction (§22): receives the **query + selected evidence only**, returns structured claims citing only selected pointers, wired via DI, output treated as untrusted and passed through the validation gate (§15). The LLM provider stack lives in `src/llm/` (`LlmProvider`, local-deterministic + mock providers, `ExternalLlmProvider` OpenAI-compatible chat/completions with injectable transport, error hierarchy, timeout/cancellation, redaction, `#private` key fields). Settings→LLM resolution is `src/obsidian/llmSettings.ts` (`resolveLlmProviderFromSettings`, `askAiSynthesisFromSettings`). **Inherited guarantees:** claims filtered to selected pointers; uncited claims dropped; `renderAnswer` throws on a claim without a citation; `persistAskAIResponse` throws on broken/mismatched/unselected pointers; the 9-step order is fixed. In the live (`requireLlm`) path, an LLM failure/malformed/timeout/all-discarded result throws a typed error — **no deterministic fallback**. Settings→LLM resolution is `src/obsidian/llmSettings.ts` (`askAiSynthesisFromSettings`, returns `undefined` when not configured). **[MVP]** evidence token-budget/truncation for large contexts; deeper grounding (§15).

## 11. LLM-required memory extraction
**[CURRENT]** Live extraction requires a configured LLM. `src/memory/extraction/llmExtractor.ts` (`createLlmMemoryExtractor`) is grounded (quote-anchored, span-membership-checked) and, in the live app, has **no deterministic fallback** — a transport/parse failure throws a key-free `MemoryExtractionError` and the run is recorded failed (no fabricated memory). **Extraction runs automatically after import only when an LLM is configured** (`uploadTranscript` uses `memoryExtractorFromSettings`, which returns `undefined` otherwise). A transcript imported with no LLM keeps its raw text but gets no memory until the **"Run AI extraction"** command (`api.runExtraction`) is run after configuring. `DeterministicRuleExtractor` (regex) is a dev/test seam, injected explicitly (and only it accepts a per-window `fallback`). **LLM-extracted memory is capped to `needs_review`** (never auto-`active`); insert-then-promote and evidence-required promotion are preserved; prompt-version metadata is recorded. **[FUTURE]** cross-span synthesis, entity resolution, summary objects.

## 12. API key / settings requirements
**[CURRENT]** Settings expose the external LLM provider/model + key (no user-facing local/deterministic mode); keys resolve to concrete providers via DI; **LLM unset ⇒ setup-required** (generation disabled), never deterministic output. The dashboard/settings show an LLM-required readiness state (`llmReady`). **Contract:** **Obsidian has no secret store** — plugin `data.json` is plaintext and may sync — so key storage is a deliberate decision; keys are held in `#private` fields, never logged, persisted into vault data/SQLite, or surfaced in errors/health/Markdown (asserted by the smoke-test whole-table secret sweep); vault content is never sent externally without explicit configuration; no key ⇒ setup-required (no generation). **[FUTURE]** OS-keychain / outside-vault key storage.

## 13. Model / provider selection
**[CURRENT]** per-capability (embeddings, synthesis, extraction), resolved to concrete implementations via DI from settings. Changing the embedding provider/model creates a new space and requires reindexing (§8). Provider/model identifiers are recorded with generated artifacts. **Contract (all states):** provider choice affects prose/recall only — never scores, truth, conflict status, provenance, citations, or warnings.

## 14. Offline / test mode (NOT a product mode)
**[CURRENT]** Deterministic generation (token-hash/noop embeddings, deterministic claim text, rule extractor) is a **dev/test seam only**, reachable solely through explicit injection (e.g. `createSqliteFrontendApi` without `llmRequired`, or passing a deterministic extractor/fallback). It is **not** a runtime product mode and never a live fallback. **Contract (binding):** **tests always run offline** (no external service, no network — external providers are exercised only via injected mock transports); the live app is LLM-required; CLAUDE.md determinism rules apply (no unmocked `Date.now`/`Math.random` in ranking/scoring/migration/pipeline); never a network call inside a SQLite transaction. External **embeddings remain optional** — local keyword retrieval is allowed in the live app.

## 15. Claim validation / grounding after generation
**[CURRENT]** the gate runs for both deterministic and LLM output. It enforces **citation provenance** (pointers in the selected set; citation required; insufficient evidence downgrades support; `renderAnswer`/`persistAskAIResponse` throw on uncited/broken/unselected; claims inserted `unsupported` then promoted) **plus quote-anchoring grounding** for LLM output (each claim/memory must carry a `supportingQuote` that substring-matches a selected/cited span; ungrounded items are discarded). LLM output is never trusted as-is; no general-knowledge claims. **[MVP]** a claim↔evidence **entailment / NLI** check — quote-anchoring proves a real quote was cited, not that the surrounding claim text is *entailed* by it. **Entailment is still missing; do not describe quote-anchoring as entailment.**

## 16. Refusal / warning behavior (all states)
No evidence → refuse (`refused_no_evidence` / `notEnoughEvidence`). Weak → produced but flagged; strength caps hold. Conflicting → both sides preserved and cited, confidence downgraded, conflict context appended. Warnings stay unless the underlying evidence issue is fixed. A real LLM must not let confident prose replace a required warning/refusal — the decision is scoring-driven, not LLM-driven.

## 17. Hermes personalization boundaries
**[CURRENT]** Hermes affects presentation, ranking, defaults, style, follow-ups only; runtime guardrails assert it changes no scores/pointers/confidence/claims/warnings/conflicts. **It is NOT live:** the guardrail runs only in the orchestration `answerSynthesisAgent`, which is **not invoked by the live frontend Ask AI path** (verified: no Hermes reference in `src/frontend` or `src/ask-ai/pipeline.ts`). Hermes is currently inert in the live app. **Contract (all states):** Hermes never changes scores, truth, conflict status, provenance, citations, or warnings; a real LLM is no license to bypass this; harden warning-preservation to be structural before enabling LLM prose in the live path.

## 18. Obsidian generated Markdown rules
**[CURRENT]** one-way export; cleanup deletes only paths in the plugin's own manifest (user files preserved); generated Markdown never read back as truth; UI CSS-scoped. **Contract (all states):** generated artifacts are never source truth; regeneration never deletes user files; startup stays safe on SQLite/native failure (readable health, never blank).

## 19. Known legacy / duplicated systems
Understand before touching related code. **Do not revive orphans; do not split co-written pairs.**
- **Three search paths:** the Search view uses `transcript_spans`/`ask_ai_runs LIKE`; Ask AI + memory discovery use the live retrieval engine (`retrieval_documents`/`search_embeddings`, migration 007); the migration-001 `search_documents`(+FTS) path is **orphaned**.
- **`ai_answer_citations` (001) is dead**; live citations use `citation_links` (004).
- **Two answer tables co-written:** `ai_answers` (001) + `ask_ai_runs` (009) — write both or neither.
- **`embedding_records` (001)** superseded by `search_embeddings` (007).
- **Two live memory-evidence systems:** `memory_object_evidence` (001) + `evidence_pointers` (004).
- **Live wiring is now done:** the upload path runs `importTranscript` → auto-extraction → usable-memory bridge to `evidence_pointers` → `rebuildRetrievalIndex` (keyword-only); review approve re-bridges/indexes; reject cleans up. (The earlier "extraction/indexing not invoked live; `rebuildRetrievalIndex` test-only" gap is resolved.)
- Prefer the live systems (`evidence_pointers`/`citation_links`/`retrieval_documents`/`search_embeddings`/`ask_ai_runs`) for new work.

## 20. Non-negotiable trust rules
Authoritative in `CLAUDE.md` (Non-Negotiable Trust Rules + Current MVP Gap Rules). They bind every state, including with real LLM/embedding integration: raw immutability; no generated-as-raw; full provenance tracing; retrieve+score before answering; discard/mark unsupported LLM claims; warn on weak/missing/conflicting/broken evidence; generated Markdown never read as truth; append-only corrections; conflicts preserve both sides; **rejected/unapproved memory cannot be Ask-AI evidence**; Hermes presentation-only; no mixing vector spaces; no network required for core/tests; no network in a SQLite transaction; keys never logged/persisted into vault data.

## 21. What must not change without explicit user approval
Raw immutability + triggers; evidence scoring weights/caps; provenance hash validation; citation correctness + insert-then-promote; conflict preservation + append-only corrections; the rejected/unapproved-memory-not-evidence rule; Ask AI refusal/warning behavior + the 9-step order; Hermes boundaries; Obsidian generated-view boundaries; database migrations (additive only); the no-mixing-vectors rule; the deterministic-local-mode default; any destructive/reset control; and the network/provider/key seams (keep offline fallback; configured-only external calls).

## 22. Implementation seams
| Capability | Interface | Concrete today | MVP remaining |
|---|---|---|---|
| Embeddings | `EmbeddingProvider` + `resolveEmbeddingProvider` (`src/retrieval/`) | token-hash-v1, noop, **`ExternalEmbeddingProvider`** (configured-only) | wire external provider into **automatic** post-import indexing; reindex-status refresh |
| Ask AI synthesis | `AskAILanguageModel` (optional `llm?`) | deterministic templated text, **`createLlmAskAILanguageModel`** (live when configured) | entailment check; evidence token-budget |
| Memory extraction | `MemoryExtractor` | `DeterministicRuleExtractor`, **`createLlmMemoryExtractor`** (auto after import, `needs_review` cap) | cross-span synthesis (future) |
| Provider/model/key config | `*FromSettings` resolvers (`src/obsidian/`) | settings UI + key handling + DI resolution | OS-keychain storage (future) |

All external providers are injected, optional, and fall back to deterministic local mode when unconfigured; none may alter scores, truth, provenance, citations, conflicts, or warnings.

## 23. Claude Desktop + MCP bridge
**[CURRENT — Phase 1]** A standalone stdio **MCP server** (`src/mcp/`, build `npm run mcp:build` → `dist/mcp/server.cjs`) bridges Claude Desktop to this backend. It opens the SQLite DB at `TMV_DB_PATH`, reuses the existing `createSqliteFrontendApi` + Ask AI pipeline (with `llmRequired: true` and an env-built LLM config; default Node fetch transport), and exposes read tools + **`ask_vault`**. `ask_vault` calls the existing pipeline and returns a validated **AnswerBundle** — Claude never synthesizes from raw chunks; chat history is never evidence. Setup-required/LLM-failure persist no answer; not-enough-evidence is the existing persisted refusal. To make the service headless, `sqliteApi.ts` imports `buildObsidianGraph` directly from `graphBuilder.js` (not the Obsidian barrel), so the backend loads with no `obsidian` runtime package. **Product role:** Claude Desktop is the main chat UI; Obsidian becomes the evidence/answer/transcript/graph **viewer** (its `mv://…` routes are returned as links). See [`docs/MCP.md`](./MCP.md). **[FUTURE]** ask threads, write tools beyond answer persistence, `obsidian://` deep links, official MCP SDK, chat/business-intent work.

---

*This spec documents current behavior truthfully: real external LLM synthesis, external embeddings, settings, live wiring, grounded extraction, and review are implemented; the remaining MVP work is automatic semantic embedding, entailment-level grounding, and live Hermes/conflict decisions. It fixes the trust boundaries any implementation must respect.*
