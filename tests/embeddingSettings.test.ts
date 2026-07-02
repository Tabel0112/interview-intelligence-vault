import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS, redactSettingsForLog, setApiKey, settingsHealthSummary, type EmbeddingSelection, type TranscriptMemorySettings,
} from "../src/obsidian/settings.js";
import { externalEmbeddingConfigFromSettings } from "../src/obsidian/embeddingSettings.js";
import { ExternalEmbeddingProvider, resolveEmbeddingProvider } from "../src/retrieval/index.js";

const SECRET = "sk-embed-PLANTED-SECRET-9999";

const externalSettings = (overrides: Partial<EmbeddingSelection> = {}, key: string | null = SECRET): TranscriptMemorySettings => {
  let settings: TranscriptMemorySettings = {
    ...DEFAULT_SETTINGS,
    mode: "external",
    embedding: { provider: "openai", model: "text-embedding-3-small", dimensions: 1536, ...overrides },
  };
  if (key) settings = setApiKey(settings, settings.embedding.provider, key);
  return settings;
};

describe("externalEmbeddingConfigFromSettings adapter", () => {
  it("returns null in local mode (default)", () => {
    expect(externalEmbeddingConfigFromSettings(DEFAULT_SETTINGS)).toBeNull();
    expect(externalEmbeddingConfigFromSettings({ ...externalSettings(), mode: "local" })).toBeNull();
  });

  it("returns a complete config when fully configured", () => {
    const config = externalEmbeddingConfigFromSettings(externalSettings({ baseUrl: "https://api.test/v1", timeoutMs: 30000 }));
    expect(config).toEqual({
      provider: "openai", model: "text-embedding-3-small", dimensions: 1536, apiKey: SECRET,
      baseUrl: "https://api.test/v1", timeoutMs: 30000,
    });
  });

  it("omits optional baseUrl/timeoutMs when not configured", () => {
    expect(externalEmbeddingConfigFromSettings(externalSettings())).toEqual({
      provider: "openai", model: "text-embedding-3-small", dimensions: 1536, apiKey: SECRET,
    });
  });

  it("returns null when the embedding provider is local (not external)", () => {
    expect(externalEmbeddingConfigFromSettings(externalSettings({ provider: "deterministic-test" }))).toBeNull();
    expect(externalEmbeddingConfigFromSettings(externalSettings({ provider: "noop" }))).toBeNull();
  });

  it("returns null when the API key is missing or blank (missing-key fallback)", () => {
    expect(externalEmbeddingConfigFromSettings(externalSettings({}, null))).toBeNull();
  });

  it("returns null when dimensions are missing or invalid (dimensions fallback)", () => {
    expect(externalEmbeddingConfigFromSettings(externalSettings({ dimensions: undefined }))).toBeNull();
    expect(externalEmbeddingConfigFromSettings({ ...externalSettings(), embedding: { provider: "openai", model: "m", dimensions: 0 } })).toBeNull();
    expect(externalEmbeddingConfigFromSettings({ ...externalSettings(), embedding: { provider: "openai", model: "m", dimensions: 12.5 } })).toBeNull();
  });

  it("resolves to the external provider when configured, and token-hash otherwise (no network)", () => {
    const config = externalEmbeddingConfigFromSettings(externalSettings());
    const resolved = resolveEmbeddingProvider(undefined, { external: config! });
    expect(resolved.usedFallback).toBe(false);
    expect(resolved.provider).toBeInstanceOf(ExternalEmbeddingProvider); // constructed, not called — no network
    expect(resolved.provider.name).toBe("openai");
    expect(resolved.provider.dimensions).toBe(1536);

    // A null adapter result means local fallback.
    expect(externalEmbeddingConfigFromSettings(DEFAULT_SETTINGS)).toBeNull();
    expect(resolveEmbeddingProvider().provider.model).toBe("token-hash-v1");
  });

  it("configures the key but never leaks it through health or log views", () => {
    const settings = externalSettings();
    const config = externalEmbeddingConfigFromSettings(settings)!;
    expect(config.apiKey).toBe(SECRET); // the adapter intentionally configures the provider's key

    const summary = settingsHealthSummary(settings);
    expect(summary.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(summary)).not.toContain(SECRET);

    const logSafe = redactSettingsForLog(settings);
    expect(JSON.stringify(logSafe)).not.toContain(SECRET);
    expect(settings.apiKeys.openai).toBe(SECRET); // original untouched
  });
});
