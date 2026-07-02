# Transcript Memory Vault — Architecture Review

> First-time repository review produced during the migration from Codex to Claude Code.
> **This is a read-only review.** No production code, tests, or migrations were changed to produce it.
> SQLite remains authoritative; nothing in this document is source truth.

**Scope inspected:** all 12 migrations, ~6,600 lines of `src/`, all 18 test suites (2,515 lines), packaging (`esbuild.mjs`, `manifest.json`, native bindings), and docs. Verified via four parallel subsystem audits plus direct reads of the trust-boundary core. At review time all 180 tests pass and `tsc --noEmit` is clean.

**Headline:** This is a disciplined, trust-rule-faithful codebase. The trust boundaries are enforced primarily *at the database layer* (triggers), which is the right place for them, and they hold. The dominant weakness is **accreted duplication**: migration `001` laid down an ambitious full schema, then migrations `003`–`012` each built a *parallel, more-refined* subsystem alongside it — leaving several `001` tables orphaned or redundantly co-written. That's where most risk and cleanup value sits.

---

## 1. Architecture map

```
Raw text ──► ingest/ ──► transcripts + transcript_turns + transcript_spans   (immutable, DB-enforced)
                              │
                   provenance/ │  source_pointers (hash-validated) ──► evidence_pointers
                              ▼
            memory/extraction/ ──► memory_objects  (insert-then-promote; active⇒evidence required)
                              │
        retrieval/ (FTS5 + vector + ranking, lazy-rebuilt) ──► retrieval_documents / search_embeddings
                              ▼
   ask-ai/ pipeline: understand ▸ retrieve ▸ score(evidence/) ▸ select ▸ conflicts/ ▸ claims ▸
                     validate(drop unsupported) ▸ render(+warnings) ▸ persist(ask_ai_runs + ai_answers)
                              │
        conflicts/ (both sides preserved, weak-capped) ──► conflict_assessments ──► graph_edges
                              ▼
   hermes/ (presentation/ranking/style ONLY, guardrail-asserted)
                              ▼
   frontend/ (FrontendApi over SQLite) ──► obsidian/ (Plugin, views, generated Markdown = output only)
```

SQLite is authoritative everywhere; the Obsidian layer is a renderer + a one-way generated-Markdown exporter. Frontend rendering, startup, and native-binding load all degrade to readable health states rather than crashing.

---

## 2. What each main module owns

| Module | Owns |
|---|---|
| `src/ingest/` | Ingestion orchestration, content-hash dedupe, turn/span segmentation, char-offset mapping, format detection. |
| `src/provenance/` | `mv://source/…` and `mv://evidence/…` pointers, **hash-based validation**, citation labels, clickback resolution, claim support-status rollup. |
| `src/memory/` (+`extraction/`) | LLM/deterministic extraction, candidate gating, confidence/status, fingerprint+Jaccard dedupe, insert-then-promote, canonical trust projection. |
| `src/retrieval/` | Hybrid keyword(FTS5/LIKE)+vector search, weighted ranking, recency, lazy index rebuild, embedding store. |
| `src/evidence/` | Deterministic component scoring, **strength caps**, bundle aggregation, support/opposition/conflict signals, score-run persistence. |
| `src/ask-ai/` | The 9-step pipeline, evidence selection, claim generation + validation, citation building, answer rendering with warnings, bundle persistence. |
| `src/conflicts/` | Pairwise conflict classification, **both-sides preservation with citations**, weak-evidence confidence cap, revalidation/downgrade, append-only corrections, graph materialization. |
| `src/hermes/` | Personalization (query hints, default filters, ranking reorder, style, follow-ups) + **guardrail assertions** that it touches presentation only. |
| `src/orchestration/` | Agent registry, sequential deterministic runner, idempotency keys, pipeline/agent/event persistence. |
| `src/db/` | Connection (FK pragma, WAL, migrations), migration runner, repositories, IDs/hashing, typed errors. |
| `src/frontend/` | `FrontendApi` over SQLite, route matching, page renderers, trust badges, CSS-scoped HTML shell. |
| `src/obsidian/` | Plugin lifecycle, health state machine, native-binding resolution, item views, generated-vault writer (manifest-scoped, user-file-preserving), graph builder. |

---

## 3. Migrations and what each adds

