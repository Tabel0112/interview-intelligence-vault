# Transcript Memory Vault — Application Specification & Architecture Contract

> **Status of this document.** This is the contract Claude Code must follow when implementing future work on this project. It distinguishes three states for every capability:
>
> - **[CURRENT]** — what is actually implemented today (verified against the code at the time of writing).
> - **[MVP]** — the intended Minimum Viable Product, which is **not yet fully implemented**. The intended MVP includes **real external LLM integration** and **real semantic embedding-model vectors**. These do not exist yet.
> - **[FUTURE]** — explicitly out of MVP scope; post-MVP direction only.
>
> **Critical accuracy rule.** The current deterministic Ask AI and the `token-hash-v1` embedding vectors are **fallback / test / local-only modes**, not the complete intended MVP. Do **not** describe, document, or assume that external LLM or external embedding integration already exists. It is a seam waiting for an implementation.
>
> Companion documents: [`CLAUDE.md`](../CLAUDE.md) (non-negotiable rules) and [`docs/CLAUDE_ARCHITECTURE_REVIEW.md`](./CLAUDE_ARCHITECTURE_REVIEW.md) (first-time review, legacy/duplication findings). On any conflict, `CLAUDE.md` wins, then this spec, then the review.

---

## 1. Product goal

An Obsidian-style, evidence-grounded memory vault for transcripts (interviews, meetings, calls). The app ingests raw transcripts, splits them into immutable spans, extracts memory objects, scores evidence quality, detects contradictions, answers questions ("Ask AI") **only from cited transcript evidence**, and renders Obsidian Markdown/graph views.

The defining product promise is **trust**: every memory, answer, claim, citation, graph node, and edge must trace back to raw transcript spans through provenance pointers. SQLite is the authoritative source of truth; generated Markdown and AI answers are views, never truth.

---

## 2. User workflow

1. **Import** a transcript (file upload or pasted text).
2. The app **ingests** it: stores immutable raw text, segments into turns and spans, records content hashes.
3. The app **extracts** memory objects (decisions, questions, action items, objections, advice, topics, quotes) with evidence pointers back to spans.
4. The user **browses** the dashboard, transcript views, memory objects, and the graph.
5. The user **asks questions** ("Ask AI"). The system retrieves evidence, scores it, detects support/opposition/conflict, generates claims **only** from selected evidence, validates them, and renders an answer with citations and explicit warnings — or refuses when evidence is insufficient.
6. The user **reviews and corrects** (append-only): confirm/reject memory objects, resolve or keep conflicts, rename speakers.
7. Optionally, the app **generates Obsidian Markdown views** (notes + graph) as a one-way export.

**[MVP]** adds: a Settings flow to configure an external LLM/embedding provider and API key; Ask AI answers synthesized by a real LLM (then validated against evidence); real semantic embeddings powering retrieval. **[CURRENT]** the workflow runs end-to-end in deterministic local mode without any external service.

---

## 3. Transcript ingestion

**[CURRENT]** — Implemented and trustworthy.
- Entry point `src/ingest/importTranscript.ts`. Accepts imported files or pasted text; `detectTranscriptFormat.ts` whitelists by extension.
- Content-hash dedupe by `raw_sha256` of full raw text (filename-independent). Re-ingesting identical content is a no-op short-circuit before any write; the whole insert is one transaction.
- Segments into `transcript_turns` (speaker turns) and `transcript_spans` (≤1500-char spans), each with line/char offsets and `text_hash`/`span_text_sha256`.
- Span/turn text is re-verified against computed offsets before insert.

**[MVP]** — No change required to the ingestion *contract*. Ingested transcripts must remain immutable and provenance-anchored regardless of which extractor/embedding/LLM mode is active.

**[FUTURE]** — Incremental retrieval indexing *at ingest time* (today indexing is lazy; see §6/§19), additional input formats with content-aware (not extension-only) detection, streaming/large-file ingestion.

---

## 4. Immutable raw-source model

**[CURRENT]** — Enforced at the database layer (strongest guarantee).
- `transcript_sources` rows are immutable (`transcript_sources_immutable_update` trigger).
- Transcript identity/raw fields immutable (`transcripts_raw_fields_immutable`, `transcripts_ingestion_raw_immutable`).
- Turn and span source fields immutable (`transcript_turns_exact_source_immutable`, `transcript_spans_exact_source_immutable`).
- Raw text and span text are content-hashed; provenance resolution re-validates those hashes (see §5).

