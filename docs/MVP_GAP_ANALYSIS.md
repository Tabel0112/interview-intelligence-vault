# Transcript Memory Vault — MVP Gap Analysis

> Compares the current implementation against the intended MVP in [`docs/APP_SPEC.md`](./APP_SPEC.md), under the rules in [`CLAUDE.md`](../CLAUDE.md). **No code is changed by this document.**
>
> Intended MVP = the full deterministic pipeline **wired end-to-end**, **plus** real external LLM grounded synthesis **plus** real semantic embedding vectors, configurable via settings, with deterministic local mode preserved as fallback. The current deterministic Ask AI and `token-hash-v1` vectors are **fallback/test/local modes**, not the complete MVP.
>
> Reflects the committed state including the embedding-provider abstraction.

---

## 0. Headline findings (read first)

**H1 — the deterministic pipeline is not wired end-to-end.** The live upload path (`sqliteApi.uploadTranscript`) calls **only** `importTranscript`. In production wiring, after upload the app has transcripts/turns/spans and nothing else: no memory extraction (only the unwired orchestration `extractionAgent` calls it), no source/evidence pointers (no live caller of `createSourcePointer*`), and **no retrieval index** (`rebuildRetrievalIndex` and the per-doc index functions have no live caller — only `tests/retrieval.test.ts`). Consequently the live Ask AI queries an empty index and refuses with `no_evidence`. The subsystems are individually implemented and tested; they are simply **not connected**. (Indexing is **not** lazy-at-ask-time — there is no live indexing call at all.)

