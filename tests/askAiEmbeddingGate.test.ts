import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { rebuildRetrievalIndex, type EmbeddingProvider } from "../src/retrieval/index.js";
import {
  EmbeddingReindexRequiredError, EmbeddingSetupRequiredError,
  type AskAILanguageModel, type SynthesisInfo,
} from "../src/ask-ai/index.js";
import { createSqliteFrontendApi, renderRoute, routeHref, type EmbeddingHealth, type FrontendApi } from "../src/frontend/index.js";
import { askAiEmbeddingHealth, productionEmbeddingProvider } from "../src/obsidian/embeddingSettings.js";
import { setApiKey, type TranscriptMemorySettings } from "../src/obsidian/settings.js";
import { createVaultTools } from "../src/mcp/tools.js";

const now = () => new Date("2026-06-12T12:00:00.000Z");
const info: SynthesisInfo = { mode: "external_llm", provider: "mock", model: "mock", usedFallback: false };
const mockLlm: AskAILanguageModel = { generateClaims: async ({ evidence }) => evidence.length ? [{ kind: "fact", text: evidence[0].quotePreview, evidencePointerIds: [evidence[0].evidencePointerId] }] : [] };
// A fake external embedding provider in the OpenAI space; records embedTexts calls so we can prove Ask AI uses it.
function fakeProvider(calls: string[][] = []): EmbeddingProvider & { calls: string[][] } {
  return { name: "openai", model: "text-embedding-3-small", dimensions: 8, calls, async embedTexts(texts) { calls.push(texts); return texts.map(() => Array(8).fill(0.1)); } };
}
const externalEmbeddingSettings = (withKey = true): TranscriptMemorySettings => {
  const base: TranscriptMemorySettings = {
    schemaVersion: 1, mode: "external", llm: { provider: "openai", model: "gpt-4o-mini" },
    embedding: { provider: "openai", model: "text-embedding-3-small", dimensions: 8 }, apiKeys: {},
  };
  return withKey ? setApiKey(base, "openai", "sk-embed-PLANTED-1234567890") : base;
};

let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;
beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); });
afterEach(() => db.close());

