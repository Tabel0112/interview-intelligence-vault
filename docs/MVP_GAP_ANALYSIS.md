# Transcript Memory Vault — MVP Gap Analysis

> Compares the current implementation against the intended MVP in [`docs/APP_SPEC.md`](./APP_SPEC.md), under the rules in [`CLAUDE.md`](../CLAUDE.md). **No code is changed by this document.**
>
> Intended MVP = real external LLM grounded synthesis and AI memory extraction (the live app is **LLM-required**), evidence-first retrieval, plus real semantic embedding vectors, configurable via settings. Deterministic/local providers are dev/test seams only — never a live product mode or fallback.
>
> **State:** the live app is **LLM-required** — Ask AI and AI memory extraction run only through a configured external LLM (`createSqliteFrontendApi`/`Plugin` wired with `llmRequired: true`); when none is configured the UI shows setup-required, and when the LLM fails it shows a generic failure (no deterministic output). Verified by `tests/mvpSmoke.test.ts` (mock external LLM) and `tests/llmRequired.test.ts`. Every "implemented" claim below is code-backed.

---

## 1. Implemented (verified)

**Core trust spine (unchanged, still enforced)**
- Transcript ingestion + **raw immutability** via DB triggers (`importTranscript`), wired live.
- Provenance/citation machinery: hash-validated `source_pointers`/`evidence_pointers`, `citation_links`, insert-then-promote claims; `resolveSourcePointer`/`resolveEvidencePointer` re-check raw/span/offset hashes.
- Evidence scoring + strength caps (deterministic; weak-stays-weak).
- Ask AI 9-step pipeline (understand → retrieve → score → select → conflicts → claims → validate → render → persist), refusal/weak/conflict warnings, atomic persistence.
- Append-only user corrections; both-sides conflict preservation.
- Obsidian generated-view safety (manifest-scoped cleanup, user files preserved, output-only); safe startup/health.
- No-mixing-vectors enforcement (query filter by provider+model+dim; `search_embeddings` unique per provider+model; `validateVector`/`cosineSimilarity` throw; `embeddingSpace` helpers).
- **LLM-required live app**: no deterministic generation fallback; deterministic/local providers remain only as explicitly-injected dev/test seams. **Tests are offline-only** (mock external LLM transports or injected deterministic providers).

**Embedding stack**
- Embedding provider abstraction: `EmbeddingProvider`, `EmbeddingSpace`, `resolveEmbeddingProvider`, `detectReindexNeeded` (`src/retrieval/embeddingSpace.ts`, `reindexStatus.ts`).
- **External embedding provider** (`src/retrieval/externalEmbeddingProvider.ts`): OpenAI-compatible, **injectable transport**, API key in true `#private` field, redaction, configured-only.
- **Embedding settings/config adapter** (`src/obsidian/embeddingSettings.ts`) + Obsidian `requestUrl` transport (`embeddingTransport.ts`).
- **Manual embedding reindex command** (`runEmbeddingReindex` → Plugin "Rebuild Embedding Index").

**LLM stack**
- **LLM provider abstraction** (`src/llm/`): `LlmProvider`, local-deterministic + mock providers, error hierarchy, timeout/cancellation, redaction; secret-bearing fields are true `#private`.
- **External LLM provider** (`src/llm/externalLlmProvider.ts`): OpenAI-compatible chat/completions, injectable transport, status→error mapping, redaction.
- **Settings → LLM resolution** (`src/obsidian/llmSettings.ts`): `resolveLlmProviderFromSettings`, `askAiSynthesisFromSettings`, `memoryExtractorFromSettings`; Obsidian `requestUrl` transport (`llmTransport.ts`).

**Ask AI grounded LLM synthesis**
- **Grounded validation layer** (`src/ask-ai/llmSynthesis.ts`): structured-output parse + shape-check + **quote-anchoring grounding** (each claim must carry a `supportingQuote` that substring-matches a *selected* evidence snippet) + discard-ungrounded.
- **Live wiring (LLM-required)**: `getSynthesis` threaded `Plugin → ObsidianAppApi → createSqliteFrontendApi → askAI` with `llmRequired: true`. No LLM configured → `SynthesisSetupRequiredError` (setup-required UI); LLM failure/empty after evidence → `SynthesisFailedError` (generic failure). Neither persists an answer; no deterministic claims in the live path.
- **Runtime-accurate synthesis metadata** persisted (non-secret `{mode, provider, model, usedFallback}` via the `onSynthesis` hook) — reflects the *actual* path (llm vs deterministic), not just the configured intent.