**Contract for all states.** Raw transcripts are immutable after ingestion. Generated text (memory objects, summaries, answers, Markdown) must **never** overwrite or masquerade as raw transcript text. This holds identically in CURRENT, MVP, and FUTURE. Introducing real LLM/embeddings must not touch the raw-source tables.

---

## 5. Evidence / provenance / citation model

**[CURRENT]** — Implemented and the backbone of the trust model.
- `source_pointers` (`mv://source/…`) bind a span to an exact raw-offset range; a DB trigger requires the span's `start_char/end_char` to match the pointer.
- `evidence_pointers` (`mv://evidence/…`) chain to a source pointer and attach to a target (memory object, claim, answer claim, graph node/edge, summary) with role and strength.
- `resolveSourcePointer` (`src/provenance/sourcePointers.ts`) validates a pointer by re-checking raw-text hash, span-text hash, and offset range. Any mismatch returns a typed reason (`hash_mismatch`, `invalid_offsets`, `raw_transcript_missing`, `not_found`).
- Broken/missing pointers surface as explicit `problems`/warnings via `provenanceValidator.ts`; they never silently pass.
- Citations (`citation_links`, built by `createCitationLinksForAnswer`) point to the evidence pointers actually used.

**Contract for all states.** Every generated object and every answer claim must trace to transcript spans via validated provenance pointers. A claim shown as "supported" must have backing support evidence. This is provider-agnostic: it applies whether claims come from the deterministic generator or a real LLM (see §9–§15).

**[FUTURE]** — Optional richer provenance (cross-transcript linking, pointer versioning). Must remain additive and hash-validated.

---

## 6. Retrieval — current token-hash fallback

**[CURRENT]** — This is a **fallback/test/local mode**, not the intended MVP retrieval quality.
- Hybrid retrieval = keyword (FTS5 with LIKE fallback) + vector + weighted ranking + recency. Code in `src/retrieval/`.
- The **only** embedding implementations are:
  - `DeterministicTestEmbeddingProvider` — `name="deterministic-test"`, `model="token-hash-v1"`, 32-dim vectors built by hashing tokens with SHA-256 (`src/retrieval/embeddingProvider.ts`). This is a deterministic stand-in, **not** a semantic embedding.
  - `NoopEmbeddingProvider` — disabled, 0-dim (vector search returns nothing).
- Indexing is **lazy**: `rebuildRetrievalIndex` runs at Ask-AI time (`src/ask-ai/dependencies.ts`), idempotent via content-hash skip, populating `retrieval_documents` / `search_embeddings`.
- The user-facing Search view currently bypasses this engine and does a direct `transcript_spans.text LIKE` scan (`src/frontend/sqliteApi.ts`) — a known divergence (see §19).

**Why it's labeled fallback.** `token-hash-v1` captures lexical token overlap, not meaning. It exists so the full pipeline is testable and runnable offline with deterministic results. It must remain available, but it is not the MVP retrieval experience.

---

## 7. Intended real embedding provider system

**[MVP]** — **Not yet implemented.** Implement concrete semantic embedding providers behind the existing `EmbeddingProvider` interface (`src/retrieval/embeddingProvider.ts`).
- A real provider implements `embedTexts(texts) → number[][]` calling an external embedding model (per the configured provider + API key, §12–§13).
- Real vectors have provider-specific dimensions (e.g. hundreds/thousands), unlike the 32-dim test vectors. The system already stores `embedding_provider`, `embedding_model`, and `embedding_dim` per row.
- Retrieval must select the active provider/model and embed the query with the **same** provider/model used to embed documents.
- Switching to/from a real provider requires (re)indexing into provider-specific embedding rows. The deterministic provider remains the explicit offline/test fallback.

**[CURRENT] enforcement to preserve.** `vectorSearch` filters `search_embeddings` by `embedding_provider AND embedding_model AND embedding_dim`, and `search_embeddings` is unique per `(target_type, target_id, provider, model)`. `cosineSimilarity`/`validateVector` throw on dimension mismatch. Real providers must keep these guarantees.

