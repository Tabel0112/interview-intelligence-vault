# Transcript Memory Vault — MVP Gap Analysis

> **Purpose.** Compare the current implementation against the intended MVP defined in [`docs/APP_SPEC.md`](./APP_SPEC.md), under the trust rules in [`CLAUDE.md`](../CLAUDE.md) and the findings in [`docs/CLAUDE_ARCHITECTURE_REVIEW.md`](./CLAUDE_ARCHITECTURE_REVIEW.md). **No code is changed by this document.**
>
> Intended MVP (per APP_SPEC) = the full deterministic pipeline **plus** real external LLM grounded synthesis **plus** real semantic embedding vectors, configurable via settings, with deterministic local mode preserved as fallback.
>
> **Revision note (updated after a strict second review).** This version corrects three overclaims and adds several missing gaps found by re-reading the code: (1) the claim-validation gate enforces *citation provenance* but **not claim↔evidence entailment** — so it is *not* "complete" for LLM output; (2) Hermes personalization and its guardrail are **unreachable in the live Ask AI path**; (3) Obsidian has **no secret storage**, so "secure API-key storage" is a decision, not a given. Also added: query-time embedding failure/warning paths, retrieval-degradation warnings, LLM output failure semantics, vector-scan perf, and packaging ship-blocker scoping. Sequencing in §6 changed so verification and warning surfaces land **before** any external model. Items added/changed in this revision are tagged **[v2]**.

---

## 0. Headline findings (read first)

**Headline 1 — the deterministic pipeline is not wired end-to-end.** The biggest gap is not the missing LLM or embeddings. It is that the **already-built deterministic pipeline is not connected to the live app.**

The live upload path (`src/frontend/sqliteApi.ts:183-185`, `uploadTranscript`) calls **only** `importTranscript`. In production wiring, after upload the app has transcripts/turns/spans and **nothing else**:

- **No memory extraction** runs — `extractMemoryObjectsForTranscript` is only invoked by the orchestration `extractionAgent` (`src/orchestration/agents/extractionAgent.ts:10`), and the orchestration transcript pipeline is **not wired to the UI** (no caller in `src/frontend` or `src/obsidian`).
- **No source/evidence pointers** are created — there is **no live caller** of `createSourcePointer*` anywhere outside `src/provenance/`.
- **No retrieval index** is built — `rebuildRetrievalIndex` and the per-doc index functions (`src/retrieval/indexer.ts:95-99`) have **no live caller**; they run only in `tests/retrieval.test.ts`.

Consequently the live Ask AI (`sqliteApi.ts:206-207` → `askAI` → `createDatabaseAskAIDependencies` → `retrieve` → `searchEvidencePointers`) queries an **empty `retrieval_documents`** and refuses with `no_evidence`. The subsystems are individually implemented and tested; they are simply **not connected**.

**Headline 2 [v2] — grounding-after-LLM is unverified.** The Ask AI answer is a list of claim texts with citation links (`answerRendering.ts:8-12`). The validation gate only checks that each claim's pointers are in the *selected* set and that a citation exists (`claimGeneration.ts:37-50`) — it **never checks that `claim.text` is supported by the cited span**. In deterministic mode this is invisible because `claim.text` *is* the quote. With a real LLM, a claim can assert anything while citing a valid-but-unrelated selected pointer and still render as **supported** — a latent violation of trust rule 5. **A claim↔evidence entailment/verification step is a missing MVP gap and a hard prerequisite for LLM synthesis.** (This corrects §1's earlier "claim validation … complete" claim, which is true only for provenance.)

**Headline 3 [v2] — Hermes and its guardrail are dead in the live path.** The frontend calls `askAI(...)` directly (`sqliteApi.ts:206-207`); `askAI` (`pipeline.ts`) contains **no Hermes anywhere**. Hermes styling + the `assertHermes…` guardrail exist **only** in `answerSynthesisAgent.ts:22-28`, which is in the unwired orchestration path. So today the live app never personalizes and **never runs the guardrail**; the entire Hermes subsystem (migration 011, `src/hermes/`, `hermes.test.ts`) is unreachable in production. This makes "choose the canonical Ask AI path" (§6) a trust decision, not cleanup.

