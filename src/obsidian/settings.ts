// Provider / API-key settings foundation.
//
// Stored in Obsidian's plugin data.json (NOT SQLite) so that:
//  - settings remain editable even when the database is unavailable, and
//  - user config / secrets never enter the authoritative transcript trust store.
//
// This module is intentionally PURE (no Obsidian, network, Date, or randomness) so it is
// fully unit-testable and deterministic. Nothing here makes a network call. These settings DO
// drive live runtime behavior: the live app is external-provider-required. Ask AI — in Obsidian
// AND via Claude Desktop / MCP — needs BOTH a configured external LLM (grounded memory extraction
// + answer synthesis) and a configured external embedding provider (retrieval, MCP `ask_vault`,
// MCP evidence search). It fails closed to a setup-required state when either is missing; there is
// no deterministic/token-hash product fallback (that path is a dev/test-only seam).

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
  /**
   * "external" once an external LLM provider is selected (Ask AI enabled); "local" only before any
   * external provider is chosen. There is no offline/deterministic PRODUCT mode — deterministic/token-hash
   * providers are dev/test-only seams and never enable Ask AI/MCP.
   */
  mode: ProviderMode;
  llm: LlmSelection;
  embedding: EmbeddingSelection;
  /** providerId -> secret. Kept isolated so it can later move to a keychain in one place. */
  apiKeys: Record<string, string>;
}

// "anthropic" is intentionally omitted: the current external LLM provider is OpenAI-compatible only.
// "openai" is listed first as the recommended production choice; "none" disables AI features.
export const LLM_PROVIDER_OPTIONS = ["openai", "none"] as const;
// "openai" (external, OpenAI-compatible) is the recommended PRODUCTION embedding provider and is listed
// first. "deterministic-test"/"noop" are dev/test-only seams that do NOT enable Ask AI/MCP; they are kept
// available for local inspection but must never be presented as the normal production default.
export const EMBEDDING_PROVIDER_OPTIONS = ["openai", "deterministic-test", "noop"] as const;

/** Human-readable dropdown labels that make the recommended vs dev/test distinction obvious. */
export const LLM_PROVIDER_LABELS: Record<string, string> = {
  openai: "openai — recommended",
  none: "none — AI features disabled",
};
export const EMBEDDING_PROVIDER_LABELS: Record<string, string> = {
  openai: "openai — recommended (enables Ask AI retrieval + MCP)",
  "deterministic-test": "deterministic-test — dev/test only (does NOT enable Ask AI)",
  noop: "noop — dev/test only (disables retrieval)",
};

/**
 * Recommended production defaults for a normal OpenAI setup. Used by the "Use recommended defaults" Settings
 * actions and as the fresh-install embedding selection. These are provider/model/dimensions only — NEVER an
 * API key. Autofilling them still leaves the setup fail-closed until the user adds a key (and, for the LLM,
 * selects it), so nothing here weakens the setup-required gates.
 */
export const RECOMMENDED_LLM_DEFAULTS: { provider: string; model: string } = { provider: "openai", model: "gpt-4o-mini" };
export const RECOMMENDED_EMBEDDING_DEFAULTS: { provider: string; model: string; dimensions: number } = {
  provider: "openai",
  model: "text-embedding-3-small",
  dimensions: 1536,
};

/** True for the local dev/test embedding seams (deterministic-test/noop) that do NOT enable Ask AI. */
export const isDevTestEmbeddingProvider = (providerId: string): boolean => !isExternalEmbeddingProvider(providerId);

/**
 * Fill the recommended LLM provider + model (enabling external mode), WITHOUT touching API keys.
 * Mirrors selecting the external LLM provider in the dropdown. Fail-closed is preserved: the result is not
 * `isLlmConfigured` until the user also adds an API key.
 */
export function applyRecommendedLlmDefaults(settings: TranscriptMemorySettings): TranscriptMemorySettings {
  return {
    ...settings,
    mode: "external",
    llm: { ...settings.llm, provider: RECOMMENDED_LLM_DEFAULTS.provider, model: RECOMMENDED_LLM_DEFAULTS.model },
  };
}

/**
 * Fill the recommended embedding provider + model + dimensions, WITHOUT touching API keys or mode.
 * Mirrors selecting the external embedding provider in the dropdown. Fail-closed is preserved: the result is
 * not `isEmbeddingConfigured` until the user also adds an API key (and an LLM is selected so mode is external).
 */
export function applyRecommendedEmbeddingDefaults(settings: TranscriptMemorySettings): TranscriptMemorySettings {
  return {
    ...settings,
    embedding: {
      ...settings.embedding,
      provider: RECOMMENDED_EMBEDDING_DEFAULTS.provider,
      model: RECOMMENDED_EMBEDDING_DEFAULTS.model,
      dimensions: RECOMMENDED_EMBEDDING_DEFAULTS.dimensions,
    },
  };
}

/** LLM provider ids that require an external (network) call and an API key. */
export const EXTERNAL_LLM_PROVIDERS = ["openai"] as const;
export const isExternalLlmProvider = (providerId: string): boolean =>
  (EXTERNAL_LLM_PROVIDERS as readonly string[]).includes(providerId);