**[FUTURE]** — Approximate-nearest-neighbor index for scale, multiple simultaneously-indexed providers, provider auto-migration tooling.

---

## 8. No mixing vectors from different providers/models — hard rule

**This is a non-negotiable correctness rule in every state (CURRENT, MVP, FUTURE).**
- Cosine similarity may only be computed between vectors produced by the **same provider AND same model AND same dimension**. Comparing across providers/models/dimensions is meaningless and forbidden.
- Query embeddings must be generated by the same provider+model as the stored document embeddings they are compared against.
- A change of provider or model is a **new embedding space**: documents must be re-embedded into new rows keyed by the new `(provider, model)`; old vectors are never cosine-compared against new ones.
- Mixed-dimension comparison must continue to throw (`validateVector`, `cosineSimilarity`), never silently coerce or pad.

Any future retrieval change must preserve provider/model/dimension partitioning at both index and query time.

---

## 9. Ask AI — current deterministic fallback

**[CURRENT]** — Pipeline is fully implemented; claim *text generation* runs in deterministic fallback mode.
- Pipeline order (`src/ask-ai/pipeline.ts`) matches the required 9 steps: understand → retrieve → score evidence → select → detect conflicts → generate claims → validate (drop unsupported) → render with citations + warnings → persist.
- When no LLM is supplied (the live DB-backed dependencies supply none), `generateClaimsFromEvidence` produces **deterministic default claim text** derived from the top cited quote (`src/ask-ai/claimGeneration.ts`).
- This guarantees the pipeline, citations, conflict handling, refusal, and persistence all work offline and deterministically — but the prose is templated, not LLM-synthesized.

**Why it's labeled fallback.** Deterministic claim text proves the grounding machinery; it is not the intended natural-language answer quality. It must remain the offline/test default.

---

## 10. Intended external LLM grounded synthesis

**[MVP]** — **Not yet implemented.** Implement a concrete `AskAILanguageModel` (`src/ask-ai/types.ts`, the optional `llm?` dependency) that calls a real external LLM.
- The LLM receives the **query and the selected, scored evidence only** and returns proposed claims `{ kind, text, evidencePointerIds, explanation? }`.
- The LLM is **grounded**: it may only cite evidence pointers that were selected by retrieval/scoring. It must not answer from general model knowledge or introduce facts not present in the evidence.
- The LLM is wired through dependency injection (extend `createDatabaseAskAIDependencies` / `AskAIDependencies`), never hard-coded into the pipeline.
- LLM output is **untrusted** and passes through the existing post-generation validation gate (§15) before it can be shown or persisted.

**[CURRENT] guarantees the LLM path must inherit unchanged.** Claims are filtered to selected pointers; claims without a citation are dropped; `renderAnswer` throws if any rendered claim lacks a citation; `persistAskAIResponse` throws on broken/mismatched/unselected pointers. The 9-step order is fixed.

**[FUTURE]** — Streaming answers, multi-turn follow-ups, tool-use over the vault, answer caching.

---

## 11. Optional LLM-backed memory extraction

**[CURRENT]** — Deterministic extraction only.
- `DeterministicRuleExtractor` (`src/memory/extraction/extractor.ts`) uses regex rules to produce candidates (decision, action_item, question, objection, advice_idea, topic, quote).
- A seam exists: `PromptBasedMemoryExtractor` (`kind="llm"`) consumes a `MemoryExtractionClient.generateJson(prompt)` and validates the structured output shape. **No concrete client is implemented.**

**[MVP]** — Optional. Implement a concrete `MemoryExtractionClient` so extraction can use a real LLM. It must remain **optional**: deterministic extraction stays as the offline/test fallback, and the choice is configurable.

**Contract.** Whether extraction is deterministic or LLM-backed, candidates must still go through insert-then-promote: a memory object is inserted `needs_review`, evidence pointers are attached, and only then may it be promoted to `active` — the DB triggers forbid inserting `active` directly and require evidence to promote. LLM extraction does not relax this.

**[FUTURE]** — Cross-span/cross-transcript synthesis, entity resolution, summary objects.

---

## 12. API key / settings requirements

