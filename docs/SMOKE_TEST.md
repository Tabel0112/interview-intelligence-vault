# Obsidian Plugin Packaged Smoke Test

Manual end-to-end verification that the **built** plugin works inside a clean Obsidian desktop vault — not just the in-repo offline tests.

`npm test` covers the application logic offline. This checklist covers what only a real Obsidian/Electron runtime can prove: the native SQLite binding loading under Electron, plugin-directory path resolution, DOM interaction, view mounting, settings, and restart persistence.

## Scope and prerequisites

- **Platform:** Apple Silicon macOS. The packaged native binding is `darwin-arm64-abi140` only. Other OS / CPU / Electron-ABI combinations fail safe with a readable health error (by design) and cannot complete this checklist until their native target is built and packaged.
- **Record the environment** you tested against: Obsidian version, Electron version, and ABI (`process.versions.modules`). The checked-in binding was validated on Obsidian `1.12.7` / Electron `39.8.3` / `abi140`.
- The app is **LLM- and embedding-required**: Ask AI (in Obsidian and via Claude Desktop / MCP) needs BOTH a configured external (OpenAI-compatible) **LLM** (extraction + synthesis) AND a configured external **embedding provider** (retrieval). **You must configure both real providers/keys before testing AI features** (step 3a). Without them, the app shows setup-required (`setup_required` / `embedding_setup_required`) and does not generate — that is correct, not a bug. There is no local/deterministic product mode; an LLM-only setup is incomplete.

## 1. Build and verify the package
- [ ] `npm run build`
- [ ] `npm run verify:dist` — confirms `dist/transcript-memory-vault/` is complete and portable (manifest, `main.js`, `styles.css`, all migrations, a valid native target, no `node_modules`, no developer paths baked in).

## 2. Install into a clean test vault
- [ ] In Obsidian, create a brand-new empty vault (this creates `<vault>/.obsidian`).
- [ ] `npm run install:vault -- <path-to-vault>` (or `TRANSCRIPT_MEMORY_VAULT=<path> npm run install:vault`). The script copies the built plugin into `<vault>/.obsidian/plugins/transcript-memory-vault/` and **never overwrites** an existing `transcript-memory.sqlite` or `data.json`.
- [ ] In Obsidian: **Settings → Community plugins**, enable **Transcript Memory Vault**.

## 3. Startup health — checks 4–5
- [ ] Open the dashboard via the database ribbon icon, or the **Open Transcript Memory Dashboard** command. The view loads and is **not blank**.
- [ ] The dashboard "Database health" section shows: database connected, migration status current, applied = packaged migration count (`16/16`), database location under the plugin directory, and native target `darwin-arm64-abi140`.

## 3a. Configure the LLM AND embeddings (both required before AI features)
- [ ] Open **Settings → Transcript Memory Vault**. Confirm the top message says Ask AI requires BOTH an LLM and an external embedding provider, and that it is currently NOT configured.
- [ ] Confirm the **dashboard** and the **Ask AI** view show a clear **setup-required** state (not a deterministic/local answer).
- [ ] Set **LLM provider** = `openai`, **LLM model** (e.g. `gpt-4o-mini`), and a **real API key**.
- [ ] Set **Embedding provider** = `openai`, **Embedding model** (e.g. `text-embedding-3-small`), **Embedding dimensions** (e.g. `1536`), and a **real API key**. (Confirm the Settings **"AI retrieval (embeddings)"** status flips from "Not configured" to "Configured".)
- [ ] Confirm the Settings **"AI (LLM)"** and **"AI retrieval (embeddings)"** status lines both show Configured, and the setup-required banners clear. Then run **"Rebuild Embedding Index"** so Ask AI retrieval uses the configured provider (embedding health becomes `ok`).

## 4. Upload + automatic LLM extraction — checks 6–8
Use this sample transcript (`smoke.txt`):

```
Alex: We decided to use SQLite as the source of truth for the vault.
Sam: We need to add user authentication before launch.
Sam: We need to write the onboarding documentation.
```

- [ ] Upload it from the **Upload Transcript** view (choose the file or paste the text). Confirm an import-success message and that the transcript appears.
- [ ] Extraction runs **automatically on import** using the configured LLM (no separate action). **All LLM-extracted memory lands in `needs_review`** (LLM output is never auto-promoted to active).
- [ ] Open the **Review Queue**. The extracted items (decision + action items) are listed, each with **Approve** and **Reject** buttons.
- [ ] *(No-LLM check)* Before configuring the LLM (or after clearing it), uploading still imports the raw transcript but shows **"AI memory extraction needs a configured LLM"** and creates **no** memory. After configuring, run the **"Run AI extraction"** command and confirm memory then appears.

