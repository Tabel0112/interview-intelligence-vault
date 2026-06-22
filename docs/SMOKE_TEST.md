# Obsidian Plugin Packaged Smoke Test

Manual end-to-end verification that the **built** plugin works inside a clean Obsidian desktop vault — not just the in-repo offline tests.

`npm test` covers the application logic offline. This checklist covers what only a real Obsidian/Electron runtime can prove: the native SQLite binding loading under Electron, plugin-directory path resolution, DOM interaction, view mounting, settings, and restart persistence.

## Scope and prerequisites

- **Platform:** Apple Silicon macOS. The packaged native binding is `darwin-arm64-abi140` only. Other OS / CPU / Electron-ABI combinations fail safe with a readable health error (by design) and cannot complete this checklist until their native target is built and packaged.
- **Record the environment** you tested against: Obsidian version, Electron version, and ABI (`process.versions.modules`). The checked-in binding was validated on Obsidian `1.12.7` / Electron `39.8.3` / `abi140`.
- The default run is **local deterministic mode** — no API key, no network. An optional secret-safety pass (step 8) uses a *throwaway/fake* key.

## 1. Build and verify the package
- [ ] `npm run build`
- [ ] `npm run verify:dist` — confirms `dist/transcript-memory-vault/` is complete and portable (manifest, `main.js`, `styles.css`, all migrations, a valid native target, no `node_modules`, no developer paths baked in).

## 2. Install into a clean test vault
- [ ] In Obsidian, create a brand-new empty vault (this creates `<vault>/.obsidian`).
- [ ] `npm run install:vault -- <path-to-vault>` (or `TRANSCRIPT_MEMORY_VAULT=<path> npm run install:vault`). The script copies the built plugin into `<vault>/.obsidian/plugins/transcript-memory-vault/` and **never overwrites** an existing `transcript-memory.sqlite` or `data.json`.
- [ ] In Obsidian: **Settings → Community plugins**, enable **Transcript Memory Vault**.

## 3. Startup health — checks 4–5
- [ ] Open the dashboard via the database ribbon icon, or the **Open Transcript Memory Dashboard** command. The view loads and is **not blank**.
- [ ] The dashboard "Database health" section shows: database connected, migration status current, applied = packaged migration count (`12/12`), database location under the plugin directory, and native target `darwin-arm64-abi140`.

## 4. Upload + automatic extraction — checks 6–8
Use this sample transcript (`smoke.txt`):

```
Alex: We decided to use SQLite as the source of truth for the vault.
Sam: We need to add user authentication before launch.
Sam: We need to write the onboarding documentation.
```

- [ ] Upload it from the **Upload Transcript** view (choose the file or paste the text). Confirm an import-success message and that the transcript appears.
- [ ] Extraction runs **automatically on import** (no separate action). In local deterministic mode the rule extractor classifies:
  - the **decision** ("…source of truth…") as **active** (high confidence) — immediately usable as evidence, so it is **not** in the review queue;
  - the two **action items** ("add user authentication", "write the onboarding documentation") as **needs_review** (medium confidence).
- [ ] Open the **Review Queue**. Both needs_review action items are listed, each with **Approve** and **Reject** buttons.

## 5. Approve → Ask AI with citation — checks 9–11
- [ ] In the review queue, **Approve** the "user authentication" action item. Confirm a "Memory approved" result.
- [ ] Open **Ask AI** and ask: `What is the source of truth?`
- [ ] The answer renders with at least one **citation**. (In local mode the claim prose is deterministic/templated; real LLM synthesis runs only when an external LLM is configured — both paths must cite selected evidence.)
- [ ] Click the citation → the **Evidence** view opens. Click **Open exact transcript evidence** → the **Transcript** view opens with the exact span highlighted. This is the full trust chain: AI answer → citation → evidence → exact highlighted transcript span.
- [ ] Confirm approval made the item Ask-AI-visible: ask `What needs to be done before launch?` and confirm the answer cites the approved authentication memory.

## 6. Reject → removal — checks 12–13
- [ ] In the review queue, **Reject** the "onboarding documentation" action item. Confirm it leaves the review queue.
- [ ] Confirm it is not Ask-AI/search evidence: a vault **Search** for `onboarding` does not surface that memory object, and asking Ask AI about onboarding returns no supporting evidence for it.

> **Known UI limitation (verified):** the Reject control is rendered only on `needs_review` items. There is currently no UI control to reject an already-**approved (active)** memory. The full "was citable → rejected → removed from Ask AI/search" transition is proven at the API level by `tests/reviewApproval.test.ts` and `tests/mvpSmoke.test.ts`, but cannot be reproduced through the UI today. (A needs_review item is already excluded from Ask AI/search by Policy A before rejection.)

## 7. Settings + reindex command — checks 14–15
- [ ] Open **Settings → Transcript Memory Vault**. Confirm it shows provider state only — provider mode (local), LLM provider/model, embedding provider/model (`deterministic-test` / `token-hash-v1`), and whether an API key is configured — and never any key value.
- [ ] Open the command palette and confirm **Rebuild Embedding Index** exists. Running it in local mode rebuilds the keyword / token-hash index with **no network call**.

## 8. Secret safety — check 16
- [ ] Local-mode pass: with no key set, nothing secret can leak — confirm no key-like string appears in any view, notice, the settings tab, or the developer console.
- [ ] Optional fake-key pass: in Settings, switch to external mode and enter a **throwaway** key such as `sk-FAKE-do-not-use`. Confirm settings/health show it only as "configured" (never the value). Force an error (e.g. set a bad base URL, then run **Rebuild Embedding Index**) and confirm the key never appears in the resulting Notice, the console, dashboard health, or any generated note. Remove the fake key afterward.

## 9. Source-of-truth boundary + persistence — check 17
- [ ] Confirm raw transcript immutability: the transcript view shows the original text unchanged; raw SQLite tables are never rewritten (enforced by DB triggers).
- [ ] Any Obsidian Markdown the plugin produces is a **view/export**, not the database. (Note: generating Markdown views is **not currently exposed as a live command** in the plugin; SQLite remains the source of truth regardless.)
- [ ] Restart Obsidian and reopen the dashboard. The transcript, the approved/rejected memory states, and any answers persist (reloaded from SQLite).

## Failure expectations
Missing or incompatible native bindings, missing migrations, unsupported environments, and view-load failures must produce **readable, non-blank** health/error states. The plugin never proceeds as if unavailable data were trustworthy, and it exposes no database reset/delete action.
