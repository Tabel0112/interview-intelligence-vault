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
  node_modules/better-sqlite3/
  node_modules/bindings/
  node_modules/file-uri-to-path/
```

The native `better-sqlite3` binary must be compatible with the Node/Electron ABI used by the installed Obsidian desktop version. If it is incompatible, the plugin shows a startup error instead of opening or modifying the database.

## Manual Installation

1. Build the plugin.
2. Copy `dist/transcript-memory-vault/` into:

   ```txt
   <vault>/.obsidian/plugins/transcript-memory-vault/
   ```

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

Missing migrations, native SQLite failures, unsupported environments, and view-loading failures produce readable errors. The plugin does not continue as if unavailable data were trustworthy, and it does not expose database reset/delete actions.

## Trust Model

`AI answer -> citation -> evidence -> exact highlighted transcript span`

- SQLite is the MVP source of truth.
- Obsidian Markdown notes are views/exports, not the database.
- Search finds candidate evidence; evidence scoring decides trust.
- Weak evidence is not strong truth.
- Conflicting evidence shows both sides.
- Broken pointers remain visible.
- Citations open evidence, and evidence opens the exact highlighted transcript span.
