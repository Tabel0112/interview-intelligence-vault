import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import {
  embeddingReindexStatus, productionEmbeddingProvider, resolveEmbeddingProviderFromSettings, runEmbeddingReindex,
} from "../src/obsidian/embeddingSettings.js";
import { DEFAULT_SETTINGS, setApiKey, type TranscriptMemorySettings } from "../src/obsidian/settings.js";

// Explicit deterministic dev/test seam (NOT the fresh default, which is the keyless external provider).
const deterministicSeam = (): TranscriptMemorySettings => ({
  schemaVersion: 1, mode: "local", llm: { provider: "none", model: "" },
  embedding: { provider: "deterministic-test", model: "token-hash-v1" }, apiKeys: {},
});
import {
  DeterministicTestEmbeddingProvider, ExternalEmbeddingProvider, NoopEmbeddingProvider, vectorSearch,
  type EmbeddingTransport, type EmbeddingTransportRequest, type EmbeddingTransportResponse,
} from "../src/retrieval/index.js";

const SECRET = "sk-test-WIRING-SECRET-1234567890";
const DIM = 8;
const vec = (text: string, dim = DIM): number[] =>
  Array.from({ length: dim }, (_, i) => ((text.charCodeAt(i % Math.max(1, text.length)) || 1) % 7) - 3);

function makeTransport() {
  const calls: EmbeddingTransportRequest[] = [];
  const transport: EmbeddingTransport = async (req): Promise<EmbeddingTransportResponse> => {
    calls.push(req);
    const input = (JSON.parse(req.body) as { input: string[] }).input;
    return { status: 200, body: { data: input.map((text, index) => ({ index, embedding: vec(text) })) } };
  };
  return { transport, calls };
}

const externalSettings = (overrides: Partial<TranscriptMemorySettings["embedding"]> = {}, withKey = true): TranscriptMemorySettings => {
  const base: TranscriptMemorySettings = {
    schemaVersion: 1,
    mode: "external",
    llm: { provider: "none", model: "" },
    embedding: { provider: "openai", model: "text-embedding-3-small", dimensions: DIM, ...overrides },
    apiKeys: {},
  };
  return withKey ? setApiKey(base, "openai", SECRET) : base;
};

let db: SqliteDatabase;
beforeEach(() => {
  db = openDatabase(":memory:");
  importTranscript(db, { filename: "t.txt", rawText: `Alex: SQLite is the source of truth.
Sam: Markdown files are readable views only.` });
});
afterEach(() => db.close());

describe("resolveEmbeddingProviderFromSettings", () => {
  it("the keyless external default resolves the local token-hash index but is flagged awaiting-key (never calls the transport)", () => {
    const { transport, calls } = makeTransport();
    const resolution = resolveEmbeddingProviderFromSettings(DEFAULT_SETTINGS, { transport });
    // The local keyword index still uses token-hash, but this is an "awaiting key" fallback, not a configured provider.
    expect(resolution.provider).toBeInstanceOf(DeterministicTestEmbeddingProvider);
    expect(resolution.usedFallback).toBe(true);
    expect(resolution.requestedId).toBe("openai");
    expect(resolution.reason).toMatch(/needs an API key/i);
    expect(calls).toHaveLength(0); // resolving must not perform any network call
    // Fail-closed: no production provider is handed out for a keyless default (no token-hash reaches production).
    expect(productionEmbeddingProvider(DEFAULT_SETTINGS, { transport })).toBeUndefined();
  });

  it("an EXPLICIT deterministic-test seam resolves that provider directly (not a fallback)", () => {
    const resolution = resolveEmbeddingProviderFromSettings(deterministicSeam());
    expect(resolution.provider).toBeInstanceOf(DeterministicTestEmbeddingProvider);
    expect(resolution.usedFallback).toBe(false); // an intentional dev/test selection, not an awaiting-key fallback
    expect(resolution.requestedId).toBe("deterministic-test");
  });

  it("resolves the noop provider for a disabled selection", () => {
    const resolution = resolveEmbeddingProviderFromSettings({ ...DEFAULT_SETTINGS, embedding: { provider: "noop", model: "disabled" } });
    expect(resolution.provider).toBeInstanceOf(NoopEmbeddingProvider);
  });

  it("uses the external provider when fully configured, without calling the transport", () => {
    const { transport, calls } = makeTransport();
    const resolution = resolveEmbeddingProviderFromSettings(externalSettings(), { transport });
    expect(resolution.provider).toBeInstanceOf(ExternalEmbeddingProvider);
    expect(resolution.provider.name).toBe("openai");
    expect(resolution.usedFallback).toBe(false);
    expect(calls).toHaveLength(0); // resolving must not perform any network call
  });

  it("falls back to token-hash with a clear reason when the API key is missing", () => {
    const resolution = resolveEmbeddingProviderFromSettings(externalSettings({}, false));
    expect(resolution.provider).toBeInstanceOf(DeterministicTestEmbeddingProvider);
    expect(resolution.usedFallback).toBe(true);
    expect(resolution.reason).toContain("token-hash-v1");
  });

  it("falls back to token-hash when dimensions are missing or invalid", () => {
    expect(resolveEmbeddingProviderFromSettings(externalSettings({ dimensions: undefined })).usedFallback).toBe(true);
    expect(resolveEmbeddingProviderFromSettings(externalSettings({ dimensions: 0 })).usedFallback).toBe(true);
  });
});