**Memory extraction**
- **Grounded LLM extraction** (`src/memory/extraction/llmExtractor.ts`): quote-anchored, span-membership-checked; in the live app a failure throws a key-free `MemoryExtractionError` (the per-window deterministic `fallback` is optional, injected only by dev/test seams).
- **Automatic LLM extraction after import** (`uploadTranscript`), **only when an LLM is configured** (`memoryExtractorFromSettings` returns `undefined` otherwise → import succeeds, raw kept, no memory + a setup-required warning). The **"Run AI extraction"** command (`api.runExtraction`) processes transcripts imported before LLM setup. Idempotent.
- **LLM-extracted memory is capped to `needs_review`** (never auto-`active`).
- **Prompt-version metadata** recorded per extractor on the run + objects.

**Post-import discovery + review**
- **Provenance bridge** (`src/retrieval/transcriptIndex.ts`): after import/extraction, **usable/active** memory (`isUsableAsEvidence`, Policy A) is bridged to hash-validated `evidence_pointers`; `needs_review` is **not** bridged.
- **Local keyword indexing runs automatically** after import/extraction (`rebuildRetrievalIndex` with no provider — offline, idempotent).
- **Review approve/reject actions** (`reviewMemoryObject` + UI Approve/Reject buttons): approve promotes through the **append-only correction/trust gate** (`user_corrected=1`, evidence-required) then bridges + indexes → memory becomes Ask-AI-visible; reject marks rejected, deletes its `evidence_pointers`, and removes its `memory_object` retrieval doc/index rows → removed from Ask AI evidence **and** normal memory search, while keeping `memory_object_evidence`/`source_pointers` for audit. (The UI Approve/Reject buttons render only on `needs_review` items — see Partially implemented.)
- **End-to-end MVP smoke test** (`tests/mvpSmoke.test.ts`): upload → auto-extract → needs_review → approve → grounded **LLM** Ask AI with validated citation → reject → cleanup, with a whole-table secret sweep and a `renderRoute` UI check.

## 2. Partially implemented
- **Semantic embeddings in retrieval.** The external embedding provider, settings adapter, and manual reindex command exist — but **post-import indexing is keyword-only** (no embedding provider passed), so real semantic vectors populate **only** via the manual "Rebuild Embedding Index" command. Automatic semantic retrieval is opt-in/manual, not on by default.
- **Grounding ≠ entailment.** Both Ask AI synthesis and extraction enforce **quote-anchoring** (a verbatim quote from a cited span). This is a real guard, but **not** full semantic entailment/NLI — a claim could wrap a real quote in a misleading paraphrase.
- **Reindex-needed status freshness.** `detectReindexNeeded` + a status surface exist; the Plugin refreshes it on DB-ready and `saveSettings`, but **not after upload/approval**, so it can read stale after new content lands.
- **LLM failure semantics.** Timeout/malformed/error/empty → typed setup-required / generic-failure in the live app (Ask AI + extraction), with no deterministic fallback and no fake output persisted. Not handled: **evidence token-budget/truncation** when selected evidence exceeds the model's context window.
- **Search surfaces are not unified.** Ask AI and memory discovery use the retrieval engine (`retrieval_documents`/`evidence_pointers`); the user-facing **Search view still uses a separate `transcript_spans LIKE` / `ask_ai_runs LIKE` scan** (`sqliteApi.searchVault`).
- **Review reject UI scope.** `reviewMemoryObject(id, "reject")` works for any memory at the API level, but the Review UI renders the Reject button **only for `memory_needs_review` items** (`render.ts` `reviewActions`). There is **no UI path today to reject an already-approved/active memory**. The approve → ask → reject lifecycle is covered at the API/smoke-test level (`tests/reviewApproval.test.ts`, `tests/mvpSmoke.test.ts`); until an active-memory reject UI is added, the manual packaged checklist rejects a *separate* `needs_review` item. *(Verified.)*

