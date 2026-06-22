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

## Providers, Keys, And Secret Safety

The plugin runs in **local deterministic mode by default** — no API key, no network. External LLM synthesis and external embeddings are used **only when explicitly configured with a valid key** in plugin settings; otherwise the app falls back to deterministic local mode.

- Obsidian has no secret store, so the API key lives in the plugin's `data.json` (plaintext, and it may sync). This is a deliberate, documented decision.
- The key is never logged, never persisted into vault data or SQLite, and never surfaced in errors, health, or generated Markdown. Settings and health expose only whether a key is configured.
- Changing the embedding provider/model creates a new vector space. Run the **Rebuild Embedding Index** command (command palette) to re-embed; it is the only action that may make a network call, and only when an external embedding provider is configured. In local mode it rebuilds the keyword / token-hash index with no network call.

## Trust Model

`AI answer -> citation -> evidence -> exact highlighted transcript span`

- SQLite is the MVP source of truth.
- Obsidian Markdown notes are views/exports, not the database.
- Search finds candidate evidence; evidence scoring decides trust.
- Weak evidence is not strong truth.
- Conflicting evidence shows both sides.
- Broken pointers remain visible.
- Citations open evidence, and evidence opens the exact highlighted transcript span.
