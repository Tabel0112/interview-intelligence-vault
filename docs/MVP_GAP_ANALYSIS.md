# Transcript Memory Vault — MVP Gap Analysis

> **Purpose.** Compare the current implementation against the intended MVP defined in [`docs/APP_SPEC.md`](./APP_SPEC.md), under the trust rules in [`CLAUDE.md`](../CLAUDE.md) and the findings in [`docs/CLAUDE_ARCHITECTURE_REVIEW.md`](./CLAUDE_ARCHITECTURE_REVIEW.md). **No code is changed by this document.**
>
> Intended MVP (per APP_SPEC) = the full deterministic pipeline **plus** real external LLM grounded synthesis **plus** real semantic embedding vectors, configurable via settings, with deterministic local mode preserved as fallback.

---

## 0. Headline finding (read first)

The biggest gap is **not** the missing LLM or embeddings. It is that the **already-built deterministic pipeline is not wired end-to-end into the live app.**

The live upload path (`src/frontend/sqliteApi.ts:183-185`, `uploadTranscript`) calls **only** `importTranscript`. In production wiring, after upload the app has transcripts/turns/spans and **nothing else**:

- **No memory extraction** runs — `extractMemoryObjectsForTranscript` is only invoked by the orchestration `extractionAgent` (`src/orchestration/agents/extractionAgent.ts:10`), and the orchestration transcript pipeline is **not wired to the UI** (no caller in `src/frontend` or `src/obsidian`).
- **No source/evidence pointers** are created — there is **no live caller** of `createSourcePointer*` anywhere outside `src/provenance/`.
- **No retrieval index** is built — `rebuildRetrievalIndex` and `indexTranscriptSpanForSearch`/`indexMemoryObjectForSearch`/`indexEvidencePointerForSearch` (`src/retrieval/indexer.ts:95-99`) have **no live caller**; they run only in `tests/retrieval.test.ts`.

Consequently the live Ask AI (`sqliteApi.ts:206-207` → `askAI` → `createDatabaseAskAIDependencies` → `retrieve` → `searchEvidencePointers`) queries an **empty `retrieval_documents`** and refuses with `no_evidence`. The retrieval/extraction/provenance subsystems are individually implemented and tested; they are simply **not connected** to the upload→ask flow.

> **Correction to earlier docs.** `docs/APP_SPEC.md` §6 and `docs/CLAUDE_ARCHITECTURE_REVIEW.md` §6 state that retrieval indexing happens "lazily at Ask-AI time (`ask-ai/dependencies.ts`)." That is inaccurate: `createDatabaseAskAIDependencies` does **not** call `rebuildRetrievalIndex` (`src/ask-ai/dependencies.ts:27-36`), and there is no live indexing call at all. Those two docs should be amended when convenient. This gap analysis is the corrected reference.

This means: **MVP requires wiring the deterministic chain first**, because both the current fallback mode and the future LLM/embedding mode are useless until upload actually produces extracted memory, pointers, and an index.

---

## 1. Already complete