describe("embeddingReindexStatus (read-only, network-free)", () => {
  it("reports no reindex on a fresh, unindexed database (explicit local seam)", () => {
    const { assessment, summary } = embeddingReindexStatus(db, deterministicSeam());
    expect(assessment.needsReindex).toBe(false);
    expect(summary.usedFallback).toBe(false);
  });

  it("reports reindex-needed (with a foreign space) after switching to a different provider space", async () => {
    await runEmbeddingReindex(db, deterministicSeam()); // local token-hash index
    const { assessment } = embeddingReindexStatus(db, externalSettings());
    expect(assessment.needsReindex).toBe(true);
    expect(assessment.foreignSpaces.length).toBeGreaterThan(0);
  });

  it("never leaks the API key in the status object", async () => {
    await runEmbeddingReindex(db, deterministicSeam());
    expect(JSON.stringify(embeddingReindexStatus(db, externalSettings()))).not.toContain(SECRET);
  });
});

describe("runEmbeddingReindex (explicit, mock transport only)", () => {
  it("embeds with the local token-hash provider when the deterministic seam is explicitly selected (no transport)", async () => {
    const { result, summary } = await runEmbeddingReindex(db, deterministicSeam());
    expect(result.embedded).toBeGreaterThan(0);
    expect(summary.usedFallback).toBe(false);
    const providers = db.prepare("SELECT DISTINCT embedding_provider p FROM search_embeddings").all() as Array<{ p: string }>;
    expect(providers).toEqual([{ p: "deterministic-test" }]);
  });

  it("uses the external provider via the mock transport and preserves no-mixing", async () => {
    const { transport, calls } = makeTransport();
    const { result } = await runEmbeddingReindex(db, externalSettings(), { transport });
    expect(result.embedded).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(0);
    expect((db.prepare("SELECT embedding_provider p FROM search_embeddings LIMIT 1").get() as { p: string }).p).toBe("openai");
    // A token-hash query (different space) must find nothing.
    expect(await vectorSearch(db, { query: "SQLite", embeddingProvider: new DeterministicTestEmbeddingProvider(24) })).toEqual([]);
  });

  it("falls back to token-hash WITHOUT calling the transport when the key is missing", async () => {
    const { transport, calls } = makeTransport();
    const { result, summary } = await runEmbeddingReindex(db, externalSettings({}, false), { transport });
    expect(summary.usedFallback).toBe(true);
    expect(calls).toHaveLength(0); // external not used -> no network attempted
    expect(result.embedded).toBeGreaterThan(0);
    const providers = db.prepare("SELECT DISTINCT embedding_provider p FROM search_embeddings").all() as Array<{ p: string }>;
    expect(providers).toEqual([{ p: "deterministic-test" }]);
  });

  it("never leaks the API key in the result object", async () => {
    const { transport } = makeTransport();
    const out = await runEmbeddingReindex(db, externalSettings(), { transport });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });
});