**H2 — grounding-after-LLM is unverified.** The validation gate enforces **citation provenance** (a claim's pointers are in the selected set; a citation exists) but **never checks that the claim text is entailed by the cited span**. Deterministic mode hides this (claim text *is* the quote). A real LLM could assert anything while citing a valid-but-unrelated selected pointer and render as "supported" — a latent violation of trust rule 5. **Entailment verification is a prerequisite for LLM synthesis.**

**H3 — Hermes is dead in the live path.** The frontend calls `askAI` directly; `askAI` contains no Hermes. Hermes styling + its guardrail exist only in the unwired orchestration `answerSynthesisAgent`. So the live app never personalizes and never runs the guardrail.

This means MVP requires **wiring the deterministic chain first**, and building **grounding-verification + warning surfaces before any external model**.

---

## 1. Already complete
- Transcript ingestion + raw immutability (DB triggers); wired live.
- Provenance/citation machinery (hash-validated pointers, citation links, insert-then-promote claims).
- Evidence scoring + strength caps (deterministic; weak-stays-weak).
- Ask AI pipeline shape (9-step order, refusal, conflict context, persistence).
- **Citation-provenance enforcement** (drops uncited/unselected claims; throws on broken pointers). *Provenance only — not entailment (see H2).*
- Conflict preservation (both sides cited; weak-capped; append-only corrections).
- Obsidian generated-view safety (manifest-scoped cleanup; user files preserved; output-only); safe startup/health.
- **Embedding provider abstraction (committed):** `EmbeddingProvider` interface, token-hash-v1 default, `EmbeddingSpace` descriptors, `resolveEmbeddingProvider` (with flagged fallback), **`detectReindexNeeded`**, and the no-mixing helpers.
- **No-mixing-vectors enforcement** at query (provider+model+dim filter), store (unique per provider+model; `validateVector`/`cosineSimilarity` throw), and via the space helpers.
- Vector storage metadata (provider/model/dimension/content-hash) already persisted.
- Deterministic local/test mode (token-hash/noop embeddings, deterministic claim text, rule extractor).

## 2. Partially complete
- **Embedding provider abstraction → real provider:** the abstraction + default + reindex detection are done; **no real semantic provider** behind the interface, and no way to pass a provider into the live ask/index path (live `retrieve()` passes no provider, so vector search is dead in production; `rebuildRetrievalIndex` has no live caller).
- **LLM provider abstraction (Ask AI):** the `AskAILanguageModel` seam + optional `llm?` exist and the pipeline routes to it; **no concrete client**, no provider/model/key plumbing, no schema-validation/failure semantics for LLM output.
- **Grounded synthesis:** the citation-provenance gate exists; **entailment verification missing** (H2); answers are per-claim lines, not free prose (a UX constraint to acknowledge).
- **Memory extraction provider:** `PromptBasedMemoryExtractor` seam exists; **no concrete LLM client**; extraction not wired live.
- **Reindex on provider/model change:** detection is done (`detectReindexNeeded`); **no trigger to act on it, no stale-vector cleanup, no live caller** to run a reindex.
- **Hermes guardrail robustness:** exists but warning-preservation is substring-based; harden before LLM prose.

## 3. Missing
- Claim↔evidence **entailment verification** (H2) — prerequisite for LLM synthesis.
- **Hermes wired into the live path** + guardrail invoked live (H3).
- **API key settings + storage decision** — none exist; Obsidian has no secret store (plaintext `data.json` may sync), so "secure storage" is a decision, not a given.
- Concrete external **LLM client**, concrete external **embedding provider**, concrete **LLM extraction client** (optional).
- **Live wiring: upload → extraction → provenance → index** (H1), and a live caller for retrieval indexing.
- Passing an embedding provider / LLM into the live ask path (deps lack the parameters).
- **Query-time embedding failure/latency path** and a **retrieval-degradation warning surface** (provider/model mismatch silently yields `[]` today).
- **LLM structured-output failure semantics** (timeout/malformed/refusal → fallback or refuse) and **evidence token-budget/truncation**.
- **Network via Obsidian `requestUrl`**; **packaging ship-blocker decision** (single native target; bundle-path migration footgun).

## 4. Implemented incorrectly / not wired
1. The deterministic processing pipeline is **disconnected from the UI** (H1).
2. Live Ask AI is **keyword-only over an empty index** → refuses; the vector path is dead in production.
3. **Hermes + guardrail unreachable** in the live path (H3).
4. **Two Ask AI execution paths** (direct `ask-ai/pipeline` used by the UI; orchestration `askAiPipeline` unwired) — pick one canonical before adding providers, and account for the Hermes consequence.
5. Wiring will write into **two evidence systems** (`memory_object_evidence` + `evidence_pointers`) unless a canonical is declared.
6. `retrieval_index_status` provider/model bookkeeping is inconsistent (COALESCE vs hard SET) — matters once reindexing is live.

## 5. Should remain fallback / test-only (do not promote or delete)
| Item | Keep as | Why |
|---|---|---|
| `DeterministicTestEmbeddingProvider` (token-hash-v1) | offline/test/local default | deterministic, no network; never present as semantic |
| `NoopEmbeddingProvider` | "embeddings disabled" mode | keyword-only retrieval with no vectors |
| Deterministic templated claim text | fallback when no LLM | proves grounding without a model |
| `DeterministicRuleExtractor` | fallback extractor | offline extraction; LLM extraction stays optional |
| Deterministic local mode overall | always-available default | tests always run here; real providers injected/mockable; no network in tests |

Real providers go **behind the existing seams**; a mock must reproduce today's deterministic behavior. Mixed configs (e.g. real embeddings + no LLM) must each be coherent and tested.

## 6. Recommended implementation order
Verification and warning surfaces precede any external model. Each step is its own focused branch (`inspect → plan → approve → implement → test`). Approval required before any step that adds network/providers/keys or touches a trust boundary.

**Phase A — make the deterministic MVP work end-to-end (no external services).**
1. Characterization test pinning the current live disconnect (upload → ask → refuses).
2. Choose the canonical Ask AI path and resolve the Hermes consequence (port Hermes + guardrail into it, or mark deferred).
3. Wire upload → processing as a tracked **async job** (use the existing `pipeline_runs`/`agent_runs`/`reprocessing_jobs` infra — **not** a single transaction): source pointers → deterministic extraction → evidence pointers → retrieval indexing; idempotent; canonical evidence system declared.
4. Invoke retrieval indexing live; verify grounded, cited answers in deterministic mode.
5. Add the retrieval-degradation warning surface (provider/model mismatch, vector unavailable, query-embed failure).
6. Unify user-facing Search onto the retrieval engine (required).

**Phase B — settings & provider plumbing (no behavior change).**
7. Make the API-key storage decision, then add settings (provider/model selection, key handling, mode indicator, offline fallback); key validation lazy/async, never blocking `onload`.
8. Thread provider/model selection through DI (optional embedding provider + optional `llm` on the ask deps); default deterministic; use Obsidian `requestUrl` for network.

**Phase C — real semantic embeddings.**
9. Implement a real `EmbeddingProvider` (configured-only; query-embed failure → keyword fallback + warning; mind full-scan cosine cost).
10. Implement reindex-on-change using `detectReindexNeeded` (reindex into the new space, optional stale-vector cleanup, reconcile `retrieval_index_status`); preserve no-mixing.

**Phase D — real grounded LLM synthesis (gated).**
11. Build claim↔evidence **entailment verification first** (H2).
12. Harden the Hermes warning guardrail (structural, not substring).
13. Implement a real `AskAILanguageModel` (query + selected evidence only; cites only selected pointers; output shape-validated; routed through entailment + the unchanged provenance/citation gate).

**Phase E — optional LLM memory extraction.**
14. Concrete `MemoryExtractionClient` behind `PromptBasedMemoryExtractor`; optional with deterministic fallback; insert-then-promote preserved.

**Cross-cutting invariants:** tests deterministic/offline; no external model before its grounding check; never network inside a SQLite transaction; raw immutability + provenance untouched; no mixing vector spaces (warn on degradation); no new duplicated search/citation systems; keys never logged/persisted; migrations additive with tests.

---

*Analysis only — no implementation performed. Phase A (wiring) is the prerequisite for everything else; grounding-verification and warning surfaces must precede any external model.*
