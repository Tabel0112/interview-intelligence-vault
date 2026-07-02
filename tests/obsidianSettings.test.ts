import { describe, expect, it } from "vitest";
import {
  API_KEY_REDACTED, applyRecommendedEmbeddingDefaults, applyRecommendedLlmDefaults, DEFAULT_SETTINGS,
  EMBEDDING_PROVIDER_LABELS, EMBEDDING_PROVIDER_OPTIONS, isDevTestEmbeddingProvider, isEmbeddingConfigured,
  isLlmConfigured, normalizeSettings, redactApiKey, RECOMMENDED_EMBEDDING_DEFAULTS, RECOMMENDED_LLM_DEFAULTS,
  redactSettingsForLog, setApiKey, settingsHealthSummary, setupRequirement, type TranscriptMemorySettings,
} from "../src/obsidian/settings.js";
import { initialPluginHealth } from "../src/obsidian/startup.js";

const SECRET = "sk-live-SUPERSECRET-abcdef 1234567890";

describe("transcript memory settings foundation", () => {
  it("defaults to the recommended KEYLESS external embedding provider (not deterministic/token-hash) and stays fail-closed", () => {
    expect(DEFAULT_SETTINGS.mode).toBe("local");
    expect(DEFAULT_SETTINGS.llm.provider).toBe("none");
    // Normal fresh settings default to the recommended external provider, NOT a deterministic/token-hash seam.
    expect(DEFAULT_SETTINGS.embedding).toEqual({ provider: "openai", model: "text-embedding-3-small", dimensions: 1536 });
    expect(DEFAULT_SETTINGS.embedding.provider).not.toBe("deterministic-test");
    expect(DEFAULT_SETTINGS.embedding.model).not.toBe("token-hash-v1");
    expect(isDevTestEmbeddingProvider(DEFAULT_SETTINGS.embedding.provider)).toBe(false);
    // ...but it is KEYLESS, so it is still fully fail-closed: neither LLM nor embeddings are configured.
    expect(DEFAULT_SETTINGS.apiKeys).toEqual({});
    expect(isLlmConfigured(DEFAULT_SETTINGS)).toBe(false);
    expect(isEmbeddingConfigured(DEFAULT_SETTINGS)).toBe(false);
  });

  it("setupRequirement(DEFAULT_SETTINGS) is incomplete and states embeddings are required (not optional)", () => {
    const req = setupRequirement(DEFAULT_SETTINGS);
    expect(req.complete).toBe(false);
    expect(req.embeddingConfigured).toBe(false);
    expect(req.message).toMatch(/embedding provider/i);
    expect(req.message).toMatch(/Embeddings are NOT configured/i);
    expect(req.message.toLowerCase()).not.toContain("optional");
  });

  it("a partial embedding config that omits dimensions does NOT inherit the default dimensions (stays not-configured)", () => {
    // Guard against the fresh default's dimensions being silently injected onto a user's partial config.
    const partial = normalizeSettings({ mode: "external", embedding: { provider: "openai", model: "custom" }, apiKeys: { openai: SECRET } });
    expect(partial.embedding.dimensions).toBeUndefined();
    expect(isEmbeddingConfigured(partial)).toBe(false); // missing dimensions -> not configured (fail-closed)
    // Only a fully-absent/corrupt embedding value inherits the full default (incl. dimensions).
    expect(normalizeSettings({}).embedding).toEqual(DEFAULT_SETTINGS.embedding);
    expect(normalizeSettings({ embedding: 42 }).embedding).toEqual(DEFAULT_SETTINGS.embedding);
  });

  it("normalizes missing, null, and corrupt input to defaults without throwing", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("garbage")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([1, 2, 3])).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it("fills defaults for partial/typed-wrong input, drops unknown keys and blank api keys", () => {
    const normalized = normalizeSettings({
      mode: "external",
      llm: { provider: "anthropic" }, // model missing
      embedding: 42, // wrong type
      apiKeys: { anthropic: "key-1", openai: "   ", broken: 5 },
      unknownField: "ignored",
    });
    expect(normalized.mode).toBe("external");
    expect(normalized.llm).toEqual({ provider: "anthropic", model: "" });
    expect(normalized.embedding).toEqual(DEFAULT_SETTINGS.embedding);
    expect(normalized.apiKeys).toEqual({ anthropic: "key-1" }); // blank + non-string dropped
    expect((normalized as unknown as Record<string, unknown>).unknownField).toBeUndefined();
  });

  it("coerces an unknown mode value to local", () => {
    expect(normalizeSettings({ mode: "totally-bogus" }).mode).toBe("local");
  });

  it("normalizes external embedding fields and drops invalid dimensions/baseUrl/timeoutMs", () => {
    const valid = normalizeSettings({
      mode: "external",
      embedding: { provider: "openai", model: "text-embedding-3-small", dimensions: 1536, baseUrl: "https://api.test/v1", timeoutMs: 30000 },
    });
    expect(valid.embedding).toEqual({ provider: "openai", model: "text-embedding-3-small", dimensions: 1536, baseUrl: "https://api.test/v1", timeoutMs: 30000 });

    const invalid = normalizeSettings({
      embedding: { provider: "openai", model: "m", dimensions: -5, baseUrl: "   ", timeoutMs: "abc" },
    });
    expect(invalid.embedding).toEqual({ provider: "openai", model: "m" }); // invalid optional fields dropped
  });

  it("normalizes external LLM fields and drops invalid baseUrl/timeoutMs", () => {
    const valid = normalizeSettings({
      mode: "external",
      llm: { provider: "openai", model: "gpt-4o-mini", baseUrl: "https://api.test/v1", timeoutMs: 30000 },
    });
    expect(valid.llm).toEqual({ provider: "openai", model: "gpt-4o-mini", baseUrl: "https://api.test/v1", timeoutMs: 30000 });

    const invalid = normalizeSettings({ llm: { provider: "openai", model: "m", baseUrl: "   ", timeoutMs: -1 } });
    expect(invalid.llm).toEqual({ provider: "openai", model: "m" }); // invalid optional fields dropped
  });

  it("round-trips a fully-populated external embedding selection", () => {
    const settings: TranscriptMemorySettings = {
      schemaVersion: 1,
      mode: "external",
      llm: { provider: "none", model: "" },
      embedding: { provider: "openai", model: "text-embedding-3-small", dimensions: 1536, baseUrl: "https://api.test/v1", timeoutMs: 30000 },
      apiKeys: { openai: SECRET },
    };
    expect(normalizeSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  });

  it("stores and redacts an embedding-provider API key keyed by provider id", () => {
    const settings = setApiKey({ ...DEFAULT_SETTINGS, mode: "external", embedding: { provider: "openai", model: "m", dimensions: 8 } }, "openai", SECRET);
    expect(settings.apiKeys.openai).toBe(SECRET);
    expect(redactApiKey(settings.apiKeys.openai)).toBe("configured");
    expect(settingsHealthSummary(settings).apiKeyConfigured).toBe(true);
    expect(JSON.stringify(settingsHealthSummary(settings))).not.toContain(SECRET);
    expect(JSON.stringify(redactSettingsForLog(settings))).not.toContain(SECRET);
  });

  it("round-trips a fully-populated settings object", () => {
    const settings: TranscriptMemorySettings = {
      schemaVersion: 1,
      mode: "external",
      llm: { provider: "anthropic", model: "claude-x" },
      embedding: { provider: "openai", model: "text-embed" },
      apiKeys: { anthropic: SECRET, openai: "another-key" },
    };
    expect(normalizeSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  });

  it("sets and clears api keys immutably", () => {
    const withKey = setApiKey(DEFAULT_SETTINGS, "anthropic", `  ${SECRET}  `);
    expect(withKey.apiKeys.anthropic).toBe(SECRET); // trimmed
    expect(DEFAULT_SETTINGS.apiKeys).toEqual({}); // original untouched
    const cleared = setApiKey(withKey, "anthropic", "   ");
    expect(cleared.apiKeys.anthropic).toBeUndefined();
  });

  it("redactApiKey never reveals any characters of the secret", () => {
    expect(redactApiKey(null)).toBe("not set");
    expect(redactApiKey("")).toBe("not set");
    expect(redactApiKey("   ")).toBe("not set");
    const status = redactApiKey(SECRET);
    expect(status).toBe("configured");
    expect(status).not.toContain(SECRET);
    expect(status).not.toContain(SECRET.slice(-4));
  });

  it("redactSettingsForLog removes every secret value", () => {
    const settings = setApiKey(setApiKey(DEFAULT_SETTINGS, "anthropic", SECRET), "openai", "second-secret");
    const redacted = redactSettingsForLog(settings);
    expect(redacted.apiKeys.anthropic).toBe(API_KEY_REDACTED);
    expect(redacted.apiKeys.openai).toBe(API_KEY_REDACTED);
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("second-secret");
    expect(settings.apiKeys.anthropic).toBe(SECRET); // original unchanged
  });

  it("settingsHealthSummary exposes a boolean only, never the key material", () => {
    const settings = setApiKey({ ...DEFAULT_SETTINGS, mode: "external", llm: { provider: "anthropic", model: "claude-x" } }, "anthropic", SECRET);
    const summary = settingsHealthSummary(settings);
    expect(summary).toEqual({
      providerMode: "external",
      llmProvider: "anthropic",
      llmModel: "claude-x",
      embeddingProvider: "openai", // fresh-install default is the recommended external provider (keyless -> not configured)
      embeddingModel: "text-embedding-3-small",
      apiKeyConfigured: true,
      llmReady: false, // "anthropic" is not an OpenAI-compatible external provider -> not LLM-ready
    });
    expect(JSON.stringify(summary)).not.toContain(SECRET);
  });

  it("settingsHealthSummary reports llmReady true only for a fully-configured OpenAI-compatible LLM", () => {
    const ready = setApiKey({ ...DEFAULT_SETTINGS, mode: "external", llm: { provider: "openai", model: "gpt-4o-mini" } }, "openai", SECRET);
    expect(settingsHealthSummary(ready).llmReady).toBe(true);
    expect(settingsHealthSummary(DEFAULT_SETTINGS).llmReady).toBe(false);
  });

  it("reports apiKeyConfigured false when no non-empty keys exist", () => {
    expect(settingsHealthSummary(DEFAULT_SETTINGS).apiKeyConfigured).toBe(false);
  });

  it("initialPluginHealth carries the local-default summary and no key", () => {
    const health = initialPluginHealth();
    expect(health.providerMode).toBe("local");
    expect(health.llmProvider).toBe("none");
    expect(health.embeddingProvider).toBe("openai"); // recommended external default, keyless -> not configured
    expect(health.apiKeyConfigured).toBe(false);
    // The health object that reaches the frontend dashboard must never carry a secret.
    expect(JSON.stringify(health)).not.toContain(SECRET);
  });
});

describe("Ask AI setup requirement — BOTH an LLM and an external embedding provider are required", () => {
  const llmOnly = (): TranscriptMemorySettings => setApiKey(
    { schemaVersion: 1, mode: "external", llm: { provider: "openai", model: "gpt-4o-mini" }, embedding: { provider: "deterministic-test", model: "token-hash-v1" }, apiKeys: {} },
    "openai", SECRET);
  const bothConfigured = (): TranscriptMemorySettings => setApiKey(
    { schemaVersion: 1, mode: "external", llm: { provider: "openai", model: "gpt-4o-mini" }, embedding: { provider: "openai", model: "text-embedding-3-small", dimensions: 1536 }, apiKeys: {} },
    "openai", SECRET);

  it("isEmbeddingConfigured requires an external provider + key + positive integer dimensions (token-hash is NOT configured)", () => {
    expect(isEmbeddingConfigured(DEFAULT_SETTINGS)).toBe(false); // recommended default is keyless (mode local, no key) -> not configured
    expect(isEmbeddingConfigured(llmOnly())).toBe(false); // LLM configured but embeddings on the deterministic seam (not an external key)
    // external provider + key but missing/invalid dimensions -> still not configured
    const noDims = setApiKey({ schemaVersion: 1, mode: "external", llm: { provider: "none", model: "" }, embedding: { provider: "openai", model: "m" }, apiKeys: {} }, "openai", SECRET);
    expect(isEmbeddingConfigured(noDims)).toBe(false);
    // external provider + dims but no key -> not configured
    expect(isEmbeddingConfigured({ schemaVersion: 1, mode: "external", llm: { provider: "none", model: "" }, embedding: { provider: "openai", model: "m", dimensions: 8 }, apiKeys: {} })).toBe(false);
    expect(isEmbeddingConfigured(bothConfigured())).toBe(true);
  });

  it("setupRequirement treats an LLM-only setup as INCOMPLETE and says embeddings are required (not optional/future)", () => {
    const req = setupRequirement(llmOnly());
    expect(req.llmConfigured).toBe(true);
    expect(req.embeddingConfigured).toBe(false);
    expect(req.complete).toBe(false); // LLM-only is incomplete
    expect(req.message).toMatch(/requires BOTH/i);
    expect(req.message).toMatch(/embedding provider/i);
    expect(req.message).toMatch(/Embeddings are NOT configured/i);
    expect(req.message).toMatch(/LLM-only setup is incomplete/i);
    // The copy never implies embeddings are merely future/optional.
    expect(req.message.toLowerCase()).not.toContain("optional");
    expect(req.message.toLowerCase()).not.toContain("for future");
  });

  it("setupRequirement is complete only when BOTH providers are configured, and carries no secret", () => {
    const incompleteEmbeddingsOnly = { ...bothConfigured(), llm: { provider: "none" as const, model: "" } };
    expect(isLlmConfigured(incompleteEmbeddingsOnly)).toBe(false);
    expect(setupRequirement(incompleteEmbeddingsOnly).complete).toBe(false); // embeddings-only is also incomplete

    const req = setupRequirement(bothConfigured());
    expect(req).toMatchObject({ llmConfigured: true, embeddingConfigured: true, complete: true });
    expect(req.message).toMatch(/Setup complete/i);
    expect(JSON.stringify(req)).not.toContain(SECRET); // onboarding copy never leaks a key
  });
});

describe("recommended provider defaults + dev/test seams are never the user-facing default", () => {
  it("recommended defaults are a normal OpenAI production setup (not deterministic/token-hash)", () => {
    expect(RECOMMENDED_LLM_DEFAULTS).toEqual({ provider: "openai", model: "gpt-4o-mini" });
    expect(RECOMMENDED_EMBEDDING_DEFAULTS).toEqual({ provider: "openai", model: "text-embedding-3-small", dimensions: 1536 });
    expect(isDevTestEmbeddingProvider(RECOMMENDED_EMBEDDING_DEFAULTS.provider)).toBe(false);
  });

  it("openai is the FIRST (recommended) embedding option; deterministic/noop remain available but labeled dev/test", () => {
    expect(EMBEDDING_PROVIDER_OPTIONS[0]).toBe("openai"); // normal/default choice comes first
    expect(EMBEDDING_PROVIDER_OPTIONS).toContain("deterministic-test"); // still available as a seam
    expect(EMBEDDING_PROVIDER_OPTIONS).toContain("noop");
    // Labels make the distinction obvious and never imply token-hash is the normal model.
    expect(EMBEDDING_PROVIDER_LABELS.openai.toLowerCase()).toContain("recommended");
    expect(EMBEDDING_PROVIDER_LABELS["deterministic-test"].toLowerCase()).toContain("dev/test");
    expect(EMBEDDING_PROVIDER_LABELS["deterministic-test"]).toMatch(/does NOT enable Ask AI/i);
    expect(EMBEDDING_PROVIDER_LABELS.noop.toLowerCase()).toContain("dev/test");
    for (const label of Object.values(EMBEDDING_PROVIDER_LABELS)) expect(label).not.toContain("token-hash-v1");
  });

  it("applyRecommendedLlmDefaults fills provider/model + external mode, and never adds an API key", () => {
    const next = applyRecommendedLlmDefaults(DEFAULT_SETTINGS);
    expect(next.mode).toBe("external");
    expect(next.llm.provider).toBe("openai");
    expect(next.llm.model).toBe("gpt-4o-mini");
    expect(next.apiKeys).toEqual({}); // autofill NEVER touches secrets
    expect(isLlmConfigured(next)).toBe(false); // still fail-closed until a key is added
    expect(isLlmConfigured(setApiKey(next, "openai", SECRET))).toBe(true); // key completes it
    expect(DEFAULT_SETTINGS.llm.provider).toBe("none"); // input not mutated
  });

  it("applyRecommendedEmbeddingDefaults fills provider/model/dimensions, never adds a key, and does not flip mode", () => {
    const base: TranscriptMemorySettings = { schemaVersion: 1, mode: "local", llm: { provider: "none", model: "" }, embedding: { provider: "deterministic-test", model: "token-hash-v1" }, apiKeys: {} };
    const next = applyRecommendedEmbeddingDefaults(base);
    expect(next.embedding).toEqual({ provider: "openai", model: "text-embedding-3-small", dimensions: 1536 });
    expect(next.mode).toBe("local"); // embedding autofill does not change mode
    expect(next.apiKeys).toEqual({}); // autofill NEVER touches secrets
    expect(isEmbeddingConfigured(next)).toBe(false); // still fail-closed (no key, mode local)
    // With an LLM selected (external) + an embedding key, the autofilled embedding is now configured.
    const configured = setApiKey({ ...next, mode: "external" }, "openai", SECRET);
    expect(isEmbeddingConfigured(configured)).toBe(true);
    expect(base.embedding.provider).toBe("deterministic-test"); // input not mutated
  });

  it("autofilling recommended embedding defaults still requires a reindex (index built under a new space)", () => {
    // Autofill changes provider/model/dimensions, which defines a new embedding space; the stored key is
    // required and the index must be (re)built. Autofill alone never marks the vault as ready-to-answer.
    const next = applyRecommendedEmbeddingDefaults(DEFAULT_SETTINGS);
    expect(isEmbeddingConfigured(next)).toBe(false);
    expect(setupRequirement(next).embeddingConfigured).toBe(false);
  });
});
