# Claude Desktop + MCP bridge (Phase 1)

## Product shape

- **Claude Desktop** — the main chat UI.
- **MCP server** — a local stdio bridge (`src/mcp/`) that exposes the vault's tools to Claude Desktop.
- **Transcript Memory Vault backend** — the real memory/evidence/trust system (unchanged).
- **SQLite** — the source of truth.
- **Obsidian plugin** — the evidence/answer/transcript/graph **viewer** (no longer the main chat UI).

**Claude is not the memory system.** Claude must not synthesize a final answer from raw transcript chunks. The MCP tool **`ask_vault`** calls the existing evidence-first Ask AI pipeline (retrieve → score → select → grounded LLM synthesis → citation/grounding validation → persist) and returns a **validated AnswerBundle**. Claude's chat history is **not** evidence — only selected transcript evidence pointers can support claims.

## Tools (Phase 1)

| Tool | Purpose |
|---|---|
| **`ask_vault`** | **Primary answer tool.** Runs the Ask AI pipeline and returns a validated, citation-grounded `AnswerBundle`. Use this to answer the user. |
| `get_answer` | Reconstruct a previously persisted, validated answer by id (same `AnswerBundle`). |
| `list_recent_answers` | Recent persisted answers as size-limited summaries. |
| `search_vault_answers` | Search **previous answers/questions** (not raw transcripts). |
| `search_evidence` | **Inspection/debug only** — scored, provenance-backed evidence cards. *Not* for synthesizing answers; use `ask_vault`. |
| `get_memory_object` | Inspect a canonical memory object with its evidence pointers/status. Memory text alone is not evidence. |
| `get_conflicts` | Active conflicts/tensions with both sides + evidence links. |

`ask_vault` outcomes: a validated bundle; a **refusal** bundle (`not_enough_evidence: true`, persisted) when evidence is insufficient; `{ ok: false, state: "setup_required" }` when no LLM is configured; `{ ok: false, state: "llm_failed" }` when the LLM fails or produces only ungrounded claims. **Setup-required and llm_failed persist no answer.**

### AnswerBundle (shape)

`answer_id`, `question`, `answer_markdown`, `evidence_confidence`, `not_enough_evidence`, `claims[]` (`claim_id`, `text`, `kind`, `support_state`, `citation_ids`, `warning?`), `citations[]` (`citation_id`, `label`, `evidence_pointer_id`, `source_pointer_id?`, `quote_preview`, `source_span_uri`, `evidence_uri`, `obsidian_internal_uri?`, `obsidian_uri?`, `source_span_obsidian_uri?`, `broken?`), `evidence[]` (`…`, `obsidian_uri?`, `source_span_obsidian_uri?`), `warnings[]`, `conflicts[]`, `followups[]`, `links` (`answer_uri`, `evidence_uris`, `source_span_uris`, `graph_uri`, `answer_obsidian_uri?`, `graph_obsidian_uri?`, `evidence_obsidian_uris?`, `source_span_obsidian_uris?`), `created_at`, `pipeline` (answer mode, claim kinds, evidence confidence, version, non-secret synthesis mode/provider/model).

Two parallel link families, both navigation-only:

- **`mv://…` (canonical)** — the existing stable plugin routes (e.g. `mv://answers/<id>`, `mv://evidence/<id>`, `mv://transcripts/<id>?span=<span>`). These are the source-of-truth routes used inside the Obsidian plugin's views.
- **`obsidian://…` (Phase 2 deep links)** — OS-openable wrappers of the *same* `mv://` route: `obsidian://transcript-memory-vault?route=<encodeURIComponent(mv://…)>[&vault=<TMV_OBSIDIAN_VAULT>]`. Clicking one in Claude Desktop opens (or focuses) Obsidian and navigates the plugin to that view. The handler is an **allowlist**: it decodes the `route`, requires an `mv://` URI that resolves to a known route, then calls the existing internal navigation — nothing else. Unknown/invalid/non-`mv://` links show a readable notice and never navigate. Deep links **carry no secrets** (only an `mv://` route + optional vault name) and **create/modify no data** — SQLite stays the source of truth and `mv://` stays canonical.

> **Native Obsidian graph:** `ask_vault` answers (and extracted memory) are written to SQLite and show up immediately in the plugin's own Graph page. They appear in Obsidian's **native (ribbon) graph** only after you run the plugin's **Sync generated graph notes** command/button, which regenerates the disposable Markdown view layer. See `docs/OBSIDIAN_PLUGIN.md` → *Two graphs*.

