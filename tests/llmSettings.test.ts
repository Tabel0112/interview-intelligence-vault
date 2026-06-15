import { describe, expect, it } from "vitest";
import {
  externalLlmConfigFromSettings, llmResolutionSummary, resolveLlmProviderFromSettings,
} from "../src/obsidian/llmSettings.js";
import { DEFAULT_SETTINGS, setApiKey, type TranscriptMemorySettings } from "../src/obsidian/settings.js";
import { ExternalLlmProvider, LocalDeterministicLlmProvider, type LlmTransport } from "../src/llm/index.js";

const SECRET = "sk-llm-settings-SECRET-1234567890";

// A transport that would FAIL the test if ever called — proves the adapter makes no network call.
const forbiddenTransport: LlmTransport = async () => {
  throw new Error("network must not be called from the adapter");
};

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

  it("returns null when not external, unsupported provider, missing model, or missing key", () => {
    expect(externalLlmConfigFromSettings(DEFAULT_SETTINGS)).toBeNull(); // mode local
    expect(externalLlmConfigFromSettings({ ...externalSettings(), mode: "local" })).toBeNull();
    expect(externalLlmConfigFromSettings(externalSettings({ provider: "anthropic" }))).toBeNull(); // unsupported
    expect(externalLlmConfigFromSettings(externalSettings({ model: "  " }))).toBeNull(); // blank model
    expect(externalLlmConfigFromSettings(externalSettings({}, false))).toBeNull(); // no key
  });
});

describe("resolveLlmProviderFromSettings", () => {
  it("defaults to the local deterministic provider (no network)", () => {
    const resolution = resolveLlmProviderFromSettings(DEFAULT_SETTINGS, { transport: forbiddenTransport });
    expect(resolution.provider).toBeInstanceOf(LocalDeterministicLlmProvider);
    expect(resolution.usedFallback).toBe(false);
  });

  it("resolves the external provider when fully configured, without calling the transport", () => {
    const resolution = resolveLlmProviderFromSettings(externalSettings(), { transport: forbiddenTransport });
    expect(resolution.provider).toBeInstanceOf(ExternalLlmProvider);
    expect(resolution.provider.id).toBe("openai");
    expect(resolution.provider.isLocal).toBe(false);
    expect(resolution.usedFallback).toBe(false);
  });

  it("falls back to local with a clear non-secret reason when the key is missing", () => {
    const resolution = resolveLlmProviderFromSettings(externalSettings({}, false));
    expect(resolution.provider).toBeInstanceOf(LocalDeterministicLlmProvider);
    expect(resolution.usedFallback).toBe(true);
    expect(resolution.reason).toContain("openai");
    expect(resolution.reason).not.toContain(SECRET);
  });

  it("falls back to local when the model is missing", () => {
    expect(resolveLlmProviderFromSettings(externalSettings({ model: "" })).usedFallback).toBe(true);
  });

  it("treats an unsupported or local provider as local (not external)", () => {
    expect(resolveLlmProviderFromSettings(externalSettings({ provider: "anthropic" })).usedFallback).toBe(false);
    expect(resolveLlmProviderFromSettings(externalSettings({ provider: "anthropic" })).provider).toBeInstanceOf(LocalDeterministicLlmProvider);
    expect(resolveLlmProviderFromSettings({ ...externalSettings(), mode: "local" }).provider).toBeInstanceOf(LocalDeterministicLlmProvider);
  });
});

describe("llmResolutionSummary", () => {
  it("is non-secret and contains no live provider object", () => {
    const summary = llmResolutionSummary(resolveLlmProviderFromSettings(externalSettings()));
    expect(summary).toEqual({ requestedId: "openai", providerId: "openai", model: "gpt-4o-mini", isLocal: false, usedFallback: false, reason: undefined });
    expect(JSON.stringify(summary)).not.toContain(SECRET);
    expect((summary as unknown as Record<string, unknown>).provider).toBeUndefined();
  });

  it("summarizes a fallback with a non-secret reason", () => {
    const summary = llmResolutionSummary(resolveLlmProviderFromSettings(externalSettings({}, false)));
    expect(summary.usedFallback).toBe(true);
    expect(summary.isLocal).toBe(true);
    expect(JSON.stringify(summary)).not.toContain(SECRET);
  });
});