**[CURRENT]** — **None exist.** The Settings tab (`src/obsidian/SettingsTab.ts`) shows health/status only (plugin status, DB path, migration status, native binding). There is **no** API key field, no provider field, no model field, and no network code anywhere in the project.

**[MVP]** — **Not yet implemented.** Add settings for:
- Provider selection (which external LLM and embedding provider).
- Model selection per capability (synthesis model, embedding model, optional extraction model).
- API key entry, stored via Obsidian's plugin settings/secret storage. Keys must never be logged, never written into transcripts/memory/answers/Markdown, and never committed.
- A clear indicator of the active mode (real provider vs local/offline fallback).

**Contract.** When no provider/key is configured, the app must run fully in local/offline deterministic mode (§14) — it must never block core functionality on the absence of a key, and it must never silently send vault content to an external service without explicit configuration.

---

## 13. Model / provider selection

**[MVP]** — **Not yet implemented.** Selection is per-capability (retrieval embeddings, Ask AI synthesis, optional extraction) and resolves to concrete `EmbeddingProvider` / `AskAILanguageModel` / `MemoryExtractionClient` implementations via dependency injection.

**Contract.**
- Selecting a different embedding provider/model creates a new embedding space and requires reindexing (§8). The app must track the active `(provider, model)` and never compare across spaces.
- Provider/model identifiers must be recorded with every generated artifact (already supported by `model_name`/`embedding_model`/`prompt_version`/run tables) so provenance and reproducibility are preserved.
- Provider/model choice affects answer prose and retrieval recall **only**. It must not change evidence scores, truth status, conflict status, provenance, citations, or warnings.

---

## 14. Local / offline / test mode

**[CURRENT]** — This is the only mode that exists today and must always remain available.
- Embeddings: `DeterministicTestEmbeddingProvider` (token-hash-v1) or `NoopEmbeddingProvider`.
- Ask AI: deterministic templated claim text (no LLM).
- Extraction: `DeterministicRuleExtractor`.
- Fully deterministic, no network, runnable in CI and offline.

**Contract (binding on MVP and FUTURE).**
- Local/offline mode is the default when no external provider/key is configured.
- **Tests must always run in deterministic local mode.** No test may depend on an external LLM/embedding service or any network call. Real providers must be injected and mockable; never required by the pipeline or by tests.
- Determinism rules from `CLAUDE.md` continue to apply: no unmocked `Date.now()`/`new Date()`/`Math.random()` in ranking, scoring, migration, or pipeline logic; injected clocks where tests assert ordering.
- Real-provider integrations must be behind injection seams so that swapping in a mock yields the current deterministic behavior.

---

## 15. Claim validation after LLM generation

**[CURRENT]** — The validation gate exists and is provider-agnostic; it already runs for deterministic claims.

**[MVP]** — The **same** gate must wrap real-LLM output with no weakening. After any claim generation (deterministic or LLM):
1. Drop any claim whose evidence pointers are not in the selected-evidence set.
2. Drop any claim with empty text or with no resolvable citation.
3. Downgrade support status when evidence is insufficient (e.g. a "pattern" claim from a single span becomes `weakly_supported`).
4. `renderAnswer` throws if any surviving claim lacks a citation.
5. `persistAskAIResponse` throws on broken, mismatched, or unselected evidence pointers, and on supported claims lacking support evidence.
6. Answer claims are inserted `unsupported` and only **promoted** via UPDATE once real evidence pointers are linked (the `BEFORE UPDATE` support-requires-evidence trigger guards promotion). **Never insert a claim as `supported` directly.**

**Contract.** LLM output is never trusted as-is. Unsupported LLM claims must be discarded or explicitly marked unsupported. General-knowledge claims with no vault evidence are not allowed.

---

## 16. Refusal / warning behavior for weak / missing / conflicting evidence

**[CURRENT]** — Implemented; must be preserved in all states.
- No evidence → the answer **refuses** (`answer_status = refused_no_evidence`, `evidenceConfidence = no_evidence`, no claims).
- Weak evidence → answer is produced but flagged weak; strength caps keep weak evidence weak (`evidence/rules.ts`) and cannot be promoted.
- Conflicting evidence → both sides are preserved and cited; confidence is downgraded and conflict context is appended.
- Warnings are rendered into the answer Markdown and must not be removed unless the underlying evidence issue is actually fixed.

