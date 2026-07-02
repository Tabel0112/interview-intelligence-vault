import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The standalone MCP path must stay headless: importing the obsidian runtime package would throw here.
vi.mock("obsidian", () => { throw new Error("the headless MCP service must not import the obsidian runtime package"); });

import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { rebuildRetrievalIndex, type EmbeddingProvider } from "../src/retrieval/index.js";
import { createLlmAskAILanguageModel, createLlmAskAIAnalysisModel, type SynthesisInfo } from "../src/ask-ai/index.js";
import { ExternalLlmProvider, type LlmTransport } from "../src/llm/index.js";
import { createSqliteFrontendApi, type FrontendApi } from "../src/frontend/index.js";
import { createVaultTools } from "../src/mcp/tools.js";
import { loadMcpConfig } from "../src/mcp/config.js";
import { askAiEmbeddingHealth, productionEmbeddingProvider } from "../src/obsidian/embeddingSettings.js";
import { DEFAULT_SETTINGS, type TranscriptMemorySettings } from "../src/obsidian/settings.js";

const RAW = "Alex: We decided to use SQLite as the source of truth for the vault.";
const SECRET = "sk-mcp-embed-PLANTED-SECRET-1234567890";
const LLM_CLAIM = "SQLite is the source of truth for the vault.";
const now = () => new Date("2026-06-12T12:00:00.000Z");
const info: SynthesisInfo = { mode: "external_llm", provider: "openai", model: "gpt-x", usedFallback: false };

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const count = (sql: string) => (db.prepare(`SELECT COUNT(*) c FROM ${sql}`).get() as { c: number }).c;

// Grounded synthesis transport (offline): cite the selected pointerId + an exact verbatim quote.
const lastUserMessage = (body: string): string => {
  const messages = (JSON.parse(body) as { messages: Array<{ content: string }> }).messages;
  return messages[messages.length - 1].content;
};
const groundedTransport: LlmTransport = async (req) => {
  const m = lastUserMessage(req.body).match(/pointerId:\s*(\S+)\n\s*quote:\s*(.+)/);
  const content = JSON.stringify({ claims: [{ kind: "fact", text: LLM_CLAIM, evidencePointerIds: [m?.[1] ?? "x"], supportingQuote: (m?.[2] ?? "").trim() }] });
  return { status: 200, body: { choices: [{ message: { content }, finish_reason: "stop" }] } };
};

// A fake external embedding provider in the OpenAI space; records embedTexts calls (proves usage). No network.
function fakeProvider(calls: string[][] = []): EmbeddingProvider & { calls: string[][] } {
  return { name: "openai", model: "text-embedding-3-small", dimensions: 8, calls, async embedTexts(texts) { calls.push(texts); return texts.map(() => Array(8).fill(0.1)); } };
}

// data.json-shaped plugin settings (what normalizeSettings consumes). Mirrors the real vault's external config.
const dataJson = (withKey = true): string => JSON.stringify({
  mode: "external",
  llm: { provider: "openai", model: "gpt-4o-mini" },
  embedding: { provider: "openai", model: "text-embedding-3-small", dimensions: 8 },
  apiKeys: withKey ? { openai: SECRET } : {},
});
const externalSettings = (withKey = true): TranscriptMemorySettings => loadMcpConfig(
  { TMV_DB_PATH: "/vault/db.sqlite" }, { readSettingsFile: () => dataJson(withKey) },
).settings;

async function seedEvidence(): Promise<void> {
  const repos = createRepositories(db);
  const imported = importTranscript(db, { filename: "t.txt", rawText: RAW });
  const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string };
  const memory = repos.memoryObjects.createMemoryObject(
    { type: "decision", generated_text: "SQLite is authoritative.", confidence: 0.95, created_by: "agent" },
    [{ span_id: span.id, role: "supports", evidence_score: 0.95 }],
  );
  linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.95 });
}

