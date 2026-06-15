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

/** LLM selection plus optional external-provider configuration (used only in external mode). */
export interface LlmSelection extends ProviderSelection {
  baseUrl?: string;
  timeoutMs?: number;
}

/** Embedding selection plus optional external-provider configuration (used only in external mode). */
export interface EmbeddingSelection extends ProviderSelection {
  dimensions?: number;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface TranscriptMemorySettings {
  schemaVersion: 1;
  /** "local" = fully offline deterministic mode (default). */
  mode: ProviderMode;
  llm: LlmSelection;
  embedding: EmbeddingSelection;
  /** providerId -> secret. Kept isolated so it can later move to a keychain in one place. */
  apiKeys: Record<string, string>;
}

// "anthropic" is intentionally omitted: the current external LLM provider is OpenAI-compatible only.
export const LLM_PROVIDER_OPTIONS = ["none", "openai"] as const;
// Only providers the external embedding adapter actually supports (OpenAI-compatible) are offered.
export const EMBEDDING_PROVIDER_OPTIONS = ["deterministic-test", "noop", "openai"] as const;

/** LLM provider ids that require an external (network) call and an API key. */
export const EXTERNAL_LLM_PROVIDERS = ["openai"] as const;
export const isExternalLlmProvider = (providerId: string): boolean =>
  (EXTERNAL_LLM_PROVIDERS as readonly string[]).includes(providerId);

/** Embedding provider ids that require an external (network) call and an API key. */
export const EXTERNAL_EMBEDDING_PROVIDERS = ["openai"] as const;
export const isExternalEmbeddingProvider = (providerId: string): boolean =>
  (EXTERNAL_EMBEDDING_PROVIDERS as readonly string[]).includes(providerId);

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

const positiveInt = (value: unknown): number | undefined => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
};
const positiveNumber = (value: unknown): number | undefined => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const normalizeBaseUrl = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const normalizeLlmSelection = (value: unknown, fallback: ProviderSelection): LlmSelection => {
  const record = isRecord(value) ? value : {};
  const result: LlmSelection = {
    provider: asString(record.provider, fallback.provider),
    model: asString(record.model, fallback.model),
  };
  const baseUrl = normalizeBaseUrl(record.baseUrl);
  if (baseUrl !== undefined) result.baseUrl = baseUrl;
  const timeoutMs = positiveNumber(record.timeoutMs);
  if (timeoutMs !== undefined) result.timeoutMs = timeoutMs;
  return result;
};

const normalizeEmbeddingSelection = (value: unknown, fallback: ProviderSelection): EmbeddingSelection => {
  const record = isRecord(value) ? value : {};
  const result: EmbeddingSelection = {
    provider: asString(record.provider, fallback.provider),
    model: asString(record.model, fallback.model),
  };
  const dimensions = positiveInt(record.dimensions);
  if (dimensions !== undefined) result.dimensions = dimensions;
  const baseUrl = normalizeBaseUrl(record.baseUrl);
  if (baseUrl !== undefined) result.baseUrl = baseUrl;
  const timeoutMs = positiveNumber(record.timeoutMs);
  if (timeoutMs !== undefined) result.timeoutMs = timeoutMs;
  return result;
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
    llm: normalizeLlmSelection(record.llm, DEFAULT_SETTINGS.llm),
    embedding: normalizeEmbeddingSelection(record.embedding, DEFAULT_SETTINGS.embedding),
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