**Contract.** Weak, mixed, conflicting, missing, or broken evidence must always produce explicit warnings or refusal. Adding a real LLM must not let "confident-sounding" prose replace a required warning or refusal. The decision to warn/refuse is driven by evidence scoring, not by the LLM.

---

## 17. Hermes personalization boundaries

**[CURRENT]** — Implemented with runtime guardrails.
- Hermes (`src/hermes/`) may affect **presentation, ranking order, default filters, answer style, and suggested follow-ups only**.
- Guardrails (`src/hermes/guardrails.ts`) assert that personalization did **not** change evidence scores, create evidence pointers, alter selected-evidence sets, change `evidenceConfidence` or claims, suppress conflicts/opposing evidence, or remove required warnings.

**Contract (all states).**
- Hermes must never change evidence scores, truth status, conflict status, provenance, citations, or warnings.
- A real LLM used for synthesis is **not** a license to bypass Hermes boundaries: personalization still only restyles/reorders; it never re-decides truth.
- When hardening is done later (review §7), warning-preservation should become structural rather than substring-based — but until then the existing guardrail must remain in force and be invoked on every personalized answer path.

---

## 18. Obsidian generated Markdown rules

**[CURRENT]** — Implemented safely.
- Generated Markdown + graph are a **one-way export** (`src/obsidian/generateVault.ts`, `vaultWriter.ts`). SQLite remains authoritative.
- Cleanup deletes **only** paths recorded in the plugin's own prior manifest (`obsidian_generated_files`); user-created files are preserved (proven by tests). If the manifest is missing/unparseable, nothing is deleted.
- Generated Markdown is **never read back as source truth** anywhere.
- Plugin UI is CSS-scoped under a root class so themes cannot break layout.

**Contract (all states).**
- Generated Markdown/summaries/graph/answers must never be treated as source truth.
- Regenerating views must never delete user files; cleanup stays manifest-scoped.
- Plugin startup must remain safe even if SQLite/native bindings fail — views show readable health/error states, never blank.

---

## 19. Known legacy / duplicated systems (from the architecture review)

These exist today and must be understood before touching related code. See [`docs/CLAUDE_ARCHITECTURE_REVIEW.md`](./CLAUDE_ARCHITECTURE_REVIEW.md) §6 for detail. **Do not "wire back up" orphaned systems; do not split a co-written pair.**

- **Three search paths:** the user Search view uses `transcript_spans LIKE`; Ask AI uses the hybrid `retrieval_documents`/`search_embeddings` engine (migration 007); the migration-001 `search_documents`(+FTS) path via `searchRepo` is **orphaned** (no live indexer/query caller).
- **`ai_answer_citations` (001) is dead** — `createAnswerCitation` has no callers; the live citation system is `citation_links` (004).
- **Two answer tables co-written:** `ai_answers` (001) and `ask_ai_runs` (009) are written together in one transaction but read by different layers. If you write one, write both.
- **`embedding_records` (001)** is superseded by `search_embeddings` (007).
- **Two live memory-evidence systems:** `memory_object_evidence` (001) and `evidence_pointers` (004); promotion/cleanup triggers check both.
- **Six run-tracking tables:** `processing_runs`, `extraction_runs`, `evidence_score_runs`, `ask_ai_runs`, `pipeline_runs`/`agent_runs`, `obsidian_view_runs`.
- **Lazy indexing:** retrieval index is rebuilt at Ask-AI time, not at ingest.
- **Bundle-path footgun:** `defaultMigrationDirectory()` resolves through an esbuild-rewritten `import.meta.url`; it only works because `Plugin.ts` always passes an explicit `migrationDirectory`. Do not add arg-less `openDatabase`/`runMigrations` callers.
- **Single native target:** only `darwin-arm64-abi140` is packaged; no ABI/arch fallback.

When adding real LLM/embedding integration, prefer the **live** systems (`evidence_pointers`/`citation_links`/`retrieval_documents`/`search_embeddings`/`ask_ai_runs`) and do not revive the legacy 001 tables.

---

## 20. Non-negotiable trust rules

