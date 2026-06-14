// Provider / API-key settings foundation.
//
// Stored in Obsidian's plugin data.json (NOT SQLite) so that:
//  - settings remain editable even when the database is unavailable, and
//  - user config / secrets never enter the authoritative transcript trust store.
//
// This module is intentionally PURE (no Obsidian, network, Date, or randomness) so it is
// fully unit-testable and deterministic. Nothing here makes a network call, and nothing
// consumes these settings to change runtime behavior yet — the app stays in local
// deterministic mode regardless of what is stored here.

export type ProviderMode = "local" | "external";

export interface ProviderSelection {
  provider: string;
  model: string;
}

export interface TranscriptMemorySettings {
  schemaVersion: 1;
  /** "local" = fully offline deterministic mode (default). "external" is recorded but inert until wired. */
  mode: ProviderMode;
  llm: ProviderSelection;
  embedding: ProviderSelection;
  /** providerId -> secret. Kept isolated so it can later move to a keychain in one place. */
  apiKeys: Record<string, string>;
}

export const LLM_PROVIDER_OPTIONS = ["none", "anthropic", "openai"] as const;
export const EMBEDDING_PROVIDER_OPTIONS = ["deterministic-test", "noop", "anthropic", "openai"] as const;

export const DEFAULT_SETTINGS: TranscriptMemorySettings = {
  schemaVersion: 1,
  mode: "local",
  llm: { provider: "none", model: "" },
  embedding: { provider: "deterministic-test", model: "token-hash-v1" },
  apiKeys: {},
};

/** Marker substituted for any secret when settings are serialized for logging. */
export const API_KEY_REDACTED = "[redacted]";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);

const normalizeMode = (value: unknown): ProviderMode => (value === "external" ? "external" : "local");

const normalizeSelection = (value: unknown, fallback: ProviderSelection): ProviderSelection => {
  const record = isRecord(value) ? value : {};
  return { provider: asString(record.provider, fallback.provider), model: asString(record.model, fallback.model) };
};

const normalizeApiKeys = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" && raw.trim().length > 0) result[key] = raw;
  }
  return result;
};

/**
 * Coerce arbitrary loaded data.json content into a valid settings object.
 * Never throws: missing/corrupt/partial input falls back to deterministic defaults,
 * so a bad settings file can never block plugin startup.
 */
export function normalizeSettings(raw: unknown): TranscriptMemorySettings {
  const record = isRecord(raw) ? raw : {};
  return {
    schemaVersion: 1,
    mode: normalizeMode(record.mode),
    llm: normalizeSelection(record.llm, DEFAULT_SETTINGS.llm),
    embedding: normalizeSelection(record.embedding, DEFAULT_SETTINGS.embedding),
    apiKeys: normalizeApiKeys(record.apiKeys),
  };
}

/** Set (or clear, when the key is blank) the secret for a provider, returning a new settings object. */
export function setApiKey(settings: TranscriptMemorySettings, providerId: string, key: string): TranscriptMemorySettings {
  const apiKeys = { ...settings.apiKeys };
  const trimmed = key.trim();
  if (trimmed) apiKeys[providerId] = trimmed;
  else delete apiKeys[providerId];
  return { ...settings, apiKeys };
}

/** UI-safe status for a stored key. Never reveals any characters of the secret. */
export function redactApiKey(key: string | null | undefined): string {
  return key && key.trim().length > 0 ? "configured" : "not set";
}

/** Log-safe copy of settings: every secret value is replaced with the redaction marker. */
export function redactSettingsForLog(settings: TranscriptMemorySettings): TranscriptMemorySettings {
  const apiKeys: Record<string, string> = {};
  for (const key of Object.keys(settings.apiKeys)) apiKeys[key] = API_KEY_REDACTED;
  return { ...settings, apiKeys };
}

export interface SettingsHealthSummary {
  providerMode: ProviderMode;
  llmProvider: string;
  llmModel: string;
  embeddingProvider: string;
  embeddingModel: string;
  apiKeyConfigured: boolean;
}

/**
 * Non-secret summary of settings, safe to place on PluginHealth and render in the UI.
 * Deliberately contains NO API key material — only whether one is configured.
 */
export function settingsHealthSummary(settings: TranscriptMemorySettings): SettingsHealthSummary {
  return {
    providerMode: settings.mode,
    llmProvider: settings.llm.provider,
    llmModel: settings.llm.model,
    embeddingProvider: settings.embedding.provider,
    embeddingModel: settings.embedding.model,
    apiKeyConfigured: Object.values(settings.apiKeys).some((value) => value.trim().length > 0),
  };
}