**Never** in tool output or persisted metadata: API keys, Authorization headers, full prompts, provider objects, raw upstream errors, or full raw transcript text (quote previews are length-limited and provenance-backed).

## Build and run

```bash
npm install
npm run mcp:build      # -> dist/mcp/server.cjs (+ dist/mcp/migrations/)
npm run mcp:start      # node dist/mcp/server.cjs (configured via env)
```

The server runs as a **separate Node process over stdio**. It opens the SQLite database at `TMV_DB_PATH` and reuses the existing pipeline + `ExternalLlmProvider` (default Node fetch transport). It does **not** require Obsidian to be open. `better-sqlite3` must be installed (resolved at runtime; not bundled).

### Environment variables

| Var | Required | Meaning |
|---|---|---|
| `TMV_DB_PATH` | **yes** | Path to the vault SQLite DB (e.g. `<vault>/.obsidian/plugins/transcript-memory-vault/transcript-memory.sqlite`). |
| `TMV_LLM_PROVIDER` | no (default `openai`) | OpenAI-compatible provider id. |
| `TMV_LLM_MODEL` | for AI features | Model id (e.g. `gpt-4o-mini`). |
| `TMV_LLM_BASE_URL` | no | Override the OpenAI-compatible endpoint. |
| `TMV_LLM_API_KEY` | for AI features | API key. **Never logged or persisted.** |
| `TMV_MIGRATIONS_DIR` | no | Override the migrations directory (defaults to `dist/mcp/migrations`). |
| `TMV_OBSIDIAN_VAULT` | no | Obsidian vault **name** to focus when an `obsidian://` deep link is opened. Omit to target the active vault. Navigation only; never a secret. |

Without a fully configured LLM (`provider + model + key`), `ask_vault` returns `setup_required` — it never produces deterministic/local output. API keys are **not** read from Obsidian `data.json` in Phase 1.

### Configure Claude Desktop

Add to Claude Desktop's MCP config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "transcript-memory-vault": {
      "command": "node",
      "args": ["/absolute/path/to/dist/mcp/server.cjs"],
      "env": {
        "TMV_DB_PATH": "/absolute/path/to/transcript-memory.sqlite",
        "TMV_LLM_PROVIDER": "openai",
        "TMV_LLM_MODEL": "gpt-4o-mini",
        "TMV_LLM_API_KEY": "sk-...",
        "TMV_OBSIDIAN_VAULT": "My Vault"
      }
    }
  }
}
```

`TMV_OBSIDIAN_VAULT` is optional — set it to the Obsidian vault name so the `obsidian://` deep links in answers open that specific vault; omit it to target whichever vault is active.

## Concurrency

The DB opens in WAL mode with `busy_timeout = 5000` (see `src/db/connection.ts`), so the Obsidian plugin and the MCP server can read the same file concurrently. In Phase 1 the **only** MCP write is `ask_vault` persisting answers through the existing answer-persistence path. State lives in SQLite, not MCP process memory.

## Trust boundaries preserved

Evidence-first retrieval; every final claim cites selected evidence and quote-anchors to a span; unsupported LLM claims are discarded (→ `llm_failed`, no fake answer); weak/conflicting evidence is labeled; conflicts preserve both sides; Policy A (unapproved memory is not evidence); raw transcript immutability; append-only corrections; LLM-required (no deterministic fallback); secrets never logged/persisted/returned.

## Phase 1 limitations

- No ask threads / conversation history (each `ask_vault` is an independent evidence-first question).
- No write tools except `ask_vault` answer persistence (no upload/review/correction/delete/reprocess/reindex tools).
- No graph subgraph tool, no chat UI rewrite, no business/abstract prompt work, no query rewrite.

**Phase 2 (now included):** OS-openable `obsidian://transcript-memory-vault?route=<mv://…>` deep links on the `AnswerBundle` (citations, evidence, answer/graph/evidence/source-span links) and on `search_evidence` / `get_memory_object` / `get_conflicts` (`get_conflicts` uses `mv://review/conflict:<id>`). These are **navigation-only** allowlisted wrappers of the canonical `mv://` routes; they add no new tools, no write paths, and no truth-bearing data.
- The stdio server is a minimal, dependency-free JSON-RPC implementation; it can be swapped for the official `@modelcontextprotocol/sdk` later without changing the tool logic in `src/mcp/tools.ts`.
