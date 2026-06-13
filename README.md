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

## Current MVP Gap

The intended MVP includes external AI provider support.

The current code may contain deterministic local substitutes:
- token-hash-v1 vectors instead of neural embedding-model vectors
- rule-based Ask AI answer generation instead of external LLM grounded synthesis
- deterministic extraction instead of provider-backed extraction

These are acceptable as fallback/test modes, but they are not the complete intended MVP.

Do not treat local deterministic substitutes as the final product unless the user explicitly says to reduce scope.

The intended MVP must support:
- API key entry/storage through settings
- provider abstraction for LLM calls
- provider abstraction for embedding calls
- grounded Ask AI synthesis using retrieved/scored evidence
- optional LLM-backed memory extraction
- local deterministic fallback for tests/offline mode
- evidence/provenance/citation validation after LLM output
- no unsupported LLM claims persisted as supported
- no mixing vectors from incompatible embedding providers/models