## 5. Approve → Ask AI with citation — checks 9–11
- [ ] In the review queue, **Approve** the decision memory ("…source of truth…"). Confirm a "Memory approved" result.
- [ ] Open **Ask AI** and ask: `What is the source of truth?`
- [ ] The answer is generated by the configured LLM and renders with at least one **citation** to selected evidence (claims are grounded/quote-anchored; if the LLM fails you see a generic failure, never a deterministic answer).
- [ ] Click the citation → the **Evidence** view opens. Click **Open exact transcript evidence** → the **Transcript** view opens with the exact span highlighted. This is the full trust chain: AI answer → citation → evidence → exact highlighted transcript span.
- [ ] Confirm an unapproved memory is not yet evidence: ask about an action item you have **not** approved and confirm Ask AI does not cite it (Policy A). Approve it, re-ask, and confirm it is now cited.

## 6. Reject → removal — checks 12–13
- [ ] In the review queue, **Reject** the "onboarding documentation" memory. Confirm it leaves the review queue.
- [ ] Confirm it is not Ask-AI/search evidence: a vault **Search** for `onboarding` does not surface that memory object, and asking Ask AI about onboarding returns no supporting evidence for it.

> **Known UI limitation (verified):** the Reject control is rendered only on `needs_review` items. There is currently no UI control to reject an already-**approved (active)** memory. The full "was citable → rejected → removed from Ask AI/search" transition is proven at the API level by `tests/reviewApproval.test.ts` and `tests/mvpSmoke.test.ts`, but cannot be reproduced through the UI today. (A needs_review item is already excluded from Ask AI/search by Policy A before rejection.)

## 7. Settings + commands — checks 14–15
- [ ] Open **Settings → Transcript Memory Vault**. Confirm it shows the **AI (LLM)** readiness state (configured vs. "Not configured. Ask AI and AI memory extraction are disabled…"), the LLM provider/model, embedding provider/model, and whether an API key is configured — and **never any key value**. There is no user-facing local/deterministic mode dropdown.
- [ ] Open the command palette and confirm **Rebuild Embedding Index** and **Run AI extraction for transcripts missing it** both exist. (Embeddings remain optional; the local keyword index rebuilds with no network call.)

## 8. Secret safety — check 16
With the real LLM key configured (it is now exercised by extraction + Ask AI), confirm the key never leaks:
- [ ] Settings/health show the key only as "configured" — never the value.
- [ ] After running extraction and an Ask AI question, confirm no key-like string appears in any view, notice, the settings tab, the dashboard health, any generated note, or the developer console.
- [ ] Force a failure (e.g. set a bad **LLM base URL**, then Ask AI) and confirm the error is a **generic** message ("could not generate an answer") with no key, no Authorization header, and no raw upstream error text in the Notice/console.

## 9. Source-of-truth boundary + persistence — check 17
- [ ] Confirm raw transcript immutability: the transcript view shows the original text unchanged; raw SQLite tables are never rewritten (enforced by DB triggers).
- [ ] Any Obsidian Markdown the plugin produces is a **view/export**, not the database. (Note: generating Markdown views is **not currently exposed as a live command** in the plugin; SQLite remains the source of truth regardless.)
- [ ] Restart Obsidian and reopen the dashboard. The transcript, the approved/rejected memory states, and any answers persist (reloaded from SQLite).

## 10. (Optional) MCP / Claude Desktop — checks 18–19
The MCP server is the recommended main chat UI. It runs as a **separate system-Node process** (not Electron), so its `better-sqlite3` is matched to your Node, independent of Obsidian's Electron ABI.

- [ ] `npm install` (so `node_modules/better-sqlite3` exists — the MCP bundle resolves it at runtime, never bundles it) and `npm run mcp:build` (→ `dist/mcp/server.cjs` + `dist/mcp/migrations/`).
- [ ] Point `TMV_DB_PATH` at the **same** vault DB the plugin uses: `<vault>/.obsidian/plugins/transcript-memory-vault/transcript-memory.sqlite`. Add the server to `claude_desktop_config.json` with `command: node`, `args: ["<repo>/dist/mcp/server.cjs"]`, and `env` `TMV_DB_PATH` (and optional `TMV_OBSIDIAN_VAULT`). The server reads the LLM **and** embedding providers/keys from the plugin `data.json` next to `TMV_DB_PATH` (configured in step 3a) — no key needs to be duplicated into the config; the optional `TMV_LLM_*` env vars override the LLM only (never embeddings). See [MCP.md](MCP.md).
- [ ] In Claude Desktop, call **`ask_vault`** with `What is the source of truth?`. Confirm a validated AnswerBundle with at least one citation, and that the `obsidian://` deep links open Obsidian to the right view. Missing `TMV_DB_PATH` must fail with a clear setup error; an unconfigured/failed LLM returns setup-required / llm-failed and persists no answer.

## Failure expectations
Missing or incompatible native bindings, missing migrations, unsupported environments, and view-load failures must produce **readable, non-blank** health/error states. The plugin never proceeds as if unavailable data were trustworthy, and it exposes no database reset/delete action.
