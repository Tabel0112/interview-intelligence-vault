# Transcript Memory Vault — Application Specification & Architecture Contract

> **Status of this document.** This is the contract Claude Code must follow when implementing future work. Every capability is marked with one of three states:
>
> - **[CURRENT]** — implemented today (verified against the committed code).
> - **[MVP]** — intended Minimum Viable Product, **not yet fully implemented**. The intended MVP includes **real external LLM grounded synthesis** and **real semantic embedding-model vectors**. These do not exist yet.
> - **[FUTURE]** — out of MVP scope; post-MVP direction only.
>
> **Critical accuracy rule.** The current deterministic Ask AI and the `token-hash-v1` embedding vectors are **fallback / test / local-only modes**, not the complete intended MVP. Do not describe or assume external LLM/embedding integration already exists, and never describe token-hash vectors as semantic.
>
> Companions: [`CLAUDE.md`](../CLAUDE.md) (non-negotiable rules + Current MVP Gap Rules) and [`docs/MVP_GAP_ANALYSIS.md`](./MVP_GAP_ANALYSIS.md) (gap status). On conflict, `CLAUDE.md` wins, then this spec, then the gap analysis.

---

## 1. Product goal
An Obsidian-style, evidence-grounded memory vault for transcripts. It ingests raw transcripts, splits them into immutable spans, extracts memory objects, scores evidence, detects contradictions, answers questions ("Ask AI") **only from cited transcript evidence**, and renders Obsidian Markdown/graph views. The defining promise is **trust**: every memory, answer, claim, citation, and graph node/edge traces back to raw transcript spans via provenance pointers. SQLite is authoritative; generated Markdown and AI answers are views, never truth.

## 2. User workflow
1. **Import** a transcript (file or pasted text).
2. **Ingest** → immutable raw text, turns, spans, content hashes.
3. **Extract** memory objects (decisions, questions, action items, objections, advice, topics, quotes) with evidence pointers.
4. **Browse** dashboard, transcripts, memory, graph.
5. **Ask AI** → retrieve → score → detect support/opposition/conflict → generate claims only from selected evidence → validate → render with citations + warnings, or refuse.
6. **Review/correct** (append-only).
7. **Generate Obsidian views** (one-way export).

**[MVP]** adds settings to configure an external LLM/embedding provider + key; LLM-synthesized answers (validated against evidence); real semantic embeddings powering retrieval. **[CURRENT]** the workflow runs offline in deterministic local mode.

## 3. Transcript ingestion
**[CURRENT]** `src/ingest/importTranscript.ts`: dedupe by `raw_sha256`; immutable turns/spans with offsets and hashes; text re-verified against offsets before insert. **[MVP]** unchanged contract — ingested transcripts stay immutable and provenance-anchored regardless of provider mode. **[FUTURE]** incremental indexing at ingest, content-aware format detection, streaming.

## 4. Immutable raw-source model
**[CURRENT]** Enforced by DB triggers (immutable sources, transcript identity, turn/span source fields). **Contract (all states):** raw transcripts are immutable after ingestion; generated text never overwrites or masquerades as raw text; adding providers must not touch the raw-source tables.

## 5. Evidence / provenance / citation model
**[CURRENT]** `source_pointers` (`mv://source/…`) bind spans to exact raw offsets; `evidence_pointers` (`mv://evidence/…`) chain to source and attach to targets; `resolveSourcePointer` validates by re-checking raw/span/offset hashes; broken/missing pointers surface as explicit problems; `citation_links` point to the evidence actually used. **Contract (all states):** every generated object and answer claim must trace to spans via validated provenance pointers, regardless of provider. **[FUTURE]** richer provenance (cross-transcript linking, pointer versioning), additive and hash-validated.

## 6. Retrieval — current token-hash fallback
**[CURRENT]** Hybrid keyword (FTS5/LIKE) + vector + ranking + recency (`src/retrieval/`). The only embedding implementations are `DeterministicTestEmbeddingProvider` (token-hash-v1, 32-dim, SHA-256 token hashing — **not semantic**) and `NoopEmbeddingProvider` (disabled). Indexing is performed by `rebuildRetrievalIndex` / the per-doc index functions, which today are **invoked only by tests** — there is no live caller (see §19 and the gap analysis). The user-facing Search view does a direct `transcript_spans LIKE` scan, separate from this engine.

