# Transcript Memory Vault - Claude Code Instructions

## Project Summary

This is an Obsidian-style AI memory vault for transcripts.

The app ingests raw transcripts, chunks them into immutable transcript spans, extracts memory objects, scores evidence, detects contradictions/tensions, supports Ask AI with citations, and generates Obsidian-style Markdown/graph views.

SQLite is the authoritative source of truth. Generated Markdown is a view layer only.

Do not treat generated Markdown, summaries, graph files, or AI answers as source truth. Source truth must come from SQLite records backed by raw transcript spans.

## Non-Negotiable Trust Rules

1. Raw transcripts are immutable after ingestion.
2. Generated text must never overwrite or masquerade as raw transcript text.
3. Every memory object, summary, graph node, graph edge, answer claim, and citation must trace back to transcript spans through provenance/evidence pointers.
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

## Current MVP Gap Rules

The intended MVP includes **real external LLM grounded synthesis** and **real semantic embedding-model vectors**. The current deterministic Ask AI claim generation and the `token-hash-v1` embedding vectors are **fallback / test / local-only modes** — not the complete MVP. See `docs/APP_SPEC.md` (architecture contract) and `docs/MVP_GAP_ANALYSIS.md` (gap status) for the authoritative current / intended-MVP / future breakdown; keep both updated when these facts change.

1. Do not present deterministic Ask AI or `token-hash-v1` vectors as the finished MVP, or describe token-hash vectors as semantic. They are fallback/local/test modes only.
2. Real external providers (LLM or embedding) are used **only when explicitly configured with a valid API key**; otherwise the app falls back to local deterministic mode. Missing/invalid keys must be handled safely — typed errors, no crash, and never silent vector-space corruption.
3. Never mix vectors across providers/models/dimensions. Compare only within one `(provider, model, dimensions)` space; changing provider/model is a new space and requires reindexing.
4. No external model may be enabled before its grounding check exists: claim↔evidence **entailment** verification for Ask AI synthesis, and structured-output shape validation + fallback for extraction. Citation/provenance enforcement alone is **not** entailment.
5. The deterministic pipeline is **not yet wired end-to-end in the live app**: the live upload path stops at ingestion (no extraction, provenance pointers, or retrieval indexing), and `rebuildRetrievalIndex` has no live caller (only tests). Do not assume freshly uploaded data is searchable, or that Ask AI returns grounded answers, in the wired app until this is fixed.
6. API keys must never be logged, persisted into vault data, or surfaced in errors, health, or generated Markdown. Obsidian has no secret store — plugin `data.json` is plaintext and may sync — so key storage is a deliberate decision, not a given.
7. Tests must always run in deterministic local mode with mock/injected providers. No real network calls in tests, ever.
8. Never make a network call inside a SQLite transaction.
9. Hermes personalization is presentation/ranking only and is currently **not invoked in the live frontend Ask AI path** (it lives only in the orchestration `answerSynthesisAgent`). Do not rely on it running there, and never let it change evidence scores, truth status, conflict status, provenance, or warnings.
10. Add real providers only behind the existing injection seams (`EmbeddingProvider`, `AskAILanguageModel`) so that swapping in a mock reproduces today's deterministic behavior.

## Existing Implemented Areas

The project already includes these major layers:

* Database schema and migrations
* Transcript ingestion and chunking
* Pointer/provenance/citation/clickback layer
* Canonical memory-object extraction
* Search and retrieval MVP
* Evidence quality and scoring
* Ask AI MVP
* Contradiction/tension/conflict detection
* Agent orchestration and Hermes personalization MVP
* Obsidian-style generated vault views
* Obsidian plugin startup, health states, settings, and packaging

Before changing anything, inspect the relevant existing files and tests. Do not reimplement existing architecture from scratch.

## Required Verification

After meaningful code changes, run:

```bash
npm test
npm run typecheck
git diff --check
```

If the change affects packaging or the Obsidian plugin distribution, also run:

```bash
npm run build
```

If a command fails, fix the issue or clearly explain why it failed.

## Development Rules

* Prefer small, focused changes.
* Add or update tests with every behavior change.
* Keep deterministic behavior where tests rely on injected timestamps or ordering.
* Do not introduce `Date.now()` into deterministic ranking, scoring, migration, or pipeline logic unless injected/mocked.
* Do not add hidden network dependencies to tests.
* Do not silently change existing public behavior without tests.
* Do not create reset/delete/destructive controls unless explicitly requested.
* Do not broaden the task unless necessary to preserve correctness.
* Do not replace existing architecture with a rewrite unless the user explicitly asks.
* When unsure, inspect first and explain the current behavior before editing.