| Area | Evidence | Notes |
|---|---|---|
| Transcript ingestion + immutability | `src/ingest/importTranscript.ts`; triggers in migrations 001/002/003 | Dedupe, offsets, raw immutability all enforced and tested. **Wired live.** |
| Raw-source immutability model | DB triggers | Strongest layer; do not touch. |
| Provenance/citation **machinery** | `src/provenance/`, migration 004 | Hash-validated pointer resolution, citation links, claim insert-then-promote all exist and are tested (not yet driven live — see §4). |
| Evidence scoring + strength caps | `src/evidence/`, migration 008 | Deterministic; weak-stays-weak caps proven by tests. |
| Ask AI **pipeline shape** | `src/ask-ai/pipeline.ts` | The 9-step order, refusal, conflict context, persistence all implemented. |
| **Claim validation + citation enforcement** | `claimGeneration.ts:37-50`, `answerRendering.ts:10`, `repository.ts:38-42,60` | Drops claims not citing selected evidence; throws on uncited/broken/unselected pointers; claims inserted `unsupported` then promoted. **Provider-agnostic and complete.** |
| Refusal/warning behavior | `ask-ai/pipeline.ts`, `evidence/rules.ts` | No-evidence refuses; weak/conflicting warn; driven by scoring, not prose. |
| Conflict preservation | `src/conflicts/`, migration 010 | Both sides cited; weak-capped; append-only corrections. |
| Hermes boundaries | `src/hermes/guardrails.ts` | Runtime guardrail asserts presentation-only (substring-warning caveat noted in review). |
| Obsidian generated-view safety | `src/obsidian/vaultWriter.ts` | Manifest-scoped cleanup; user files preserved; output-only. |
| **Vector storage metadata** | migration 007, `search_embeddings` | Stores `embedding_provider`, `embedding_model`, `embedding_dim`, `content_hash`, `vector_json`; unique per `(target, provider, model)`. Good enough for MVP partitioning (see §2 for the one missing piece). |
| **No-mixing-vectors enforcement (query + store)** | `vectorSearch.ts:19` filters by provider+model+dim; `cosineSimilarity`/`validateVector` throw on dim mismatch; store keyed per provider/model (`indexer.ts:114-116`) | The hard rule is structurally enforced today. |
| Deterministic local/test mode | `embeddingProvider.ts`, `claimGeneration.ts`, `extractor.ts` | Fully deterministic, offline, CI-safe. |

---

## 2. Partially complete