## 7. Embedding provider abstraction (current) and intended real embeddings
**[CURRENT]** A formal embedding-provider abstraction exists:
- `EmbeddingProvider` interface (`{ name, model, dimensions, embedTexts }`).
- **`EmbeddingSpace`** descriptor `{ provider, model, dimensions }` + helpers `embeddingSpaceOf`, `sameEmbeddingSpace`, `assertCompatibleEmbeddingSpace`, `describeEmbeddingSpace`, `isVectorCapable` (`src/retrieval/embeddingSpace.ts`).
- **Registry / default resolver** `resolveEmbeddingProvider(...)` / `createEmbeddingProvider(...)`: token-hash-v1 is the default; `"noop"` disables; an unavailable id falls back to token-hash with `usedFallback: true`.
- **Reindex detection** `detectReindexNeeded(db, active)` (`src/retrieval/reindexStatus.ts`): read-only assessment of whether the index matches the active space (provider/model change ⇒ `needsReindex`).
- Storage already records `embedding_provider`, `embedding_model`, `embedding_dim`, and `content_hash` (input hash) per vector.

**[MVP] — not yet implemented.** A real semantic embedding provider behind `EmbeddingProvider`, used only when configured with a key (else token-hash fallback), with provider/model/dimension/input-hash metadata stored, no mixing across spaces, and reindex on provider/model change. **[FUTURE]** ANN index for scale, multiple simultaneously-indexed providers, packed vector storage, provider migration tooling.

## 8. No mixing vectors across providers/models — hard rule (all states)
Cosine similarity may only compare vectors from the **same provider AND model AND dimension**. Query embeddings must use the same provider/model as the stored documents. A provider/model change is a **new embedding space**: re-embed into new rows; never compare across spaces; dimension mismatch must throw. Enforced today at query (`vectorSearch` filters by provider+model+dim), store (`search_embeddings` unique per provider+model; `validateVector` throws), and via the `embeddingSpace` helpers.

## 9. Ask AI — current deterministic fallback
**[CURRENT]** The 9-step pipeline (`src/ask-ai/pipeline.ts`) is implemented; when no LLM is supplied (the live deps supply none), `generateClaimsFromEvidence` produces **deterministic templated claim text** from the top cited quote. Pipeline, citations, conflict handling, refusal, and persistence all work offline. The prose is templated, not LLM-synthesized.

## 10. Intended external LLM grounded synthesis
**[MVP] — not yet implemented.** A concrete `AskAILanguageModel` (the optional `llm?` dependency) that calls a real external LLM, receiving the **query + selected evidence only**, returning claims citing only selected pointers, wired via DI, with output treated as untrusted and passed through the validation gate (§15). **[CURRENT]** guarantees the LLM path must inherit unchanged: claims filtered to selected pointers; uncited claims dropped; `renderAnswer` throws on a claim without a citation; `persistAskAIResponse` throws on broken/mismatched/unselected pointers; the 9-step order is fixed. **[FUTURE]** streaming, multi-turn, tool-use, caching.

## 11. Optional LLM-backed memory extraction
**[CURRENT]** Deterministic only: `DeterministicRuleExtractor` (regex). A seam `PromptBasedMemoryExtractor` consuming `MemoryExtractionClient.generateJson` exists with minimal shape validation; **no concrete client**. **[MVP]** optional concrete client, kept optional with deterministic fallback; insert-then-promote and evidence-required promotion preserved. **[FUTURE]** cross-span synthesis, entity resolution.

## 12. API key / settings requirements
**[CURRENT] none exist** — the Settings tab is health-only; no key/provider/model fields; no network code. **[MVP]** provider selection, per-capability model selection, key handling, active-mode indicator, offline fallback when unset. **Contract:** **Obsidian has no secret store** — plugin `data.json` is plaintext and may sync — so key storage is a deliberate decision; keys must never be logged, persisted into vault data, or surfaced in errors/health/Markdown; vault content is never sent externally without explicit configuration; no key ⇒ local deterministic mode.

## 13. Model / provider selection
**[MVP]** per-capability (embeddings, synthesis, optional extraction), resolved to concrete implementations via DI. Changing the embedding provider/model creates a new space and requires reindexing (§8). Provider/model identifiers are recorded with generated artifacts. Provider choice affects prose/recall only — never scores, truth, conflict status, provenance, citations, or warnings.

## 14. Local / offline / test mode
**[CURRENT]** the only mode: token-hash/noop embeddings, deterministic claim text, rule extractor — fully deterministic, no network, CI-safe. **Contract (binding on MVP/FUTURE):** local mode is the default when unconfigured; **tests always run here** (no external service, no network); CLAUDE.md determinism rules apply (no unmocked `Date.now`/`Math.random` in ranking/scoring/migration/pipeline); real providers are injected and mockable.

## 15. Claim validation after LLM generation
**[CURRENT]** the gate exists and runs for deterministic claims, enforcing **citation provenance** (pointers in the selected set; citation required; insufficient evidence downgrades support; `renderAnswer`/`persistAskAIResponse` throw on uncited/broken/unselected; claims inserted `unsupported` then promoted). **[MVP]** the same gate must wrap real-LLM output **plus** a claim↔evidence **entailment** check — citation-provenance alone does not verify the claim text is supported by the cited span. LLM output is never trusted as-is; unsupported claims are discarded or marked unsupported; no general-knowledge claims.