## Migration Rules

* New database changes must be additive migrations.
* Do not edit old migrations unless this is a fresh unreleased migration and the user explicitly agrees.
* Existing databases must be upgraded through new migrations.
* Migration tests must cover new migration registration and behavior.
* Do not create migrations that silently rewrite raw transcript data.
* Do not create migrations that promote weak/review-needed memory objects to active without validated evidence.

## Evidence And Provenance Rules

* Every generated object must be traceable to raw transcript spans.
* Generated evidence must be provenance-validated before it can be used confidently.
* Weak evidence should remain weak and must not be silently promoted.
* Broken or missing evidence pointers must produce explicit warnings.
* Citation links must point to the evidence actually used.
* If evidence is insufficient, Ask AI should refuse or answer with a clear evidence warning.
* Conflicting evidence must preserve both sides and cite both sides.

## Ask AI Rules

Ask AI must follow this order:

1. Understand the query.
2. Retrieve candidate evidence.
3. Score evidence quality.
4. Detect support, opposition, weakness, and conflicts.
5. Generate only claims supported by selected evidence.
6. Validate generated claims against evidence.
7. Discard or warn on unsupported claims.
8. Render the answer with citations and warnings.
9. Persist the answer bundle, claims, citations, evidence ranks, and follow-ups.

Do not allow Ask AI to answer from general model knowledge when evidence is required from the vault.

## Conflict Detection Rules

* Preserve direct contradictions, tensions, temporal updates, conditional differences, and weak/ambiguous cases separately.
* Do not collapse both sides into one “resolved” claim unless there is explicit evidence or user correction.
* Conflict confidence must respect evidence quality.
* Weak evidence should cap conflict confidence.
* Corrections should be append-only.
* Revalidation should downgrade stale, broken, or invalidated conflicts.

## Obsidian Plugin Rules

* Plugin startup must be safe even when SQLite/native dependencies fail.
* Views must not stay blank on failure.
* The app should show readable health/error states.
* SQLite remains authoritative.
* Generated Markdown is output only and must not be treated as source truth.
* Preserve user-created files when regenerating generated vault views.
* Do not delete user files during generated-vault cleanup.
* Obsidian theme CSS should not be allowed to break the plugin layout.
* Keep plugin UI scoped under a plugin root class where possible.

## Native SQLite / Packaging Rules

* Be careful with native SQLite dependencies and Electron/Obsidian compatibility.
* Startup should fail gracefully if native bindings are missing, incompatible, or not loadable.
* Packaging should include required migrations and runtime files.
* Do not assume a path that only works on one local machine.
* Add tests or smoke tests for missing native dependency, missing migrations, failed initialization, and successful startup.

## How To Work On Tasks

For each task:

1. Inspect the relevant modules and tests.
2. Summarize existing behavior.
3. Identify the smallest safe change.
4. Explain trust-boundary risks before editing.
5. Implement the change.
6. Add/update tests.
7. Run verification.
8. Summarize changed files, behavior, tests, commands run, and remaining risks.

## First-Time Repository Review Task

When first opening this project, do not code immediately.

First produce:

1. A concise architecture map.
2. The main modules and what each owns.
3. All database migrations and what they add.
4. The trust boundaries that must not be broken.
5. The main test suites and what behavior they protect.
6. Areas that look fragile or overcomplicated.
7. Areas that may be incorrect or under-tested.
8. Suggested architecture improvements ranked by risk and value.
9. Recommended updates to this `CLAUDE.md`.

Do not propose a rewrite during the first review.

## When Requirements Are Ambiguous

Do not block on minor naming, formatting, or folder-structure choices. Make a reasonable default and continue.

Block or ask for clarification only if the ambiguity affects:

* data loss
* raw transcript immutability
* evidence scoring
* provenance validation
* citation correctness
* conflict preservation
* database migrations
* public user behavior
* destructive actions

## Preferred Working Style

Use this workflow:

```text
inspect -> plan -> user approval -> implement -> test -> summarize
```

Do not jump straight into large edits.

Do not make broad architecture changes in the same branch as small bug fixes.

One task should usually mean one focused change, one test-backed implementation, and one clear summary.