> **Correction to earlier docs.** `docs/APP_SPEC.md` §6 and `docs/CLAUDE_ARCHITECTURE_REVIEW.md` §6 state that retrieval indexing happens "lazily at Ask-AI time (`ask-ai/dependencies.ts`)." That is inaccurate: `createDatabaseAskAIDependencies` does **not** call `rebuildRetrievalIndex` (`src/ask-ai/dependencies.ts:27-36`), and there is no live indexing call at all. Those two docs should be amended when convenient. This gap analysis is the corrected reference.

This means: **MVP requires wiring the deterministic chain first**, and **building grounding-verification + warning surfaces before any external model**, because both the current fallback and the future LLM/embedding mode are useless (or unsafe) until that is true.

---

## 1. Already complete

| Area | Evidence | Notes |
|---|---|---|
| Transcript ingestion + immutability | `src/ingest/importTranscript.ts`; triggers in migrations 001/002/003 | Dedupe, offsets, raw immutability all enforced and tested. **Wired live.** |
| Raw-source immutability model | DB triggers | Strongest layer; do not touch. |
| Provenance/citation **machinery** | `src/provenance/`, migration 004 | Hash-validated pointer resolution, citation links, claim insert-then-promote all exist and are tested (not yet driven live — see §4). |
| Evidence scoring + strength caps | `src/evidence/`, migration 008 | Deterministic; weak-stays-weak caps proven by tests. |
| Ask AI **pipeline shape** | `src/ask-ai/pipeline.ts` | The 9-step order, refusal, conflict context, persistence all implemented. |
| **Citation-provenance** enforcement | `claimGeneration.ts:37-50`, `answerRendering.ts:10`, `repository.ts:38-42,60` | Drops claims not citing selected evidence; throws on uncited/broken/unselected pointers; claims inserted `unsupported` then promoted. **[v2] This enforces provenance only — it does NOT verify the claim text is entailed by the cited span (see §0 Headline 2, §3).** |
| Refusal/warning behavior | `ask-ai/pipeline.ts`, `evidence/rules.ts` | No-evidence refuses; weak/conflicting warn; driven by scoring, not prose. |
| Conflict preservation | `src/conflicts/`, migration 010 | Both sides cited; weak-capped; append-only corrections. |
| Hermes boundaries **(in the orchestration path only)** | `src/hermes/guardrails.ts`, `answerSynthesisAgent.ts:22-28` | Guardrail logic exists and is tested. **[v2] Not invoked in the live frontend path (see §0 Headline 3, §4).** |
| Obsidian generated-view safety | `src/obsidian/vaultWriter.ts` | Manifest-scoped cleanup; user files preserved; output-only. |
| **Vector storage metadata** | migration 007, `search_embeddings` | Stores `embedding_provider`, `embedding_model`, `embedding_dim`, `content_hash`, `vector_json`; unique per `(target, provider, model)`. Good enough for MVP partitioning (one caveat in §2). |
| **No-mixing-vectors enforcement (query + store)** | `vectorSearch.ts:19` filters by provider+model+dim; `cosineSimilarity`/`validateVector` throw on dim mismatch; store keyed per provider/model (`indexer.ts:114-116`) | The hard rule is structurally enforced today. |
| Deterministic local/test mode | `embeddingProvider.ts`, `claimGeneration.ts`, `extractor.ts` | Fully deterministic, offline, CI-safe. |

---

## 2. Partially complete

