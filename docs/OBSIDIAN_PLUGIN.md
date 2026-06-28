# Obsidian Plugin Installation

Transcript Memory Vault is an Obsidian desktop plugin. Mobile is not supported because the MVP uses native `better-sqlite3` storage and a local filesystem vault.

## Build

```bash
npm install
npm run build
```

The build creates:

```txt
dist/transcript-memory-vault/
  manifest.json
  main.js
  styles.css
  migrations/
  native/
    darwin-arm64-abi140/
      better_sqlite3.node
```

Run `npm run verify:dist` after building to confirm the packaged output is complete and portable (manifest, `main.js`, `styles.css`, all migrations, a valid native target, no `node_modules`, no developer paths) before installing.

The `better-sqlite3` JavaScript wrapper is bundled into `main.js`. Native bindings are packaged explicitly under `native/<platform>-<architecture>-abi<module ABI>/`. At startup, the plugin selects an exact match using `process.platform`, `process.arch`, and `process.versions.modules`. Migrations and native bindings are resolved relative to the installed plugin directory, not the repository, current working directory, or a developer vault path.

The checked-in MVP release currently supports only `darwin-arm64-abi140`, tested with Obsidian `1.12.7` / Electron `39.8.3` on Apple Silicon. Other operating systems, CPU architectures, and Electron ABIs fail safely with a readable dashboard/settings error until their exact native target is added. Rebuild and test native bindings before distributing to those targets or after Obsidian changes Electron ABI.

## Manual Installation

1. Build the plugin.
2. Copy `dist/transcript-memory-vault/` into:

   ```txt
   <vault>/.obsidian/plugins/transcript-memory-vault/
   ```

   Or run `npm run install:vault -- <path-to-vault>` (also reads the `TRANSCRIPT_MEMORY_VAULT` env var). The script copies the built plugin into the vault's plugin directory and never overwrites an existing `transcript-memory.sqlite` or `data.json`.

3. Restart Obsidian.
4. Enable **Transcript Memory Vault** under **Settings -> Community plugins**.
5. Open the dashboard from the database ribbon icon or the **Open Transcript Memory Dashboard** command.

The database is stored at:

```txt
<vault>/.obsidian/plugins/transcript-memory-vault/transcript-memory.sqlite
```

On first successful startup, migrations run automatically and the dashboard displays a short ready message. Raw transcript snapshots imported into SQLite are immutable.

## Health And Failure Behavior

The dashboard and plugin settings display:

- database connection state
- migration status
- packaged and applied migration counts
- database location
- last initialization error
- whether real SQLite storage is connected
- detected native binding target and packaged native targets
- provider mode (local / external), the selected LLM and embedding provider/model, and whether an API key is configured (state only, never the key value)
- embedding reindex status (whether the index matches the active embedding provider/model)

Missing or incompatible native bindings, missing migrations, unsupported environments, and view-loading failures produce readable errors. Views and settings remain available to show health information. The plugin does not continue as if unavailable data were trustworthy, and it does not expose database reset/delete actions.

## Deep Links (`obsidian://`)

The plugin registers an OS-level protocol handler so other apps — primarily **Claude Desktop** via the MCP bridge (see `docs/MCP.md`) — can open Obsidian directly to a plugin view:

```txt
obsidian://transcript-memory-vault?route=<encodeURIComponent(mv://…)>[&vault=<vault name>]
```

- **What it does:** decodes `route`, validates it against an **allowlist** (it must be an `mv://` URI that resolves to a known plugin route — answer, evidence, transcript span, memory, graph, search, review, or a `mv://review/conflict:<id>` item), then opens that view through the plugin's existing internal navigation. The optional `vault` param (Obsidian's own) focuses a specific vault; omit it to use the active vault.
- **Navigation only.** A deep link never creates or modifies data, never bypasses evidence validation, and carries no secrets — only an `mv://` route plus an optional vault name. It is exactly equivalent to clicking the corresponding in-app link.
- **Failure mode:** an unrecognized, malformed, non-`mv://` (e.g. `file://`, `https://`), or unknown-route link shows a readable **Notice** and does **not** navigate. Nothing is opened or changed.
- **Canonical routing is unchanged.** `mv://…` remains the source-of-truth route inside the plugin; `obsidian://…` is only an OS-openable wrapper around it. **SQLite remains the source of truth.**

## Providers, Keys, And Secret Safety

The plugin is **LLM-required**: Ask AI and AI memory extraction need a configured external (OpenAI-compatible) LLM (provider + model + API key in plugin settings). Until one is configured, the dashboard and Ask AI show a **setup-required** state and AI features are disabled — the plugin does **not** generate deterministic/local output, and it does not silently fall back if the LLM fails (it shows a generic failure). Uploading a transcript still imports the immutable raw text; run the **Run AI extraction for transcripts missing it** command after configuring the LLM to extract memory from transcripts imported earlier. External **embeddings are optional** — retrieval uses a local keyword index until you configure and rebuild an embedding provider.

- Obsidian has no secret store, so the API key lives in the plugin's `data.json` (plaintext, and it may sync). This is a deliberate, documented decision.
- The key is never logged, never persisted into vault data or SQLite, and never surfaced in errors, health, or generated Markdown. Settings and health expose only whether a key is configured and whether the LLM is ready.
- Changing the embedding provider/model creates a new vector space. Run the **Rebuild Embedding Index** command (command palette) to re-embed; it is the only action that may make an embedding network call, and only when an external embedding provider is configured. Otherwise it rebuilds the local keyword index with no network call.

## Trust Model

`AI answer -> citation -> evidence -> exact highlighted transcript span`

- SQLite is the MVP source of truth.
- Obsidian Markdown notes are views/exports, not the database.
- Search finds candidate evidence; evidence scoring decides trust.
- Weak evidence is not strong truth.
- Conflicting evidence shows both sides.
- Broken pointers remain visible.
- Citations open evidence, and evidence opens the exact highlighted transcript span.