Source of truth is `src/db/migrations/`. **The root `migrations/` directory is a build artifact** — `esbuild.mjs:5-9` deletes and regenerates it from source on every build (so it should arguably be `.gitignore`d; it's currently committed and can drift).

| # | Adds |
|---|---|
| **001** initial_schema | The whole ambitious substrate: `transcript_sources/transcripts/spans/speakers`, `processing_runs`, `memory_objects` + `memory_object_evidence`, `evidence_bundles/evidence_items`, `ai_answers` + `ai_answer_citations`, `graph_nodes/edges`, `user_corrections` (append-only triggers), `search_documents`(+FTS), `embedding_records`. Immutability triggers on sources/identity. |
| **002** | Recreates the transcript-identity immutability trigger (no-op hardening). |
| **003** transcript_ingestion | Adds `raw_text/raw_sha256` to transcripts, `transcript_turns`, span columns (`text/start_line/kind/...`), and exact-source immutability triggers on turns & spans. |
| **004** provenance_pointers | `source_pointers` (URI + offset/hash consistency trigger), `evidence_pointers` (chained to source), `answer_claims`, `citation_links`. Triggers: supported-claim-requires-evidence, evidence-delete cleanup/downgrade. |
| **005** memory_extraction | `extraction_runs`, extraction columns on `memory_objects`, evidence provenance columns. Triggers: active-requires-evidence (UPDATE) + insert-block (can't insert `active`). |
| **006** canonical_memory_status | Strengthens active-requires-evidence to accept either evidence system; adds evidence-delete → `needs_review` downgrade triggers. |
| **007** search_retrieval | `search_embeddings`, `retrieval_index_status`, `retrieval_documents`, delete-cleanup triggers. (A *second* search/index system.) |
| **008** evidence_quality_scoring | `evidence_score_runs` + `evidence_score_items` (full component breakdown + caps). |
| **009** ask_ai_pipeline | `ask_ai_runs`, `ask_ai_run_evidence`, `ask_ai_claim_metadata`, `ask_ai_suggested_followups`. (A *second* answer/evidence-record system.) |
| **010** conflict_detection | `conflict_assessments` (+active-pair unique), `conflict_evidence_links`, both-sides-required + invalidation-downgrade triggers, `conflict_graph_edges`, append-only `conflict_corrections`, `ask_ai_run_conflicts`. |
| **011** agent_orchestration_hermes | `pipeline_runs/agent_runs/pipeline_events` (append-only), `reprocessing_jobs`, Hermes profile/label/topic tables, append-only `hermes_correction_history`. |
| **012** obsidian_views | `obsidian_view_runs`, `obsidian_generated_files` (manifest for safe cleanup). |

Migration registration (`PACKAGED_MIGRATIONS`), package validation, and FTS/retrieval virtual-table setup all live in `src/db/migrations/index.ts`. Additive-only discipline is respected.

---

## 4. Trust boundaries that must not be broken (and where they live)

These are genuinely enforced — mostly in SQL, which is the strongest place:

1. **Raw immutability** — `transcript_sources_immutable_update`, `transcripts_raw_fields_immutable`, `transcripts_ingestion_raw_immutable`, `transcript_turns/spans_exact_source_immutable` (001/002/003). App re-verifies text against offsets before insert (`importTranscript.ts:26,56`).
2. **Provenance is hash-validated** — `resolveSourcePointer` (`sourcePointers.ts:48-62`) requires raw-text, span-text, and offset hashes all to match; broken pointers return typed reasons, surfaced as `problems` by `provenanceValidator.ts`.
3. **No promotion without validated evidence** — `active` memory objects/conflicts can never be *inserted* active; only promoted via UPDATE through triggers (`005:53`, `010:50`). Losing evidence auto-downgrades to `needs_review` (`006`, `010`).
4. **Weak stays weak** — `classifyEvidenceStrength` caps (`evidence/rules.ts:94-122`); conflict confidence capped by min-validated-side quality (`conflicts/rules.ts:47-49`).
5. **Ask AI is evidence-gated** — pipeline order matches the required 9 steps (`ask-ai/pipeline.ts:16-50`); `renderAnswer` throws if any claim lacks a citation (`answerRendering.ts:10`); `persistAskAIResponse` throws on broken/mismatched/unselected pointers (`repository.ts:38-42,60`).
6. **Conflicts preserve both sides** — separate `left`/`right` evidence links, both cited; corrections are append-only and never collapse sides.
7. **Hermes is presentation-only** — `guardrails.ts` asserts unchanged scores/pointers/confidence/claims and non-suppressed warnings/conflicts.
8. **Generated Markdown is output-only** — `vaultWriter.ts` deletes only paths in its own prior manifest; user files survive (proven by `obsidianViews.test.ts:119-123`); nothing reads generated Markdown back as data.
9. **Append-only audit logs** — `user_corrections`, `conflict_corrections`, `pipeline_events`, `hermes_correction_history` all have UPDATE/DELETE-abort triggers.

No live violation of any of these was found. The notes in §6 are *thin spots*, not breaches.

---

## 5. Main test suites and what they protect

| Suite | Protects |
|---|---|
| `db.test.ts` | Schema, immutability triggers, append-only enforcement. |
| `ingest.test.ts` | Dedupe by raw hash, CRLF/offset correctness, raw immutability, source reuse. |
| `provenance.test.ts` | Pointer hash validation, broken-pointer warnings, claim promotion, cleanup downgrade. |
| `memoryExtraction.test.ts` | Insert-then-promote, active-requires-evidence, dedupe/idempotency. |
| `canonicalMemory.test.ts` | Canonical trust projection, strong/reviewable/usable gating, downgrade. |
| `retrieval.test.ts` | Hybrid search, rebuild idempotency, FTS→LIKE fallback, ranking, recency. |
| `evidenceScoring.test.ts` | Deterministic component scoring; caps keep weak weak (0.99→weak). |
| `evidenceRepository.test.ts` | Candidate materialization, score-run persistence. |
| `askAI.test.ts` | 9-step order, citation-required, refuse-on-no-evidence, conflict context. |
| `conflicts.test.ts` | Both-sides preservation, weak-caps-confidence, invalidation downgrade, append-only, graph-edge follow. |
| `hermes.test.ts` | Guardrail rejection of score/warning/pointer/conflict/claim mutation; allowed restyle/reorder. |
| `orchestration.test.ts` | Sequential runner, idempotency-key reuse/conflict, registry. |
| `obsidianStartup.test.ts` | Health states render non-blank with error + trust badges. |
| `nativeBindings.test.ts` | Exact target resolution, no fallback, dashboard available when binding missing. |
| `obsidianViews.test.ts` | Generated-view determinism, **user-file preservation**, manifest cleanup. |
| `obsidianPlugin.test.ts` | Plugin wiring/commands/views. |
| `frontend.test.ts` / `frontendStyles.test.ts` | Route rendering + trust badges; CSS scoping invariants. |

The suite is fast (~2s), deterministic, and aimed squarely at the trust rules — its strongest quality.

---

## 6. Fragile / under-tested areas

**Duplicated / overlapping systems (the big one):**
- **Three search paths, two of them divergent.** The user-facing Search view does naive `transcript_spans.text LIKE` scans (`sqliteApi.ts:243`) and the Ask-AI engine uses the sophisticated hybrid index `retrieval_documents`/`search_embeddings` (007). Meanwhile `search_documents`(+FTS) from `001` via `searchRepo.ts` is wired into the repo factory but **has no live indexer or query caller** — orphaned. `embedding_records` (001) is likewise superseded by `search_embeddings` (007).
- **`ai_answer_citations` (001) is dead** — `createAnswerCitation` has zero callers anywhere, including tests. The live citation system is `citation_links` (004).
- **Two answer tables, co-written.** `persistAskAIResponse` writes both `ai_answers` (`repository.ts:48`) and `ask_ai_runs` (`:69`) in one transaction, so they don't *currently* diverge — but they're read by different layers (`graphBuilder`/`answerNotes`/`home` read `ai_answers`; the dashboard/search read `ask_ai_runs`). Any future writer touching one and not the other silently desyncs the graph from the dashboard.
- **Evidence is written into three representations per answer** (`evidence_bundles`/`evidence_items` 001, `evidence_pointers` 004, `ask_ai_run_evidence` 009); reload reads only the latter two. Heavy bookkeeping with one write-only-for-audit copy.
- **Two live memory-evidence systems** (`memory_object_evidence` 001 + `evidence_pointers` 004) — intentional dual-tracking, but every promotion/cleanup trigger must check both, which is where complexity (and future-bug surface) concentrates.
- **Run-tracking is spread across six tables** (`processing_runs`, `extraction_runs`, `evidence_score_runs`, `ask_ai_runs`, `pipeline_runs`/`agent_runs`, `obsidian_view_runs`).

**Latent footguns (not currently triggered):**
- **`defaultMigrationDirectory()` resolves through `import.meta.url`, which esbuild rewrites to a fake path** `file:///__TRANSCRIPT_MEMORY_BUNDLE__/index.js` (`esbuild.mjs:25-27`). It only works because `Plugin.ts` *always* passes an explicit `migrationDirectory` (`Plugin.ts:43,57,61`). Any future arg-less `openDatabase`/`runMigrations`/`validateMigrationPackage` call inside the bundle would point at a nonexistent directory. No test exercises the bundled default.
- **Single native target, no fallback.** Only `native/darwin-arm64-abi140/` is packaged; `resolveNativeBinding` requires an exact `platform-arch-abi` match. Off-target users get a graceful `error` health state but an unusable plugin. Fine for a personal tool; a blocker for distribution.
- **Indexing is lazy and full.** `rebuildRetrievalIndex` runs at Ask-AI time (`ask-ai/dependencies.ts`), not at ingest. It's idempotent (content-hash skip) but rebuilds over the whole corpus each query — O(corpus) per ask, a scaling cliff.

**Trust thin spots (intact today, worth hardening):**
- **Hermes guardrail is convention, not structure.** It's a runtime assertion invoked only by `answerSynthesisAgent.ts:26` when a profile is set; the personalization functions don't self-assert. The warning-preservation check is substring-based (`guardrails.ts:16-17`) — rewording "weak" to "low-confidence" would pass.
- **`answer_claims_supported_requires_evidence` is `BEFORE UPDATE` only, not INSERT** (`004:109`). Safe today because `createAnswerClaim` always inserts `unsupported` then promotes — but a direct `supported` insert would bypass it.
- **Asymmetric staleness:** answer-claim `support_status` is *not* recomputed when an evidence pointer is deleted (`updateAnswerClaimSupportStatus` is promotion-only; `provenance.test.ts:129-130` asserts a stale `supported` persists), whereas memory objects *do* downgrade. Worth a deliberate decision — it borders the conflict/evidence-tracking rule.
- **`transcript_spans` text↔offset invariant is app-enforced, not DB-enforced** on INSERT (the immutability trigger only fires on UPDATE; the consistency trigger is on `source_pointers`). The app is the only writer, so it holds — but the invariant isn't defended in SQL.
- **`conflicts/repository.ts` `deleteOrDowngradeConflictsForMissingEvidence`** deletes links but never actually updates `status` despite its name — and has no test.

**Determinism (CLAUDE.md flags migrations/pipeline specifically):**
- `runMigrations` writes `applied_at` via non-injected `new Date().toISOString()` (`migrations/index.ts:40`) — audit-only, but literally migration logic.
- Span `created_at` uses `now()` rather than the injected `importedAt` (`importTranscript.ts:76`) — ingest is otherwise deterministic; spans carry wall-clock.
- `ranking.ts:7` falls back to `Date.now()` when `now` is omitted — mockable, but a caller can forget.

**Untested branches:** `onload()`/`onunload()` are never instantiated (only their helpers); `CorrectionModal.ts` is dead code; `vaultWriter` content-skip/error branches; conflict opposing-role links and `resolveConflict`/`dismissConflict` wrappers; `confidence.ts` medium-confidence status paths.

---

## 7. Suggested improvements — ranked by risk × value

Each is additive/cleanup; **none is a rewrite**, and none weakens a trust boundary. *Not yet implemented — this is a recommendation list only.*

| # | Improvement | Value | Risk | Notes |
|---|---|---|---|---|
| 1 | **Make the migration-directory resolution bundle-safe** — give `defaultMigrationDirectory()` a real fallback or assert-loudly when it resolves to the fake bundle path; add a packaged-bundle smoke test. | High | Low | Closes the one latent footgun that could brick a packaged release. |
| 2 | **Harden the Hermes warning guardrail** — replace substring matching with a structural marker set carried on the answer object, and call the guardrail from the personalization entry point (not just the synthesis agent). | High | Low | Turns trust rule 11/12 from convention into enforcement. |
| 3 | **Decide and document answer-claim staleness** — either recompute `support_status` on evidence-pointer delete (symmetry with memory objects) or add an explicit "evidence changed since answer" warning on reload. | High | Med | Touches the evidence-tracking rule; needs a test either way. |
| 4 | **Catalogue and quarantine the orphaned `001` subsystems** — document that `ai_answer_citations`, `search_documents`(+FTS), `embedding_records`, and the `searchRepo` path are legacy/unused; gate them behind a clear comment or remove their factory wiring in a dedicated cleanup branch (additive migration not required to stop writing them). | High | Med | Biggest source of confusion for the next contributor. Do it as its own branch, not mixed with fixes. |
| 5 | **Unify user-facing Search onto the retrieval engine** — have the Search view use `retrieval_documents` hybrid search instead of `transcript_spans LIKE`, so the two search experiences agree. | Med | Med | Improves results and removes a divergent path. |
| 6 | **Add a `transcript_spans` insert-time text↔offset consistency trigger** mirroring the `source_pointers` one. | Med | Low | Moves an app-only invariant into SQL where the rest of the trust model lives. |
| 7 | **Inject `now`/`importedAt` into span `created_at`** and the migration `applied_at` (or accept a clock), for full ingest/migration determinism per CLAUDE.md. | Med | Low | Small, removes the only wall-clock leaks in deterministic paths. |
| 8 | **Add an indexing strategy** — index at ingest (incrementally) rather than full-rebuild per Ask-AI call, or cache the index hash to skip rebuilds. | Med | Med | Scaling; not urgent at small corpus sizes. |
| 9 | **Test `onload`/`onunload` and remove or wire up `CorrectionModal.ts`** (dead code). Add tests for the conflict opposing-role/resolve/dismiss paths and `vaultWriter` skip/error branches. | Med | Low | Coverage on the untested edges. |
| 10 | **`.gitignore` the generated root `migrations/`** (and confirm `dist/`, `main.js` policy) so the build artifact can't drift from source. | Low | Low | Hygiene. |

The highest value-to-risk first moves off Codex are #1 (migration-path safety) and #2 (Hermes guardrail). Each can be taken as a focused `inspect → plan → approve → implement → test` task.

---

## 8. Recommended additions to CLAUDE.md

These encode facts that aren't currently written down and that a fresh agent would otherwise have to rediscover (or get wrong):

1. **Migration source of truth & build artifact.** State explicitly: *"`src/db/migrations/` is authoritative. The root `migrations/` directory is generated by `esbuild.mjs` on every build — never edit it, and never treat it as source."*
2. **The fake `import.meta.url` in bundles.** Add: *"esbuild rewrites `import.meta.url` to a sentinel path. Any code resolving paths from `import.meta.url`/`__dirname` must accept an explicit directory override; the packaged plugin passes `migrationDirectory` and `nativeBinding` explicitly from the plugin dir. Do not add arg-less `openDatabase`/`runMigrations` callers."*
3. **Known duplicated/legacy subsystems.** List the orphans so nobody "wires them back up": *"`ai_answer_citations`, `search_documents`/`search_documents_fts`, `embedding_records`, and `searchRepo` are legacy from migration 001 and are not on the live path. The live systems are `citation_links` (004), `retrieval_documents`/`search_embeddings` (007). `ai_answers` and `ask_ai_runs` are co-written intentionally — if you write one, write both."*
4. **Hermes guardrail is the enforcement point.** Add: *"Any code path that personalizes an answer must run the Hermes guardrail assertions; warning-preservation must be checked structurally, not by string matching."*
5. **Answer-claim status is promotion-only.** Document the deliberate asymmetry (memory objects downgrade on evidence loss; answer claims currently don't) so it isn't "fixed" accidentally or relied on blindly.
6. **Determinism specifics.** Note the two known wall-clock leaks (span `created_at`, migration `applied_at`) so changes near ingest/migrations don't propagate them further, and reiterate that `createId` is random (use content-stable IDs where tests assert ordering).
7. **Native packaging reality.** State that only `darwin-arm64-abi140` is packaged and there is no ABI/arch fallback — distribution to other platforms requires adding native targets *and* tests.
8. **Indexing is lazy.** Document that retrieval indexing happens at Ask-AI time via `rebuildRetrievalIndex`, not at ingest, so contributors don't assume freshly ingested data is searchable through a different path.

---

*Generated as a first-time repository review. No production code, tests, or migrations were modified. Improvements in §7 are not yet implemented.*