/** Embedding provider ids that require an external (network) call and an API key. */
export const EXTERNAL_EMBEDDING_PROVIDERS = ["openai"] as const;
export const isExternalEmbeddingProvider = (providerId: string): boolean =>
  (EXTERNAL_EMBEDDING_PROVIDERS as readonly string[]).includes(providerId);

/**
 * The live app is LLM-required. An LLM is "configured" only when an external (OpenAI-compatible)
 * provider is selected with a non-blank model and a non-blank API key. There is no local/deterministic
 * product mode — when this is false, the UI shows setup-required and generation is disabled.
 */
export function isLlmConfigured(settings: TranscriptMemorySettings): boolean {
  return settings.mode === "external"
    && isExternalLlmProvider(settings.llm.provider)
    && settings.llm.model.trim().length > 0
    && (settings.apiKeys[settings.llm.provider]?.trim().length ?? 0) > 0;
}

/**
 * The live app is ALSO embedding-required for Ask AI retrieval. Embeddings are "configured" only when an
 * external (OpenAI-compatible) embedding provider is selected with a non-blank API key and positive integer
 * dimensions. The deterministic-test/token-hash provider is a dev/test seam and is NOT a configured product
 * embedding provider — when this is false, Ask AI (Obsidian + MCP) is gated as embedding-setup-required.
 * (Mirrors the config checks in `externalEmbeddingConfigFromSettings`; kept pure so onboarding copy can use it.)
 */
export function isEmbeddingConfigured(settings: TranscriptMemorySettings): boolean {
  if (settings.mode !== "external") return false;
  if (!isExternalEmbeddingProvider(settings.embedding.provider)) return false;
  if ((settings.apiKeys[settings.embedding.provider]?.trim().length ?? 0) === 0) return false;
  const dims = settings.embedding.dimensions;
  return typeof dims === "number" && Number.isInteger(dims) && dims > 0;
}

/** Non-secret onboarding summary: BOTH an LLM and an external embedding provider are required for Ask AI. */
export interface SetupRequirement {
  llmConfigured: boolean;
  embeddingConfigured: boolean;
  complete: boolean;
  message: string;
}

/**
 * Plain-language setup status for the Settings tab / onboarding. States that Ask AI (in Obsidian and via
 * Claude Desktop / MCP) requires BOTH an LLM (extraction + synthesis) AND an external embedding provider
 * (retrieval + MCP ask_vault + evidence search), and that an LLM-only setup is incomplete. Never contains
 * any secret — only configured/not-configured facts.
 */
export function setupRequirement(settings: TranscriptMemorySettings): SetupRequirement {
  const llmConfigured = isLlmConfigured(settings);
  const embeddingConfigured = isEmbeddingConfigured(settings);
  const complete = llmConfigured && embeddingConfigured;
  const message = complete
    ? "Setup complete. Ask AI is enabled in Obsidian and via Claude Desktop (MCP)."
    : `Ask AI requires BOTH an LLM provider (grounded memory extraction + answer synthesis) and an external embedding provider (Ask AI retrieval, MCP ask_vault, and MCP evidence search). ${llmConfigured ? "LLM is configured." : "LLM is NOT configured."} ${embeddingConfigured ? "Embeddings are configured." : "Embeddings are NOT configured."} An LLM-only setup is incomplete — Ask AI and MCP stay disabled until both are configured below.`;
  return { llmConfigured, embeddingConfigured, complete, message };
}

// Fresh-install defaults. The embedding selection is the recommended EXTERNAL provider (openai /
// text-embedding-3-small / 1536), NOT a deterministic/token-hash dev seam — so normal user settings never
// default to deterministic. It is KEYLESS, so it stays fully fail-closed: `isEmbeddingConfigured` is false
// (no key), `productionEmbeddingProvider` returns undefined (no token-hash is ever handed to production), and
// Ask AI/MCP are setup-required until the user adds an embedding API key and runs "Rebuild Embedding Index".
// The local keyword index still resolves to token-hash for non-Ask-AI search, flagged as an "awaiting key"
// fallback (see resolveEmbeddingProviderFromSettings) rather than presented as a configured provider.
export const DEFAULT_SETTINGS: TranscriptMemorySettings = {
  schemaVersion: 1,
  mode: "local",
  llm: { provider: "none", model: "" },
  embedding: { ...RECOMMENDED_EMBEDDING_DEFAULTS },
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

const normalizeEmbeddingSelection = (value: unknown, fallback: EmbeddingSelection): EmbeddingSelection => {
  const record = isRecord(value) ? value : {};
  const result: EmbeddingSelection = {
    provider: asString(record.provider, fallback.provider),
    model: asString(record.model, fallback.model),
  };
  // Use provided dimensions when valid. When the whole embedding value was absent/corrupt (not an object),
  // inherit the fallback's dimensions so `normalizeSettings(<missing>)` reproduces DEFAULT_SETTINGS exactly.
  // A PARTIAL object that merely omits dimensions is left WITHOUT dimensions (so it stays not-configured
  // rather than inheriting a possibly-wrong vector length for the user's model).
  const dimensions = positiveInt(record.dimensions) ?? (isRecord(value) ? undefined : fallback.dimensions);
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
  /** True when a usable external LLM is configured (provider + model + key). Generation requires this. */
  llmReady: boolean;
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
    llmReady: isLlmConfigured(settings),
  };
}