function seedMemory() {
  const t = importTranscript(db, { filename: "A.txt", rawText: "Alex: We decided to use SQLite as the source of truth." });
  const span = (db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? LIMIT 1").get(t.transcriptId) as { id: string }).id;
  const active = repos.memoryObjects.createMemoryObject({ type: "decision", title: "Use SQLite", generated_text: "We decided to use SQLite as the source of truth.", confidence: 0.95, created_by: "agent" }, [{ span_id: span, role: "supports", evidence_score: 0.95 }]);
  linkMemoryObjectToSpan(db, { memoryObjectId: active.id, transcriptId: t.transcriptId, spanId: span, evidenceStrength: "strong", confidence: 0.95 });
  repos.memoryObjects.createMemoryObject({ type: "preference", title: "Maybe avoid SQLite", generated_text: "Maybe we should avoid SQLite.", status: "needs_review", confidence: 0.4, created_by: "agent" }, [{ span_id: span, role: "qualifies", evidence_score: 0.3 }]);
  return t.transcriptId;
}
const gatedApi = (health: EmbeddingHealth, provider?: EmbeddingProvider): FrontendApi =>
  createSqliteFrontendApi(db, { now, llmRequired: true, embeddingsRequired: true, getSynthesis: () => ({ llm: mockLlm, info }), getEmbeddingHealth: () => health, getEmbeddingProvider: () => provider });

describe("Production Ask AI embedding gate", () => {
  it("1. blocks with setup-required when no API embedding provider is configured", async () => {
    seedMemory();
    await expect(gatedApi({ state: "setup_required", reason: "none" }).ask("What did we decide about SQLite?")).rejects.toBeInstanceOf(EmbeddingSetupRequiredError);
  });

  it("2. blocks with reindex-required when the index does not match the configured provider", async () => {
    seedMemory();
    await expect(gatedApi({ state: "reindex_required", reason: "stale" }).ask("What did we decide about SQLite?")).rejects.toBeInstanceOf(EmbeddingReindexRequiredError);
  });

  it("3. real resolver: external provider configured but index is token-hash-v1 -> reindex_required", () => {
    seedMemory();
    rebuildRetrievalIndex(db); // default => local token-hash-v1 vectors
    expect(askAiEmbeddingHealth(db, externalEmbeddingSettings()).state).toBe("reindex_required");
  });

  it("3b. real resolver: no API key configured -> setup_required (token-hash is never production-OK)", () => {
    seedMemory();
    rebuildRetrievalIndex(db);
    expect(askAiEmbeddingHealth(db, externalEmbeddingSettings(false)).state).toBe("setup_required");
  });

  it("4. real resolver: index built under the configured provider space -> ok, and Ask AI proceeds", async () => {
    seedMemory();
    const provider = fakeProvider();
    await rebuildRetrievalIndex(db, { embeddingProvider: provider }); // index under the openai space
    expect(askAiEmbeddingHealth(db, externalEmbeddingSettings()).state).toBe("ok");
    const response = await gatedApi({ state: "ok", reason: "ok" }, provider).ask("What did we decide about SQLite?");
    expect(response.queryUnderstanding.intent).toBe("decision_lookup");
  });

  it("5/17. the health check creates NO evidence/source/citation rows", () => {
    seedMemory();
    rebuildRetrievalIndex(db);
    const before = { ep: count("evidence_pointers"), sp: count("source_pointers"), cl: count("citation_links") };
    askAiEmbeddingHealth(db, externalEmbeddingSettings());
    askAiEmbeddingHealth(db, externalEmbeddingSettings(false));
    expect({ ep: count("evidence_pointers"), sp: count("source_pointers"), cl: count("citation_links") }).toEqual(before);
  });
});

const count = (sql: string) => (db.prepare(`SELECT COUNT(*) c FROM ${sql}`).get() as { c: number }).c;

describe("Ask AI uses the configured embedding provider for retrieval", () => {
  it("6/7. passes the external provider into BOTH evidence and unconfirmed (memory) retrieval", async () => {
    seedMemory();
    const provider = fakeProvider();
    await rebuildRetrievalIndex(db, { embeddingProvider: provider });
    provider.calls.length = 0;
    // advice prompt -> runs both the evidence retrieval and the unconfirmed (searchMemoryObjects) retrieval
    await gatedApi({ state: "ok", reason: "ok" }, provider).ask("How should we improve our SQLite setup?");
    expect(provider.calls.length).toBeGreaterThanOrEqual(2); // embedTexts called for evidence + memory vector search
  });

  it("8. production never passes token-hash-v1 as the embedding provider", () => {
    seedMemory();
    expect(productionEmbeddingProvider(externalEmbeddingSettings())?.name).toBe("openai"); // external -> real provider
    expect(productionEmbeddingProvider(externalEmbeddingSettings(false))).toBeUndefined(); // not configured -> none (no token-hash)
  });

  it("9. without embeddingsRequired (tests/dev) Ask AI runs keyword-only with no gate and no provider", async () => {
    seedMemory();
    rebuildRetrievalIndex(db);
    const provider = fakeProvider();
    const api = createSqliteFrontendApi(db, { now, llmRequired: true, getSynthesis: () => ({ llm: mockLlm, info }), getEmbeddingProvider: () => provider });
    const r = await api.ask("What did we decide about SQLite?"); // no throw, no gate
    expect(r).toBeDefined();
    expect(provider.calls).toHaveLength(0); // provider NOT passed when embeddingsRequired is off
  });
});

describe("MCP ask_vault respects the gate", () => {
  const tools = (health: EmbeddingHealth) => createVaultTools({ db, api: gatedApi(health) });
  it("10. returns embedding_setup_required when no embedding config", async () => {
    seedMemory();
    const r = await tools({ state: "setup_required", reason: "none" }).call("ask_vault", { question: "What did we decide about SQLite?" }) as { ok: boolean; state?: string };
    expect(r.ok).toBe(false);
    expect(r.state).toBe("embedding_setup_required");
  });
  it("11. returns embedding_reindex_required when stale/mismatched", async () => {
    seedMemory();
    const r = await tools({ state: "reindex_required", reason: "stale" }).call("ask_vault", { question: "What did we decide about SQLite?" }) as { ok: boolean; state?: string };
    expect(r.ok).toBe(false);
    expect(r.state).toBe("embedding_reindex_required");
  });
});

describe("Ask AI UI renders the gate state", () => {
  const uiApi = (state: "setup_required" | "reindex_required"): FrontendApi => ({
    ...createSqliteFrontendApi(db, { now }),
    getLlmStatus: async () => ({ required: true, ready: true }),
    getEmbeddingStatus: async () => ({ required: true, state, reason: "because" }),
  });
  it("12. setup-required renders a configure-embedding message", async () => {
    const html = await renderRoute(uiApi("setup_required"), routeHref.ask());
    expect(html).toContain("Set up an API embedding provider");
    expect(html).not.toContain('data-action="ask"'); // the ask form is blocked
  });
  it("13. reindex-required tells the user to rebuild the embedding index", async () => {
    const html = await renderRoute(uiApi("reindex_required"), routeHref.ask());
    expect(html).toContain("Rebuild the embedding index");
  });
});
