// MCP server configuration.
//
// The MCP server is a separate process from Obsidian, so it gets its DB path from the environment
// (`TMV_DB_PATH`). Provider settings (LLM + embeddings + API keys) are loaded from the SAME plugin
// settings file the Obsidian app writes — `data.json` — so the standalone server uses the EXACT same
// production providers and the production embedding gate, with no duplicated provider logic and no
// need to duplicate the API key into Claude Desktop's env.
//
// Settings source resolution:
//   - explicit `TMV_SETTINGS_PATH`, if provided; otherwise
//   - inferred as `dirname(TMV_DB_PATH)/data.json` (the plugin directory next to the database).
// If the file is missing or unparseable, settings fall back to env/defaults (never throwing) — but a
// vault with no API embedding configured then lands in the embedding `setup_required` state rather
// than silently running token-hash-v1 as production.
//
// Back-compat: env-based LLM config (`TMV_LLM_*`) still works and is overlaid on top of the file
// settings, so existing Claude Desktop configs keep functioning. Embeddings are ALWAYS taken from the
// plugin settings file (there is intentionally no `TMV_EMBEDDING_*` env path). The API key is never
// logged here, and the raw file contents are never logged or surfaced in errors.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  DEFAULT_SETTINGS, isLlmConfigured, normalizeSettings,
  type LlmSelection, type TranscriptMemorySettings,
} from "../obsidian/settings.js";

export interface McpSettingsSource {
  /** Absolute path the server tried to load plugin settings from. */
  path: string;
  /** True when the file existed and parsed into settings. */
  loaded: boolean;
  /** True when the path came from an explicit `TMV_SETTINGS_PATH` (vs. inferred from `TMV_DB_PATH`). */
  explicit: boolean;
  /** Non-secret reason the file was not loaded (never contains file contents or keys). */
  note?: string;
}

export interface McpConfig {
  dbPath: string;
  /** Optional explicit migrations directory; otherwise openDatabase resolves it relative to the bundle. */
  migrationDirectory?: string;
  /** Non-Obsidian settings (LLM + embeddings + keys) loaded from plugin data.json, overlaid with env LLM. */
  settings: TranscriptMemorySettings;
  /** True when settings fully configure an external LLM. */
  llmReady: boolean;
  /** Where settings came from — for non-secret startup logging/diagnostics. */
  settingsSource: McpSettingsSource;
  /** Optional Obsidian vault name for external obsidian:// deep links (omit -> opens the active vault). */
  obsidianVault?: string;
}

export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConfigError";
  }
}

export interface LoadMcpConfigOptions {
  /**
   * Injectable settings-file reader (tests inject an in-memory map). Returns the file contents, or
   * `undefined` when the file does not exist / is unreadable. Defaults to a safe disk read that never
   * throws. MUST NOT log the contents (they may contain the API key).
   */
  readSettingsFile?: (path: string) => string | undefined;
}

const trimmed = (value: string | undefined): string | undefined => {
  const v = value?.trim();
  return v && v.length > 0 ? v : undefined;
};

/** Safe disk read: returns file contents, or undefined for a missing/unreadable file. Never throws. */
function readSettingsFileFromDisk(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined; // missing or unreadable — fall back to env/defaults (no contents are ever exposed)
  }
}

/**
 * Build MCP config from an environment map (+ injectable file reader). `TMV_DB_PATH` is required.
 *
 * Settings precedence:
 *   1. Plugin settings file (`TMV_SETTINGS_PATH` or `dirname(TMV_DB_PATH)/data.json`) provides the full
 *      settings, including embeddings — this is the production source of truth.
 *   2. Env LLM vars (`TMV_LLM_PROVIDER` default "openai", `TMV_LLM_MODEL`, `TMV_LLM_BASE_URL`,
 *      `TMV_LLM_API_KEY`) are overlaid on top when present, preserving existing env-based LLM configs.
 *
 * Embeddings always come from the plugin settings file; there is no env embedding path, so a vault with
 * no API embeddings configured yields `setup_required` from the embedding gate (never token-hash-v1).
 */
export function loadMcpConfig(
  env: Record<string, string | undefined> = process.env,
  options: LoadMcpConfigOptions = {},
): McpConfig {
  const dbPath = trimmed(env.TMV_DB_PATH);
  if (!dbPath) throw new McpConfigError("TMV_DB_PATH is required (path to the Transcript Memory Vault SQLite database).");

  // 1. Resolve and load plugin settings (data.json).
  const explicitSettingsPath = trimmed(env.TMV_SETTINGS_PATH);
  const settingsPath = explicitSettingsPath ?? join(dirname(dbPath), "data.json");
  const read = options.readSettingsFile ?? readSettingsFileFromDisk;
  const contents = read(settingsPath);

  let fileSettings: TranscriptMemorySettings | undefined;
  let sourceNote: string | undefined;
  if (contents === undefined) {
    sourceNote = "settings file not found; using env/defaults (no API embeddings -> setup_required)";
  } else {
    try {
      fileSettings = normalizeSettings(JSON.parse(contents) as unknown);
    } catch {
      // Never surface file contents in the error — they may contain the API key.
      sourceNote = "settings file present but not valid JSON; using env/defaults";
    }
  }

  // 2. Base on file settings (clone so env overlay never mutates them), or deterministic defaults.
  let settings: TranscriptMemorySettings = fileSettings
    ? { ...fileSettings, apiKeys: { ...fileSettings.apiKeys } }
    : { ...DEFAULT_SETTINGS, apiKeys: {} };

  // 3. Overlay env-based LLM config when any TMV_LLM_* var is present (back-compat).
  const envProvider = trimmed(env.TMV_LLM_PROVIDER);
  const envModel = trimmed(env.TMV_LLM_MODEL);
  const envBaseUrl = trimmed(env.TMV_LLM_BASE_URL);
  const envApiKey = trimmed(env.TMV_LLM_API_KEY);
  if (envProvider || envModel || envBaseUrl || envApiKey) {
    const provider = envProvider ?? "openai";
    const llm: LlmSelection = { provider, model: envModel ?? settings.llm.model };
    if (envBaseUrl) llm.baseUrl = envBaseUrl;
    const apiKeys = { ...settings.apiKeys };
    if (envApiKey) apiKeys[provider] = envApiKey; // env key wins for the LLM provider; embedding key (if shared) is preserved
    settings = { ...settings, mode: "external", llm, apiKeys };
  }

  return {
    dbPath,
    migrationDirectory: trimmed(env.TMV_MIGRATIONS_DIR),
    settings,
    llmReady: isLlmConfigured(settings),
    settingsSource: { path: settingsPath, loaded: fileSettings !== undefined, explicit: Boolean(explicitSettingsPath), note: sourceNote },
    obsidianVault: trimmed(env.TMV_OBSIDIAN_VAULT),
  };
}