| Area | What exists | What's missing for MVP |
|---|---|---|
| **Embedding provider abstraction** | `EmbeddingProvider` interface; `DeterministicTestEmbeddingProvider` (token-hash-v1, 32-dim) + `NoopEmbeddingProvider` (`embeddingProvider.ts:3,8,24`) | No real semantic provider; no way to pass a provider into the live ask/index path (`createDatabaseAskAIDependencies` takes only `{ now }`, `dependencies.ts:27`, and `retrieve()` passes **no** provider, so vector search is dead in production). **[v2]** A real provider also means the **query is embedded live per question** (`vectorSearch.ts:14`) — a network call with latency/failure paths not yet handled (see §3). |
| **LLM provider abstraction (Ask AI)** | `AskAILanguageModel` interface, optional `llm?`; pipeline routes to `options.llm.generateClaims` when present (`ask-ai/types.ts:95`, `claimGeneration.ts:33-35`) | No concrete client; live deps never supply one; no provider/model/key plumbing into `AskAIDependencies`. **[v2]** No schema-validation or failure semantics for LLM output (see §3). |
| **Grounded Ask AI synthesis** | The citation-provenance gate exists; the LLM seam exists; answers are per-claim lines, each citing evidence (`answerRendering.ts`) | **[v2]** No entailment verification (Headline 2). Also note the answer is **bulleted claims, not free prose** — "synthesis" here means per-claim generation, which is good for grounding but a UX constraint to acknowledge. |
| **Memory extraction provider integration** | `PromptBasedMemoryExtractor` (`kind="llm"`) consuming `MemoryExtractionClient.generateJson`, with minimal shape validation (`extractor.ts:5,9,14`); `DeterministicRuleExtractor` is the only concrete one | No concrete LLM extraction client; extraction itself isn't wired into live ingestion (§0/§4). |
| **Reindexing on provider/model change** | Mechanism is correct: embeddings stored/looked-up per `(provider, model)` (`indexer.ts:114-116`, `embeddingStore.ts:30-32`), so switching creates a **new** embedding space without overwriting the old | No "active provider/model" config; no trigger to reindex on change; no cleanup of stale vectors; `retrieval_index_status` provider/model bookkeeping is inconsistent (COALESCE at `indexer.ts:85` vs hard SET at `:128`); and there's **no live caller** to run any reindex at all (§0). |
| **Vector storage metadata** | Provider/model/dim/content_hash all stored | `embedding_dim` is **not** part of the unique key (`UNIQUE(target,provider,model)`); a model that changes dimension under the same name would silently `UPDATE` rather than partition. Guard/document this. |
| **Vector retrieval scaling** **[v2]** | `vectorSearch` works correctly at test scale (32-dim) | It loads **every** stored vector for the active provider/model and computes cosine **in JS per query**, with vectors stored as JSON `TEXT` (`vectorSearch.ts:17-24`). At real embedding dimensions over a real corpus this is a **near-term** perf/memory cliff, not a far-off one. ANN/packed storage is FUTURE, but the full-scan cost arrives the moment real embeddings do. |

---

## 3. Missing