// Mirror server.ts wiring exactly: embedding gate via askAiEmbeddingHealth, external provider into retrieval.
function mcpApi(settings: TranscriptMemorySettings, retrievalProvider?: EmbeddingProvider): FrontendApi {
  return createSqliteFrontendApi(db, {
    now,
    llmRequired: true,
    getLlmReady: () => true,
    getSynthesis: () => ({
      llm: createLlmAskAILanguageModel(new ExternalLlmProvider({ id: "openai", model: "gpt-x", apiKey: SECRET, transport: groundedTransport })),
      analysis: createLlmAskAIAnalysisModel(new ExternalLlmProvider({ id: "openai", model: "gpt-x", apiKey: SECRET, transport: groundedTransport })),
      info,
    }),
    embeddingsRequired: true,
    getEmbeddingHealth: () => askAiEmbeddingHealth(db, settings),
    getEmbeddingProvider: () => retrievalProvider, // tests inject the fake provider (no network) instead of the live http one
  });
}
const mcpTools = (settings: TranscriptMemorySettings, retrievalProvider?: EmbeddingProvider) =>
  createVaultTools({ db, api: mcpApi(settings, retrievalProvider), getEmbeddingProvider: () => retrievalProvider });

// ---- 1. MCP settings loading (config.ts) ----
describe("MCP loadMcpConfig settings loading", () => {
  it("1. infers data.json from TMV_DB_PATH (dirname/data.json) and loads embedding settings", () => {
    const seen: string[] = [];
    const cfg = loadMcpConfig({ TMV_DB_PATH: "/vault/plugins/tmv/transcript-memory.sqlite" }, {
      readSettingsFile: (p) => { seen.push(p); return dataJson(); },
    });
    expect(seen).toEqual(["/vault/plugins/tmv/data.json"]); // inferred next to the DB
    expect(cfg.settings.mode).toBe("external");
    expect(cfg.settings.embedding).toMatchObject({ provider: "openai", model: "text-embedding-3-small", dimensions: 8 });
    expect(cfg.settingsSource).toMatchObject({ loaded: true, explicit: false, path: "/vault/plugins/tmv/data.json" });
  });

  it("2. loads the embedding key into settings WITHOUT exposing it in the log-safe settingsSource", () => {
    const cfg = loadMcpConfig({ TMV_DB_PATH: "/vault/db.sqlite" }, { readSettingsFile: () => dataJson() });
    expect(cfg.settings.apiKeys.openai).toBe(SECRET); // functionally present (needed to build the provider)
    expect(JSON.stringify(cfg.settingsSource)).not.toContain(SECRET); // the non-secret diagnostic never carries the key
  });

  it("3. explicit TMV_SETTINGS_PATH overrides the inferred path", () => {
    const seen: string[] = [];
    const cfg = loadMcpConfig({ TMV_DB_PATH: "/vault/db.sqlite", TMV_SETTINGS_PATH: "/custom/elsewhere/data.json" }, {
      readSettingsFile: (p) => { seen.push(p); return p === "/custom/elsewhere/data.json" ? dataJson() : undefined; },
    });
    expect(seen).toEqual(["/custom/elsewhere/data.json"]); // never reads the inferred path
    expect(cfg.settingsSource).toMatchObject({ explicit: true, loaded: true, path: "/custom/elsewhere/data.json" });
    expect(cfg.settings.embedding.provider).toBe("openai");
  });

  it("4. missing settings file -> keyless recommended defaults gated as setup_required (no silent token-hash answers)", async () => {
    const cfg = loadMcpConfig({ TMV_DB_PATH: "/vault/db.sqlite" }, { readSettingsFile: () => undefined });
    expect(cfg.settings.embedding).toEqual(DEFAULT_SETTINGS.embedding); // recommended keyless external default; still gated (no key) as setup_required
    expect(cfg.settingsSource.loaded).toBe(false);
    // The gate is the guard: even though a local provider could resolve, ask_vault is blocked before retrieval.
    expect(askAiEmbeddingHealth(db, cfg.settings).state).toBe("setup_required");
    await seedEvidence();
    const r = await mcpTools(cfg.settings).call("ask_vault", { question: "What did we decide about SQLite?" }) as { ok: boolean; state?: string };
    expect(r).toMatchObject({ ok: false, state: "embedding_setup_required" }); // never an answer from token-hash vectors
  });

  it("4b. env LLM is preserved/overlaid even when reading settings from data.json", () => {
    const cfg = loadMcpConfig(
      { TMV_DB_PATH: "/vault/db.sqlite", TMV_LLM_MODEL: "gpt-env", TMV_LLM_API_KEY: "sk-env-OVERRIDE" },
      { readSettingsFile: () => dataJson() },
    );
    expect(cfg.settings.llm.model).toBe("gpt-env"); // env LLM overlay wins
    expect(cfg.settings.embedding.provider).toBe("openai"); // embeddings still come from data.json
    expect(cfg.llmReady).toBe(true);
  });

  it("4c. malformed settings file does not throw and does not expose contents", () => {
    const cfg = loadMcpConfig({ TMV_DB_PATH: "/vault/db.sqlite" }, { readSettingsFile: () => "{ not json" });
    expect(cfg.settingsSource.loaded).toBe(false);
    expect(cfg.settings.embedding).toEqual(DEFAULT_SETTINGS.embedding);
    expect(JSON.stringify(cfg.settingsSource)).not.toContain("not json");
  });
});