## 3. Still missing
- **Full entailment/NLI verification** of LLM claims/memories (beyond quote-anchoring) — the deeper grounding guarantee.
- **Automatic semantic embedding** after import/approval, plus **auto-refresh of reindex-needed status** after upload/approval.
- **Hermes in the live path.** Hermes + its guardrail exist and are tested but are **not invoked by the live frontend Ask AI** (only the unwired orchestration `answerSynthesisAgent`). Personalization is inert in the live app. *(Verified: no Hermes reference in `src/frontend` or `ask-ai/pipeline.ts`.)*
- **Conflict detection on new memory.** The conflicts subsystem exists, but no live path **runs detection** on newly extracted/approved memory; the live code only *lists* existing conflicts (`listConflictsForTarget`). *(Verified.)*
- **Generated Obsidian views not wired to a live action.** The Markdown/vault view generator exists (`src/obsidian/generateVault.ts`, with manifest-scoped cleanup that preserves user files) and is tested, but **no live user command, ribbon, or frontend action invokes it** (verified: not referenced in `Plugin.ts` or the frontend). Packaged smoke testing should verify source-of-truth immutability and the rendered plugin views, not assume a user-triggered generated-vault command until one is added.
- **Unified Search** routed through the retrieval engine.
- **Retrieval-degradation warning surface** (a provider/model-mismatch vector query silently yields no matches; no user-facing warning).
- **Incremental indexing.** `rebuildRetrievalIndex` re-scans the whole corpus per import/approval (idempotent, content-hash-skipped, but O(corpus)); vector search is full-scan JS cosine — see Deferred for ANN.
- **Real packaged Obsidian smoke test.** A manual checklist and install/verify scripts now exist (`docs/SMOKE_TEST.md`, `scripts/install-to-vault.mjs`, `scripts/verify-dist.mjs`), but the run itself is still manual: the automated smoke test is in-memory through `createSqliteFrontendApi`; there is **no run of the bundled plugin in real Obsidian against a real key**, and **no DOM click-dispatch test** (the test infra has no jsdom; the smoke covers `renderRoute` HTML only, with the `app.ts` dispatch verified by inspection).

## 4. Deferred / non-MVP
- **API keys are plaintext in `data.json`** (Obsidian has no secret store; may sync). Documented, warned, redacted everywhere else — but OS-keychain/outside-vault storage is a deliberate future decision.
- **Native packaging / ABI portability.** Only `native/darwin-arm64-abi140` is packaged; no ABI/arch fallback. Distribution beyond Apple Silicon needs added targets + verification.
- **Legacy/duplicated systems** (don't revive; clean opportunistically): orphaned `search_documents`(+FTS) path, dead `ai_answer_citations`, `embedding_records` superseded by `search_embeddings`, dual answer tables (`ai_answers` + `ask_ai_runs`, co-written).
- **Vector scaling**: ANN index / packed vector storage / multi-provider simultaneous indexing / provider-migration tooling.
- **Ask AI depth**: streaming, multi-turn, tool-use, answer caching.
- **Extraction depth**: cross-span synthesis, entity resolution, summary objects.

---

## 5. Recommended next steps (planning)
Each is its own focused branch (`inspect → plan → approve → implement → test`); approval required before anything touching network/providers/keys or a trust boundary. Tests stay offline.

1. **Make semantic retrieval real-by-default** — pass the configured embedding provider into post-import indexing *or* auto-flag reindex-needed after upload/approval (low risk, biggest MVP-completeness win). Keep external embedding opt-in; never auto-call external APIs without configuration.
2. **Decide Hermes** — wire it into the live Ask AI path with the (hardened, structural) warning guardrail, or formally mark it out-of-MVP.
3. **Evidence token-budget/truncation** for the external LLM (real correctness risk once large transcripts hit the context window).
4. **Unify the Search view** onto the retrieval engine + **incremental per-target indexing** (consistency + scaling).
5. **Conflict detection on new/approved memory** (run detection, preserve both sides, append-only).
6. **Entailment verifier pass** (deeper grounding beyond quote-anchoring).
7. **Shipping**: native-target fallback, key-storage decision, and a real end-to-end run of the packaged plugin against a real key.

**Cross-cutting invariants (must hold for every step):** raw transcripts immutable; generated objects separate from raw text; every memory/answer traceable to transcript spans; **evidence-first Ask AI** (never answer from the LLM alone); append-only corrections; **rejected/unapproved memory cannot be Ask-AI evidence**; no mixing vector spaces; LLM-required live generation (deterministic only as an injected dev/test seam); tests offline with mock/injected providers; never a network call inside a SQLite transaction; API keys never logged/persisted into vault data or surfaced in errors/health/Markdown; migrations additive with tests.

---

*Analysis only — no implementation performed. The MVP backbone is wired end-to-end; the remaining work is automatic semantic embeddings, deeper grounding, live Hermes/conflict decisions, search unification, scaling, and packaging.*