## 16. Refusal / warning behavior (all states)
No evidence → refuse (`refused_no_evidence`). Weak → produced but flagged; strength caps hold. Conflicting → both sides preserved and cited, confidence downgraded, conflict context appended. Warnings stay unless the underlying evidence issue is fixed. A real LLM must not let confident prose replace a required warning/refusal — the decision is scoring-driven, not LLM-driven.

## 17. Hermes personalization boundaries
**[CURRENT]** Hermes affects presentation, ranking, defaults, style, follow-ups only; runtime guardrails assert it changes no scores/pointers/confidence/claims/warnings/conflicts. **Note:** the guardrail runs only in the orchestration `answerSynthesisAgent`, which is **not wired into the live frontend Ask AI path** — so Hermes is currently inert in the live app (see §19). **Contract (all states):** Hermes never changes scores, truth, conflict status, provenance, citations, or warnings; a real LLM is no license to bypass this; harden warning-preservation to be structural before enabling LLM prose.

## 18. Obsidian generated Markdown rules
**[CURRENT]** one-way export; cleanup deletes only paths in the plugin's own manifest (user files preserved); generated Markdown never read back as truth; UI CSS-scoped. **Contract (all states):** generated artifacts are never source truth; regeneration never deletes user files; startup stays safe on SQLite/native failure (readable health, never blank).

## 19. Known legacy / duplicated systems
Understand before touching related code. **Do not revive orphans; do not split co-written pairs.**
- **Three search paths:** Search view uses `transcript_spans LIKE`; Ask AI uses `retrieval_documents`/`search_embeddings` (migration 007); the migration-001 `search_documents`(+FTS) path is **orphaned**.
- **`ai_answer_citations` (001) is dead**; live citations use `citation_links` (004).
- **Two answer tables co-written:** `ai_answers` (001) + `ask_ai_runs` (009) — write both or neither.
- **`embedding_records` (001)** superseded by `search_embeddings` (007).
- **Two live memory-evidence systems:** `memory_object_evidence` (001) + `evidence_pointers` (004).
- **Live wiring gap:** the upload path runs only `importTranscript`; extraction, provenance pointers, and retrieval indexing are not invoked live; `rebuildRetrievalIndex` is test-only. (Indexing is **not** lazy-at-ask-time.)
- Prefer the live systems (`evidence_pointers`/`citation_links`/`retrieval_documents`/`search_embeddings`/`ask_ai_runs`) for new work.

## 20. Non-negotiable trust rules
Authoritative in `CLAUDE.md` (Non-Negotiable Trust Rules + Current MVP Gap Rules). They bind every state, including after real LLM/embedding integration: raw immutability; no generated-as-raw; full provenance tracing; retrieve+score before answering; discard/mark unsupported LLM claims; warn on weak/missing/conflicting/broken evidence; generated Markdown never read as truth; append-only corrections; conflicts preserve both sides; Hermes presentation-only; no mixing vector spaces; no network required for core/tests; no network in a SQLite transaction; keys never logged/persisted into vault data.

## 21. What must not change without explicit user approval
Raw immutability + triggers; evidence scoring weights/caps; provenance hash validation; citation correctness + insert-then-promote; conflict preservation + append-only corrections; Ask AI refusal/warning behavior + the 9-step order; Hermes boundaries; Obsidian generated-view boundaries; database migrations (additive only); the no-mixing-vectors rule; the deterministic-local-mode default; any destructive/reset control; and adding network/providers/keys (introduce behind seams, with offline fallback, on explicit go-ahead).

## 22. Implementation seams (where MVP work plugs in)
| Capability | Interface (exists) | Concrete today | MVP to add |
|---|---|---|---|
| Embeddings | `EmbeddingProvider` + `resolveEmbeddingProvider` (`src/retrieval/`) | token-hash-v1, noop | real semantic provider (configured-only, fallback to token-hash) |
| Ask AI synthesis | `AskAILanguageModel` (optional `llm?`) | none (deterministic templated text) | real grounded LLM client + entailment check |
| Memory extraction | `MemoryExtractionClient` / `PromptBasedMemoryExtractor` | `DeterministicRuleExtractor` | optional real LLM extraction client |
| Provider/model/key config | — | health-only Settings tab | settings UI + key handling + mode indicator |

All must be injected, optional, and fall back to deterministic local mode when unconfigured; none may alter scores, truth, provenance, citations, conflicts, or warnings.

---

*This spec documents current behavior truthfully, marks the intended MVP (real external LLM + real semantic embeddings) as not-yet-implemented, and fixes the trust boundaries any implementation must respect.*