| Area | Status |
|---|---|
| **[v2] Claim↔evidence entailment verification** | **Missing entirely.** Validation checks pointer membership, not whether the claim text is supported by the cited span (Headline 2). Required before any LLM synthesis; options include constraining the LLM to extractive claims or adding a verifier pass. |
| **[v2] Hermes wired into the live path + guardrail invoked live** | Missing. Hermes/guardrail run only in the unwired orchestration path (Headline 3). Either port them into the canonical live path (with the guardrail) or explicitly accept Hermes as deferred. |
| **API key settings + storage decision** | **None exist.** Settings tab is health-only (`src/obsidian/SettingsTab.ts`). No key field, no provider/model fields, no network code anywhere. **[v2] Obsidian has no secret store** — `Plugin.saveData` writes plaintext to `<vault>/.obsidian/plugins/<id>/data.json`, which is frequently synced (Obsidian Sync, iCloud, git). "Secure key storage" is therefore a **decision** (store outside the vault, OS keychain via Node, env var, or at minimum a prominent warning), not a given. Needs: provider selection, per-capability model selection, key handling per that decision, active-mode indicator, offline fallback when unset. |
| **Concrete external LLM client** (Ask AI synthesis) | Not implemented. |
| **Concrete external embedding provider** | Not implemented. |
| **Concrete LLM memory-extraction client** | Not implemented (optional for MVP). |
| **Live wiring: upload → extraction → provenance → index** | Not wired (§0). The single biggest functional gap. |
| **Live wiring: invoke retrieval indexing** | No production caller of `rebuildRetrievalIndex` or the per-doc index functions. |
| **Passing an embedding provider into the live ask path** | `AskAIDependencies`/`createDatabaseAskAIDependencies` have no provider parameter; `retrieve()` hardcodes provider-less (keyword-only) search. They also lack `createEvidencePointers`, so the live path assumes evidence pointers already exist — reinforcing that extraction must precede retrieval. |
| **[v2] Query-time embedding failure/latency path** | A real provider embeds the query on every question (`vectorSearch.ts:14`). On failure/timeout, retrieval must fall back to keyword **and** surface a degradation warning (trust rule 6). Undefined today. |
| **[v2] Retrieval-degradation warning surface** | If the active query provider/model/dim ≠ the indexed one, `vectorSearch` returns `[]` **silently** (`vectorSearch.ts:13,19`) and Ask AI drops to keyword-only with no warning. Trust rule 6 requires surfacing weakened/missing evidence. A "stale/unavailable vector index → degraded results" warning is missing. |
| **[v2] LLM structured-output failure semantics** | `generateClaimsFromEvidence` trusts the LLM's output shape (`claimGeneration.ts:33-35`) with no schema validation or fallback. Define behavior for malformed JSON / timeout / refusal — fall back to deterministic, or refuse — and never emit unvalidated claims. |
| **[v2] Evidence token-budget / truncation strategy** | Selected evidence may exceed the LLM context window; truncating cited evidence before synthesis can yield claims citing dropped spans. No strategy specified. |
| **[v2] Network via Obsidian `requestUrl`** | Any external call should use Obsidian's `requestUrl` (CORS/proxy/desktop-safe), not raw `fetch`. Not yet addressed. |
| **[v2] Packaging ship-blocker scoping decision** | The review's single native target (`darwin-arm64-abi140`, no ABI/arch fallback) and the `import.meta.url` migration-path footgun remain unaddressed. If "MVP" means *shippable beyond Apple Silicon*, these are on the critical path; if it means *runs on the author's machine*, they are not. **Decide explicitly** rather than silently excluding. |
| **Reindex orchestration on provider/model change** | No detection, no trigger, no stale-vector cleanup. |
| **Network/error/rate-limit handling** for external providers | N/A today; add with the first real provider (timeouts, retries, graceful degradation to fallback, never blocking core flow). |

---

## 4. Implemented incorrectly / not wired

These are **built-but-disconnected** or **inconsistent**, and must be addressed for MVP:

1. **The deterministic processing pipeline is disconnected from the UI (§0).** Extraction, source/evidence pointers, and indexing exist and pass tests but are never triggered by `uploadTranscript`. The orchestration `transcriptPipeline` that would chain them is not wired to the plugin/frontend.
2. **Live Ask AI is keyword-only over an empty index.** `retrieve()` (`dependencies.ts:9-25`) calls `searchEvidencePointers` with no embedding provider, and `retrieval_documents` is never populated live — so retrieval returns nothing and Ask AI refuses. The vector path (`vectorSearch.ts:13`) is effectively dead in production.
3. **[v2] Hermes + its guardrail are unreachable in the live path.** The frontend `askAI` path never personalizes and never runs `assertHermesOnlyChangedPresentationOrAllowedRanking`; those exist only in the unwired `answerSynthesisAgent` (Headline 3). A built, tested trust subsystem is dead in production.
4. **Two Ask AI execution paths exist** — the direct `ask-ai/pipeline` (used by the frontend) and the orchestration `askAiPipeline`/`retrievalRankingAgent`/`answerSynthesisAgent` (not wired to UI). Only one should drive the app; decide which is canonical **before** adding LLM/embeddings, and account for the Hermes consequence of that choice (item 3).
5. **[v2] Wiring will write into two evidence systems unless a canonical is declared.** Extraction populates `memory_object_evidence` (001) *and* `evidence_pointers` (004); the indexer reads both (`indexer.ts:43-50`). Declare `evidence_pointers`/`citation_links` canonical for new flows so wiring doesn't deepen the duplication the review flagged.
6. **`retrieval_index_status` provider/model bookkeeping is inconsistent** (COALESCE vs hard SET, `indexer.ts:85` vs `:128`). Harmless today; matters once a real provider and reindexing exist.
7. **Earlier docs claim lazy indexing at ask time** (APP_SPEC §6, REVIEW §6) — incorrect; see §0 correction.

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

