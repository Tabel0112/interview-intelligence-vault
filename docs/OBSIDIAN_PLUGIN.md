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

## Two graphs: plugin Graph page vs. Obsidian's native graph

There are **two** graph surfaces, and they are populated differently:

| Surface | Reads from | When it updates |
|---|---|---|
| **Plugin Graph page** (a Transcript Memory Vault view) | **SQLite, live** (`buildObsidianGraph`) | Always current — rebuilt on every open. No sync needed. |
| **Obsidian's native (ribbon) graph** | **Markdown files + `[[wiki links]]`** only | Only after you run **Sync generated graph notes** (it cannot see SQLite). |

Obsidian's built-in graph is intentionally Markdown-only — it has no way to read the plugin's SQLite tables. To make it meaningful you generate a **disposable Markdown view layer** from SQLite.

### Sync generated graph notes

- **Command palette:** **Transcript Memory Vault: Sync generated graph notes**.
- **Dashboard:** the **“Sync Obsidian graph notes”** button (with a status line showing never-synced / last-synced timestamp, file count, and node/edge counts).
- Both write the same files into a single folder at the **vault root**:

  ```txt
  <vault>/Transcript Memory Vault/
    00 Home.md
    Transcripts/  Memories/  People/  Topics/  Decisions/  Evidence/  Answers/  Conflicts/  Graphs/
    _system/view-manifest.json   _system/generation-log.md
  ```

- Generated notes carry **frontmatter** (`mv_entity_type`, `mv_entity_id`, `mv_source_of_truth: sqlite`), **`[[wiki links]]`** between transcripts, evidence, memories, answers, conflicts, and entities (so the native graph has edges, not isolated dots), and **explicit warnings** for weak / conflicting / broken evidence. Each generated note states that the database is the source of truth and that editing the Markdown does not change memory.
- **Filenames are human-readable** so the native graph's node names are legible: `<readable title> - <short id>.md` — e.g. `Answers/Source of truth for this app - ask_nXZM2v.md`, `Evidence/Use SQLite as the source of truth - evp_a3d6b2.md`, `Memories/Decisions/SQLite truth - mem_91ab4c.md`. A short, stable id suffix (type prefix + a few chars) keeps paths deterministic and collision-resistant and disambiguates same-titled notes. The **full id always stays in the note's frontmatter (`mv_entity_id`) and body** — the filename is a disposable view, never the only identifier, and is never read back into SQLite.
- After a sync, open Obsidian's ribbon graph — you'll see the generated notes and the provenance chains (transcript ↔ evidence ↔ memory/answer, plus conflicts and entities). New files may take a moment for Obsidian to index.

### When to resync

The generated notes are a **snapshot**. Re-run the sync after you **import a transcript, run AI extraction, or ask AI** (in the plugin or via Claude Desktop/MCP) — otherwise the native graph is stale. There is **no auto-sync yet** (the command is explicit/manual, like Rebuild Embedding Index).

### Safety

- Writes happen **only inside** `Transcript Memory Vault/`. The path is guarded against escaping that folder.
- Cleanup is **manifest-based**: a resync removes only files it previously generated (tracked in `_system/view-manifest.json`) and **never deletes user-created notes** — even ones placed inside the generated folder are left alone unless they were generated.
- Regeneration is **deterministic** (same SQLite → byte-identical files); a user edit to a generated note is overwritten on the next sync.
- **Generated Markdown is never read back into SQLite** and is never treated as truth. No API keys, provider config, prompts, Authorization headers, or raw upstream errors are written. The only SQLite writes a sync makes are to the generation **audit log** (`obsidian_view_runs` / `obsidian_generated_files`) — never to truth-bearing data, and never to raw transcripts.

## Providers, Keys, And Secret Safety

The plugin is **LLM-required**: Ask AI and AI memory extraction need a configured external (OpenAI-compatible) LLM (provider + model + API key in plugin settings). Until one is configured, the dashboard and Ask AI show a **setup-required** state and AI features are disabled — the plugin does **not** generate deterministic/local output, and it does not silently fall back if the LLM fails (it shows a generic failure). Uploading a transcript still imports the immutable raw text; run the **Run AI extraction for transcripts missing it** command after configuring the LLM to extract memory from transcripts imported earlier. External **embeddings are also required for Ask AI**: production Ask AI retrieval (and MCP `ask_vault`) fails closed with an embedding-setup-required state until you configure an external embedding provider (provider + model + dimensions + API key) and run **Rebuild Embedding Index**. The local keyword index serves only non-Ask-AI search surfaces and dev/test seams — it is never the production Ask AI retrieval path.

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
