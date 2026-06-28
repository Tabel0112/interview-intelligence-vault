// MCP server configuration, built from environment variables only.
//
// Phase 1 deliberately does NOT read Obsidian's data.json: the MCP server is a separate process and
// gets its own DB path + LLM config from the environment. The returned settings reuse the existing
// (Obsidian-free) `TranscriptMemorySettings` shape so the same `askAiSynthesisFromSettings` resolver
// and `ExternalLlmProvider` are used — no duplicate LLM logic. The API key is never logged here.

import { DEFAULT_SETTINGS, isLlmConfigured, type TranscriptMemorySettings } from "../obsidian/settings.js";

export interface McpConfig {
  dbPath: string;
  /** Optional explicit migrations directory; otherwise openDatabase resolves it relative to the bundle. */
  migrationDirectory?: string;
  /** Non-Obsidian settings built from env. Carries the API key (its purpose); never log it. */
  settings: TranscriptMemorySettings;
  /** True when the env fully configures an external LLM. */
  llmReady: boolean;
}

export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConfigError";
  }
}

const trimmed = (value: string | undefined): string | undefined => {
  const v = value?.trim();
  return v && v.length > 0 ? v : undefined;
};

/**
 * Build MCP config from an environment map. `TMV_DB_PATH` is required. The LLM is configured from
 * `TMV_LLM_PROVIDER` (default "openai"), `TMV_LLM_MODEL`, `TMV_LLM_BASE_URL`, `TMV_LLM_API_KEY`.
 * When the LLM is not fully configured, `llmReady` is false and ask_vault returns setup-required.
 */
export function loadMcpConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const dbPath = trimmed(env.TMV_DB_PATH);
  if (!dbPath) throw new McpConfigError("TMV_DB_PATH is required (path to the Transcript Memory Vault SQLite database).");

  const provider = trimmed(env.TMV_LLM_PROVIDER) ?? "openai";
  const model = trimmed(env.TMV_LLM_MODEL) ?? "";
  const baseUrl = trimmed(env.TMV_LLM_BASE_URL);
  const apiKey = trimmed(env.TMV_LLM_API_KEY);

  const settings: TranscriptMemorySettings = {
    schemaVersion: 1,
    mode: "external",
    llm: { provider, model, ...(baseUrl ? { baseUrl } : {}) },
    embedding: DEFAULT_SETTINGS.embedding, // external embeddings are not required in Phase 1
    apiKeys: apiKey ? { [provider]: apiKey } : {},
  };

  return {
    dbPath,
    migrationDirectory: trimmed(env.TMV_MIGRATIONS_DIR),
    settings,
    llmReady: isLlmConfigured(settings),
  };
}