**Binding constraints:**
- Real providers must be added **behind the existing injection seams** so swapping in a mock reproduces today's deterministic behavior exactly. Tests must never require a network call or external service.
- **[v2] Mixed configurations must each be coherent and tested** — e.g. real embeddings + no LLM (grounded extractive answers), or deterministic embeddings + real LLM. Each capability is independently injected, so the matrix of states must be exercised, not just "all-real" vs "all-fallback."

---

## 6. Recommended implementation order

Reordered **[v2]** so verification and warning surfaces precede any external model. Each step is its own focused branch (`inspect → plan → approve → implement → test`); do not bundle. **Get explicit approval before any step that adds network/providers/keys or touches a trust boundary.**

**Phase A — Make the deterministic MVP actually work end-to-end (no external services).**
1. **[v2] Characterization test first (safest first task — see below).** Pin the current live disconnect as a red test before changing any production code.
2. **Choose the canonical Ask AI path** (direct `ask-ai/pipeline` vs orchestration) **and resolve the Hermes consequence**: if the direct path wins (it's what the UI uses), port Hermes styling **and** the guardrail into it, or explicitly mark Hermes deferred. Document the decision; don't delete the other path during a fix branch. *(Addresses §4.3, §4.4.)*
3. **Wire upload → processing as a tracked async job, not one transaction.** **[v2]** Use the existing `pipeline_runs`/`agent_runs`/`reprocessing_jobs` infrastructure (migration 011) — do **not** run extraction+indexing inside the upload DB transaction (it holds a write lock and, later, would put an LLM network call inside a transaction). Run deterministically: source-pointer creation → extraction (`DeterministicRuleExtractor`) → evidence-pointer creation → retrieval indexing; idempotent; canonical evidence system per §4.5; immutability and insert-then-promote preserved. *(Addresses §0, §3, §4.1.)*
4. **Invoke retrieval indexing in the live path** and verify live Ask AI now returns grounded, cited answers in deterministic mode (the §6.1 test flips green). *(Addresses §0, §4.2.)*
5. **[v2] Add the retrieval-degradation warning surface** (provider/model mismatch, vector unavailable, query-embed failure) so weakened retrieval is visible per trust rule 6.
6. **[v2] Unify user-facing Search onto the retrieval engine (required, not optional)** so Search and Ask AI agree and the orphaned `search_documents` path stays dead. *(Review §7 #5.)*

> After Phase A, the product is a working, fully-grounded, deterministic MVP with visible degradation warnings. Everything below is the "real intelligence" layer and must not regress Phase A or the trust rules.

**Phase B — Settings & provider plumbing (no behavior change yet).**
7. **[v2] Make the API-key storage decision first** (no Obsidian secret store; see §3), then add settings: provider selection, per-capability model selection, key handling per that decision, active-mode indicator, offline fallback when unset. Key validation must be lazy/async and must **never block `onload`** (preserve startup safety). *(Addresses §3 API key settings.)*
8. **Thread provider/model selection through DI**: add an optional embedding provider and optional `llm` to `AskAIDependencies`/`createDatabaseAskAIDependencies`; resolve concrete implementations from settings; default to deterministic/no-LLM. Use Obsidian `requestUrl` for any network. *(Addresses §2 abstractions.)*

**Phase C — Real semantic embeddings.**
9. **Implement a real `EmbeddingProvider`** behind the interface, with network/error handling, query-time embed failure → keyword fallback + warning (§5 surface), and attention to the full-scan cosine cost (§2 scaling).
10. **Implement reindex-on-provider/model-change**: detect active `(provider, model)`, reindex into the new embedding space, clean up stale vectors, reconcile `retrieval_index_status`. Preserve the no-mixing rule (query + store) and dim-mismatch throwing. *(Addresses §2/§3 reindexing.)*

**Phase D — Real grounded LLM synthesis (gated).**
11. **[v2] Build claim↔evidence entailment verification FIRST** (extractive-claim constraint or a verifier pass). This is the prerequisite that keeps LLM output honest (Headline 2); do not enable LLM synthesis without it.
12. **Harden the Hermes warning guardrail** to be structural (not substring) before enabling LLM prose. *(Review §7 #2.)*
13. **Implement a real `AskAILanguageModel`**: receives query + selected evidence only; returns claims citing only selected pointers; validate output shape (§3 failure semantics); route through the entailment check (step 11) **and** the unchanged provenance/citation gate. Verify refusal/warning behavior is still scoring-driven, not prose-driven. *(Addresses §2 grounded synthesis.)*

**Phase E — Optional LLM memory extraction.**
14. **Implement a concrete `MemoryExtractionClient`** behind `PromptBasedMemoryExtractor`, optional with deterministic fallback; preserve insert-then-promote and evidence-required promotion. *(Addresses §2 extraction integration.)*

**Cross-cutting invariants for every phase (from APP_SPEC §20/§21):**
- Tests stay deterministic/offline; never require a network or external service; never weaken a test to pass.
- **[v2] No external model is enabled before its grounding check exists** (entailment for synthesis; shape-validation + fallback for extraction).
- **[v2] Never make a network call inside a SQLite transaction.**
- Raw transcript immutability and evidence provenance/hash validation untouched.
- No mixing vectors across providers/models/dimensions; surface degradation when retrieval is weakened.
- No new duplicated search/citation systems — extend the live ones (`evidence_pointers`/`citation_links`/`retrieval_documents`/`search_embeddings`/`ask_ai_runs`); don't revive legacy 001 tables.
- API keys handled per the §3 storage decision; never logged or persisted into vault data; vault content never sent externally without explicit configuration; use Obsidian `requestUrl`.
- Migrations additive only; new behavior gets new migrations + migration tests.

---

## Safest first coding task **[v2]**

**A characterization/integration test that pins the current live disconnect** — e.g. `importTranscript` (as `sqliteApi.uploadTranscript` does) → `askAI` with the real DB deps → assert it refuses with `no_evidence` and that the memory list is empty. It is:

- **Zero production risk** (test-only; cannot break a trust boundary).
- **Executable proof** of the headline gap, turning "it's not wired" into a red test.
- **The guard rail** for the wiring change: the same test flips to a grounded, cited answer once Phase A processing is wired, proving the wiring did exactly one thing.

The first *production* change is then the **smallest deterministic wiring slice built on the existing `pipeline_runs`/agent infrastructure (not a transaction)**: after upload, run source-pointer creation → `DeterministicRuleExtractor` extraction → evidence-pointer creation → retrieval indexing, idempotently, as a tracked job. No external services, no new tables, raw immutability and insert-then-promote untouched — with the characterization test above as its acceptance criterion.

> Not Phase A step 2 (path choice — entangled with Hermes) and not a single-transaction wiring (write-lock + future network-in-transaction risk). The test-first approach is the lowest-risk way to start.

---

*This is analysis only. No implementation has been performed. Phase A (wiring the deterministic pipeline) is the prerequisite for everything else; grounding-verification and warning surfaces must precede any external model.*