Reproduced from `CLAUDE.md` (authoritative there). These bind every state, including after real LLM/embedding integration:

1. Raw transcripts are immutable after ingestion.
2. Generated text must never overwrite or masquerade as raw transcript text.
3. Every memory object, summary, graph node/edge, answer claim, and citation must trace back to transcript spans via provenance/evidence pointers.
4. Ask AI must retrieve and score evidence before answering.
5. Unsupported LLM-generated claims must be discarded or explicitly marked unsupported.
6. Weak, mixed, conflicting, missing, or broken evidence must produce explicit warnings.
7. Generated Obsidian Markdown must never be read back as truth.
8. User corrections are append-only and must not silently rewrite raw data.
9. Conflict detection must preserve both sides with citations.
10. Hermes/personalization may affect presentation, ranking, defaults, style, and follow-ups only.
11. Hermes/personalization must not change evidence scores, truth status, conflict status, provenance, or warnings.
12. Do not remove warnings unless the underlying evidence/provenance issue is actually fixed.
13. Do not weaken tests to make changes pass.

Plus, specific to this spec:

14. Never mix vectors across providers/models/dimensions (§8).
15. Never require an external LLM/embedding service to run core functionality or tests; deterministic local mode is always available (§14).
16. Never send vault content to an external service without explicit user configuration; never log or persist API keys (§12).

---

## 21. What must not be changed without explicit user approval

Block and ask before changing any of the following (consistent with `CLAUDE.md`'s "When Requirements Are Ambiguous"):

- **Raw transcript immutability** or the immutability triggers.
- **Evidence scoring** weights, caps, or the rule that weak/unvalidated evidence stays weak.
- **Provenance validation** (hash checks) or the rule that broken/missing pointers warn.
- **Citation correctness** — the guarantee that every shown/persisted claim cites the evidence actually used, and the insert-then-promote claim model.
- **Conflict preservation** — keeping both sides with citations; append-only corrections.
- **Ask AI refusal/warning behavior** for weak/missing/conflicting evidence, and the fixed 9-step order.
- **Hermes boundaries** (presentation/ranking only).
- **Obsidian generated-view boundaries** — output-only Markdown, manifest-scoped cleanup, user-file preservation, safe startup.
- **Database migrations** — additive only; do not edit applied migrations; new behavior needs new migrations and migration tests.
- **The no-mixing-vectors rule** (§8) and the deterministic-local-mode guarantee (§14).
- Any **destructive / reset / delete** control (never add unless explicitly requested).
- Adding **network calls, external providers, or API-key handling** — these are intended MVP work but must be introduced behind injection seams, with settings, with offline fallback intact, and with the user's explicit go-ahead on scope.

Anything that affects data loss, raw immutability, evidence scoring, provenance, citation correctness, conflict preservation, migrations, public user behavior, or destructive actions requires explicit approval. Naming/formatting/folder choices do not — make a reasonable default and continue.

---

## 22. Implementation seams (where MVP work plugs in)

For the next implementer, the existing injection points for the **not-yet-built** MVP integrations are:

| Capability | Interface (exists) | Concrete today | MVP to add |
|---|---|---|---|
| Embeddings | `EmbeddingProvider` (`src/retrieval/embeddingProvider.ts`) | `DeterministicTestEmbeddingProvider` (token-hash-v1), `NoopEmbeddingProvider` | A real semantic embedding provider |
| Ask AI synthesis | `AskAILanguageModel` (`src/ask-ai/types.ts`, optional `llm?`) | none (deterministic templated text) | A real grounded LLM client |
| Memory extraction | `MemoryExtractionClient` / `PromptBasedMemoryExtractor` (`src/memory/extraction/extractor.ts`) | `DeterministicRuleExtractor` | A real LLM extraction client (optional) |
| Provider/model/key config | — | health-only Settings tab | Settings UI + secret storage + mode indicator |

All four must be injected, optional, and fall back to deterministic local mode when unconfigured. None of them may alter scores, truth status, provenance, citations, conflicts, or warnings.

---

*This spec is the architecture contract for future implementation. It documents current behavior truthfully, marks the intended MVP (real external LLM + real semantic embeddings) as not-yet-implemented, and fixes the trust boundaries that any implementation must respect. It introduces no code changes.*