// ---- 2. MCP production embedding gate (server.ts wiring, exercised through createVaultTools) ----
describe("MCP ask_vault embedding gate", () => {
  it("5. no embedding config/key -> embedding_setup_required", async () => {
    await seedEvidence();
    const r = await mcpTools(externalSettings(false)).call("ask_vault", { question: "What did we decide about SQLite?" }) as { ok: boolean; state?: string };
    expect(r.ok).toBe(false);
    expect(r.state).toBe("embedding_setup_required");
  });

  it("6. configured but token-hash/stale index -> embedding_reindex_required", async () => {
    await seedEvidence();
    await rebuildRetrievalIndex(db); // default -> token-hash-v1 vectors, a different space than openai
    const r = await mcpTools(externalSettings(true)).call("ask_vault", { question: "What did we decide about SQLite?" }) as { ok: boolean; state?: string };
    expect(r.ok).toBe(false);
    expect(r.state).toBe("embedding_reindex_required");
  });

  it("7. matching OpenAI embedding index -> MCP ask proceeds (cited answer)", async () => {
    await seedEvidence();
    const provider = fakeProvider();
    await rebuildRetrievalIndex(db, { embeddingProvider: provider }); // index under the openai space
    expect(askAiEmbeddingHealth(db, externalSettings(true)).state).toBe("ok");
    const r = await mcpTools(externalSettings(true), provider).call("ask_vault", { question: "What did we decide about SQLite?" }) as { ok: boolean; answer_bundle?: { claims: unknown[] } };
    expect(r.ok).toBe(true);
    expect((r.answer_bundle?.claims.length ?? 0)).toBeGreaterThan(0);
  });
});

// ---- 3. MCP retrieval uses the external embedding provider ----
describe("MCP retrieval threads the external embedding provider", () => {
  it("8/9. ask_vault passes the external provider into BOTH evidence and unconfirmed (memory) retrieval", async () => {
    await seedEvidence();
    const provider = fakeProvider();
    await rebuildRetrievalIndex(db, { embeddingProvider: provider });
    provider.calls.length = 0;
    // an advice prompt runs both evidence retrieval and the unconfirmed (searchMemoryObjects) retrieval
    await mcpTools(externalSettings(true), provider).call("ask_vault", { question: "How should we improve our SQLite setup?" });
    expect(provider.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("10. production never resolves token-hash-v1 as the embedding provider", () => {
    expect(productionEmbeddingProvider(externalSettings(true))?.name).toBe("openai"); // external -> real provider
    expect(productionEmbeddingProvider(externalSettings(false))).toBeUndefined(); // unconfigured -> none (never token-hash)
  });

  it("13. search_evidence uses the external embedding provider when configured (semantic, not keyword-only)", async () => {
    await seedEvidence();
    const provider = fakeProvider();
    await rebuildRetrievalIndex(db, { embeddingProvider: provider });
    provider.calls.length = 0;
    const r = await mcpTools(externalSettings(true), provider).call("search_evidence", { query: "SQLite source of truth", limit: 5 }) as { evidence: unknown[] };
    expect(provider.calls.length).toBeGreaterThanOrEqual(1); // embedded the query -> semantic retrieval
    expect(Array.isArray(r.evidence)).toBe(true);
  });

  it("14. the embedding gate/health check creates NO evidence/source/citation rows", async () => {
    await seedEvidence();
    await rebuildRetrievalIndex(db, { embeddingProvider: fakeProvider() });
    const before = { ep: count("evidence_pointers"), sp: count("source_pointers"), cl: count("citation_links") };
    askAiEmbeddingHealth(db, externalSettings(true));
    askAiEmbeddingHealth(db, externalSettings(false));
    expect({ ep: count("evidence_pointers"), sp: count("source_pointers"), cl: count("citation_links") }).toEqual(before);
  });
});
