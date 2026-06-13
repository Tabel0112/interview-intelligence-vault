# Transcript Memory Vault

Transcript Memory Vault is an Obsidian desktop plugin for evidence-grounded transcript memory. SQLite is the MVP source of truth; generated Markdown notes are views and exports only.

The primary trust chain is:

`AI answer -> citation -> evidence -> exact highlighted transcript span`

Weak, conflicting, no-evidence, and broken-pointer states remain visibly labeled.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

The production build creates `dist/transcript-memory-vault/`, ready to copy into an Obsidian vault plugin folder. See [docs/OBSIDIAN_PLUGIN.md](docs/OBSIDIAN_PLUGIN.md) for installation and startup details.

This plugin is desktop-only because it uses native `better-sqlite3` storage and requires a local filesystem vault.
