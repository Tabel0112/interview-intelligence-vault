import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { buildSetupSummary } from "../src/obsidian/setupSummary.js";
import { DEFAULT_SETTINGS, setApiKey, type TranscriptMemorySettings } from "../src/obsidian/settings.js";

const PLANTED_KEY = "sk-setup-summary-PLANTED-SECRET-1234567890";
const DB_PATH = "/vault/.obsidian/plugins/transcript-memory-vault/transcript-memory.sqlite";

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const externalSettings = (): TranscriptMemorySettings => setApiKey({
  schemaVersion: 1, mode: "external",
  llm: { provider: "openai", model: "gpt-4o-mini" },
  embedding: { provider: "openai", model: "text-embedding-3-small", dimensions: 1536 },
  apiKeys: {},
}, "openai", PLANTED_KEY);

describe("buildSetupSummary", () => {
  it("reports non-secret LLM + embedding config with an inferred settings path", () => {
    const summary = buildSetupSummary(db, externalSettings(), DB_PATH);
    expect(summary.llmConfigured).toBe(true);
    expect(summary.llmProvider).toBe("openai");
    expect(summary.llmModel).toBe("gpt-4o-mini");
    expect(summary.embeddingConfigured).toBe(true);
    expect(summary.embeddingProvider).toBe("openai");
    expect(summary.embeddingModel).toBe("text-embedding-3-small");
    expect(summary.embeddingDimensions).toBe(1536);
    expect(["ok", "setup_required", "reindex_required"]).toContain(summary.embeddingHealth);
    expect(summary.reindexNeeded).toBe(summary.embeddingHealth === "reindex_required");
    expect(summary.databasePath).toBe(DB_PATH);
    expect(summary.settingsPath).toBe("/vault/.obsidian/plugins/transcript-memory-vault/data.json");
  });

  it("NEVER includes API key material (no key field, no sk-, no apiKey)", () => {
    const serialized = JSON.stringify(buildSetupSummary(db, externalSettings(), DB_PATH));
    expect(serialized).not.toContain(PLANTED_KEY);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(serialized.toLowerCase()).not.toContain("apikey");
  });

  it("reports not-configured for default local settings (setup_required, no leaks)", () => {
    const summary = buildSetupSummary(db, { ...DEFAULT_SETTINGS }, DB_PATH);
    expect(summary.llmConfigured).toBe(false);
    expect(summary.llmProvider).toBeUndefined();
    expect(summary.embeddingConfigured).toBe(false);
    expect(summary.embeddingHealth).toBe("setup_required");
  });

  it("omits paths when no database path is available", () => {
    const summary = buildSetupSummary(db, externalSettings());
    expect(summary.databasePath).toBeUndefined();
    expect(summary.settingsPath).toBeUndefined();
  });
});