| Area | What exists | What's missing for MVP |
|---|---|---|
| **Embedding provider abstraction** | `EmbeddingProvider` interface; `DeterministicTestEmbeddingProvider` (token-hash-v1, 32-dim) + `NoopEmbeddingProvider` (`embeddingProvider.ts:3,8,24`) | No real semantic provider implementation; no way to pass a provider into the live ask/index path (`createDatabaseAskAIDependencies` takes only `{ now }`, `dependencies.ts:27`, and `retrieve()` passes **no** provider, so vector search is dead in production). |
| **LLM provider abstraction (Ask AI)** | `AskAILanguageModel` interface, optional `llm?` dependency; pipeline already routes to `options.llm.generateClaims` when present (`ask-ai/types.ts:95`, `claimGeneration.ts:33-35`) | No concrete LLM client; live deps never supply one; no provider/model/key plumbing into `AskAIDependencies`. |
| **Grounded Ask AI synthesis** | The grounding gate is complete and provider-agnostic (§1); the LLM seam exists | No real synthesis model behind the seam; needs a grounded client that only cites selected evidence, routed through the existing validation. |
| **Memory extraction provider integration** | `PromptBasedMemoryExtractor` (`kind="llm"`) consuming `MemoryExtractionClient.generateJson` (`extractor.ts:5,9`); `DeterministicRuleExtractor` is the only concrete one | No concrete LLM extraction client; extraction itself isn't wired into live ingestion (§0/§4). |
| **Reindexing on provider/model change** | Mechanism is correct: embeddings are stored/looked-up per `(provider, model)` (`indexer.ts:114-116`, `embeddingStore.ts:30-32`), so switching creates a **new** embedding space without overwriting the old one | No "active provider/model" config; no trigger to reindex when the user changes provider; no cleanup of now-stale vectors from the old provider/model; `retrieval_index_status` provider/model bookkeeping is inconsistent (COALESCE in `indexDocument` line 85 vs hard SET in the batch path line 128); and there's **no live caller** to run any reindex at all (§0). |
| **Vector storage metadata** | Provider/model/dim/content_hash all stored | `embedding_dim` is not part of the unique key (`UNIQUE(target,provider,model)`); a model that changes dimension under the same name would silently update rather than partition. Minor, worth documenting/guarding. |
| **Hermes guardrail robustness** | Guardrail exists and is invoked by `answerSynthesisAgent` | Warning-preservation is substring-based; with real LLM prose it could pass while rewording a warning. Harden before enabling LLM synthesis (review §7 #2). |

---

## 3. Missing

| Area | Status |
|---|---|
| **API key settings** | **None exist.** Settings tab is health-only (`src/obsidian/SettingsTab.ts`). No key field, no secret storage, no provider/model fields, no network code anywhere. Needs: provider selection, per-capability model selection, secure key storage, active-mode indicator, offline fallback when unset. |
| **Concrete external LLM client** (Ask AI synthesis) | Not implemented. |
| **Concrete external embedding provider** | Not implemented. |
| **Concrete LLM memory-extraction client** | Not implemented (optional for MVP). |
| **Live wiring: upload → extraction → provenance → index** | Not wired (§0). The single biggest functional gap. |
| **Live wiring: invoke retrieval indexing** | No production caller of `rebuildRetrievalIndex` or the per-doc index functions. |
| **Reindex orchestration on provider/model change** | No detection, no trigger, no stale-vector cleanup. |
| **Passing an embedding provider into the live ask path** | `AskAIDependencies`/`createDatabaseAskAIDependencies` have no provider parameter; `retrieve()` hardcodes provider-less (keyword-only) search. |
| **Network/error/rate-limit handling** for external providers | N/A today; must be added with the first real provider (timeouts, retries, graceful degradation to fallback, never blocking core flow). |

---

## 4. Implemented incorrectly / not wired

These are not "wrong logic" so much as **built-but-disconnected** or **inconsistent**, and must be addressed for MVP:

1. **The deterministic processing pipeline is disconnected from the UI (§0).** Extraction, source/evidence pointers, and indexing exist and pass tests but are never triggered by `uploadTranscript`. The orchestration `transcriptPipeline` that would chain them is not wired to the plugin/frontend.
2. **Live Ask AI is keyword-only over an empty index.** `retrieve()` (`dependencies.ts:9-25`) calls `searchEvidencePointers` with no embedding provider, and `retrieval_documents` is never populated live — so retrieval returns nothing and Ask AI refuses. The vector path (`vectorSearch.ts:13`) is effectively dead in production.
3. **Two Ask AI execution paths exist** — the direct `ask-ai/pipeline` (used by the frontend) and the orchestration `askAiPipeline`/`retrievalRankingAgent` (not wired to UI). Only one should drive the app; the other is duplication/confusion (consistent with the review's duplicated-systems theme). Decide which is canonical before adding LLM/embeddings, so the new integration only has to plug into one path.
4. **`retrieval_index_status` provider/model bookkeeping is inconsistent** (COALESCE vs hard SET, `indexer.ts:85` vs `:128`). Harmless today but will matter once a real provider and reindexing are in play.
5. **Earlier docs claim lazy indexing at ask time** (APP_SPEC §6, REVIEW §6) — incorrect; see §0 correction.

> None of these weaken a trust boundary; they are wiring/consistency gaps. Fixing them must not relax immutability, provenance, scoring, citation, or conflict rules.

---

## 5. Should remain fallback / test-only (do NOT promote to "real" or delete)

| Item | Keep as | Why |
|---|---|---|
| `DeterministicTestEmbeddingProvider` (token-hash-v1) | Offline/test/local default | Deterministic, no network; required for CI and offline use. Never present it as semantic. |
| `NoopEmbeddingProvider` | Explicit "embeddings disabled" mode | Lets keyword-only retrieval run with no vectors. |
| Deterministic templated claim text (`claimGeneration.defaultClaimText`) | Fallback when no LLM configured | Proves grounding works without a model. |
| `DeterministicRuleExtractor` | Fallback extractor | Keeps extraction working offline; LLM extraction stays optional. |
| Deterministic local mode overall | Always-available default | Per APP_SPEC §14: tests must always run here; real providers injected/mockable; no network in tests. |

**Binding constraint:** real providers must be added **behind the existing injection seams** so that swapping in a mock reproduces today's deterministic behavior exactly. Tests must never require a network call or external service.

---

## 6. Recommended implementation order

Ordered by dependency and risk. Each step is its own focused branch (`inspect → plan → approve → implement → test`); do not bundle. **Get explicit approval before any step that adds network/providers/keys or touches a trust boundary.**

**Phase A — Make the deterministic MVP actually work end-to-end (no external services).**
1. **Choose the canonical Ask AI path** (direct `ask-ai/pipeline` vs orchestration). Document the decision; leave the other in place but clearly non-canonical (don't delete during a fix branch). *(Addresses §4.3.)*
2. **Wire upload → processing.** After `importTranscript`, run (deterministically): source-pointer creation → memory extraction (`DeterministicRuleExtractor`) → evidence-pointer creation → retrieval indexing. Keep it transactional and idempotent; preserve immutability and insert-then-promote. *(Addresses §0, §3, §4.1.)*
3. **Invoke retrieval indexing in the live path** (at ingest, incrementally, or lazily before retrieval). Verify live Ask AI now returns grounded, cited answers in deterministic mode. *(Addresses §0, §4.2.)*
4. **Unify user-facing Search onto the retrieval engine** (optional but recommended) so Search and Ask AI agree and the orphaned `search_documents` path stays dead. *(Review §7 #5.)*

> After Phase A, the product is a working, fully-grounded, deterministic MVP. Everything below is the "real intelligence" layer and must not regress Phase A or the trust rules.

**Phase B — Settings & provider plumbing (no behavior change yet).**
5. **Add settings**: provider selection, per-capability model selection, secure API-key storage, active-mode indicator, offline fallback when unset. No key ⇒ deterministic mode. *(Addresses §3 API key settings.)*
6. **Thread provider/model selection through DI**: add an optional embedding provider to `AskAIDependencies`/`createDatabaseAskAIDependencies` and an optional `llm`; resolve concrete implementations from settings. Default resolves to deterministic/no-LLM. *(Addresses §2 abstractions.)*

**Phase C — Real semantic embeddings.**
7. **Implement a real `EmbeddingProvider`** behind the interface, with network/error handling and fallback to deterministic on failure.
8. **Implement reindex-on-provider/model-change**: detect active `(provider, model)`, reindex documents into the new embedding space, optionally clean up stale vectors, and reconcile `retrieval_index_status`. Preserve the no-mixing rule (query + store) and dim-mismatch throwing. *(Addresses §2/§3 reindexing.)*

**Phase D — Real grounded LLM synthesis.**
9. **Harden the Hermes warning guardrail** to be structural (not substring) *before* enabling LLM prose. *(Review §7 #2.)*
10. **Implement a real `AskAILanguageModel`**: receives query + selected evidence only, returns claims citing only selected pointers, routed through the **unchanged** validation/citation gate. Verify refusal/warning behavior still driven by scoring, not prose. *(Addresses §2 grounded synthesis.)*

**Phase E — Optional LLM memory extraction.**
11. **Implement a concrete `MemoryExtractionClient`** behind `PromptBasedMemoryExtractor`, kept optional with deterministic fallback; preserve insert-then-promote and evidence-required promotion. *(Addresses §2 extraction integration.)*

**Cross-cutting invariants for every phase (from APP_SPEC §20/§21):**
- Tests stay deterministic/offline; never require a network or external service; never weaken a test to pass.
- Raw transcript immutability and evidence provenance/hash validation untouched.
- No mixing vectors across providers/models/dimensions.
- No new duplicated search/citation systems — extend the live ones (`evidence_pointers`/`citation_links`/`retrieval_documents`/`search_embeddings`/`ask_ai_runs`); don't revive legacy 001 tables.
- API keys never logged or persisted into vault data; vault content never sent externally without explicit configuration.
- Migrations additive only; new behavior gets new migrations + migration tests.

---

*This is analysis only. No implementation has been performed. Phase A (wiring the deterministic pipeline) is the prerequisite for everything else and should be scoped first.*
