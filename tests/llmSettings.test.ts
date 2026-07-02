import { describe, expect, it } from "vitest";
import { externalLlmConfigFromSettings } from "../src/obsidian/llmSettings.js";
import { DEFAULT_SETTINGS, isLlmConfigured, setApiKey, type TranscriptMemorySettings } from "../src/obsidian/settings.js";

const SECRET = "sk-llm-settings-SECRET-1234567890";

const externalSettings = (overrides: Partial<TranscriptMemorySettings["llm"]> = {}, withKey = true): TranscriptMemorySettings => {
  const base: TranscriptMemorySettings = {
    schemaVersion: 1,
    mode: "external",
    llm: { provider: "openai", model: "gpt-4o-mini", ...overrides },
    embedding: { provider: "deterministic-test", model: "token-hash-v1" },
    apiKeys: {},
  };
  return withKey ? setApiKey(base, "openai", SECRET) : base;
};

describe("externalLlmConfigFromSettings", () => {
  it("returns a config only when fully configured", () => {
    const config = externalLlmConfigFromSettings(externalSettings({ baseUrl: "https://api.test/v1", timeoutMs: 5000 }));
    expect(config).toEqual({ id: "openai", model: "gpt-4o-mini", apiKey: SECRET, baseUrl: "https://api.test/v1", timeoutMs: 5000 });
  });

  it("returns null when not external, unsupported provider, missing model, or missing key (never a local fallback)", () => {
    expect(externalLlmConfigFromSettings(DEFAULT_SETTINGS)).toBeNull(); // mode local / unconfigured
    expect(externalLlmConfigFromSettings({ ...externalSettings(), mode: "local" })).toBeNull();
    expect(externalLlmConfigFromSettings(externalSettings({ provider: "anthropic" }))).toBeNull(); // unsupported
    expect(externalLlmConfigFromSettings(externalSettings({ model: "  " }))).toBeNull(); // blank model
    expect(externalLlmConfigFromSettings(externalSettings({}, false))).toBeNull(); // no key
  });
});

describe("isLlmConfigured (live-app readiness)", () => {
  it("is false for the default (unconfigured) settings", () => {
    expect(isLlmConfigured(DEFAULT_SETTINGS)).toBe(false);
  });

  it("is true only when an external provider, model, and API key are all set", () => {
    expect(isLlmConfigured(externalSettings())).toBe(true);
    expect(isLlmConfigured(externalSettings({}, false))).toBe(false); // missing key
    expect(isLlmConfigured(externalSettings({ model: "" }))).toBe(false); // missing model
    expect(isLlmConfigured({ ...externalSettings(), mode: "local" })).toBe(false); // not external
    expect(isLlmConfigured(externalSettings({ provider: "none" }))).toBe(false); // not an external provider
  });
});
