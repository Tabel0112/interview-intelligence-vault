import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import {
  createHttpEmbeddingTransport, detectReindexNeeded, DeterministicTestEmbeddingProvider, EmbeddingAuthError,
  EmbeddingError, EmbeddingProviderError, EmbeddingRateLimitError, EmbeddingResponseError, ExternalEmbeddingProvider,
  rebuildRetrievalIndex, redactSecret, resolveEmbeddingProvider, TOKEN_HASH_MODEL, vectorSearch,
  type EmbeddingTransport, type EmbeddingTransportRequest, type EmbeddingTransportResponse, type ExternalEmbeddingConfig,
} from "../src/retrieval/index.js";

const SECRET = "sk-test-PLANTED-SECRET-1234567890";
const DIM = 8;

const vec = (text: string, dim = DIM): number[] =>
  Array.from({ length: dim }, (_, i) => ((text.charCodeAt(i % Math.max(1, text.length)) || 1) % 7) - 3);

function makeTransport(responder: (req: EmbeddingTransportRequest) => EmbeddingTransportResponse) {
  const calls: EmbeddingTransportRequest[] = [];
  const transport: EmbeddingTransport = async (req) => { calls.push(req); return responder(req); };
  return { transport, calls };
}

const embedResponder = (dim = DIM) => (req: EmbeddingTransportRequest): EmbeddingTransportResponse => {
  const input = (JSON.parse(req.body) as { input: string[] }).input;
  return { status: 200, body: { data: input.map((text, index) => ({ index, embedding: vec(text, dim) })) } };
};

const config = (transport: EmbeddingTransport, overrides: Partial<ExternalEmbeddingConfig> = {}): ExternalEmbeddingConfig => ({
  provider: "openai", model: "text-embedding-3-small", dimensions: DIM, apiKey: SECRET, baseUrl: "https://api.test/v1", transport, ...overrides,
});

describe("external embedding provider — construction and metadata", () => {
  it("exposes provider/model/dimension metadata from config", () => {
    const provider = new ExternalEmbeddingProvider(config(makeTransport(embedResponder()).transport));
    expect(provider.name).toBe("openai");
    expect(provider.model).toBe("text-embedding-3-small");
    expect(provider.dimensions).toBe(DIM);
  });

  it("requires a non-blank API key and positive dimensions", () => {
    const { transport } = makeTransport(embedResponder());
    expect(() => new ExternalEmbeddingProvider(config(transport, { apiKey: undefined }))).toThrow(EmbeddingAuthError);
    expect(() => new ExternalEmbeddingProvider(config(transport, { apiKey: "   " }))).toThrow(EmbeddingAuthError);
    expect(() => new ExternalEmbeddingProvider(config(transport, { dimensions: 0 }))).toThrow(EmbeddingResponseError);
  });
});

describe("external embedding provider — request/response", () => {
  it("embeds texts and preserves input order even when the API returns them out of order", async () => {
    const { transport, calls } = makeTransport((req) => {
      const input = (JSON.parse(req.body) as { input: string[] }).input;
      const data = input.map((text, index) => ({ index, embedding: vec(text) })).reverse(); // out of order
      return { status: 200, body: { data } };
    });
    const provider = new ExternalEmbeddingProvider(config(transport));
    const result = await provider.embedTexts(["alpha", "beta"]);
    expect(result).toEqual([vec("alpha"), vec("beta")]);
    expect(JSON.parse(calls[0].body)).toEqual({ model: "text-embedding-3-small", input: ["alpha", "beta"] });
    expect(calls[0].url).toBe("https://api.test/v1/embeddings");
  });

  it("returns an empty result without calling the transport for empty input", async () => {
    const { transport, calls } = makeTransport(embedResponder());
    expect(await new ExternalEmbeddingProvider(config(transport)).embedTexts([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("maps HTTP status codes to typed errors", async () => {
    const auth = new ExternalEmbeddingProvider(config(makeTransport(() => ({ status: 401, body: {} })).transport));
    await expect(auth.embedTexts(["x"])).rejects.toBeInstanceOf(EmbeddingAuthError);
    const forbidden = new ExternalEmbeddingProvider(config(makeTransport(() => ({ status: 403, body: {} })).transport));
    await expect(forbidden.embedTexts(["x"])).rejects.toBeInstanceOf(EmbeddingAuthError);
    const rate = new ExternalEmbeddingProvider(config(makeTransport(() => ({ status: 429, body: {} })).transport));
    await expect(rate.embedTexts(["x"])).rejects.toBeInstanceOf(EmbeddingRateLimitError);
    const server = new ExternalEmbeddingProvider(config(makeTransport(() => ({ status: 500, body: {} })).transport));
    await expect(server.embedTexts(["x"])).rejects.toBeInstanceOf(EmbeddingProviderError);
  });

  it("rejects malformed responses and wrong-dimension vectors", async () => {
    const noData = new ExternalEmbeddingProvider(config(makeTransport(() => ({ status: 200, body: { foo: 1 } })).transport));
    await expect(noData.embedTexts(["x"])).rejects.toBeInstanceOf(EmbeddingResponseError);
    const wrongCount = new ExternalEmbeddingProvider(config(makeTransport(() => ({ status: 200, body: { data: [] } })).transport));
    await expect(wrongCount.embedTexts(["x"])).rejects.toBeInstanceOf(EmbeddingResponseError);
    const wrongDim = new ExternalEmbeddingProvider(config(makeTransport(() => ({ status: 200, body: { data: [{ index: 0, embedding: [1, 2, 3] }] } })).transport));
    await expect(wrongDim.embedTexts(["x"])).rejects.toBeInstanceOf(EmbeddingResponseError);
  });

  it("wraps transport failures as EmbeddingProviderError", async () => {
    const transport: EmbeddingTransport = async () => { throw new Error("socket hang up"); };
    await expect(new ExternalEmbeddingProvider(config(transport)).embedTexts(["x"])).rejects.toBeInstanceOf(EmbeddingProviderError);
  });
});

describe("external embedding provider — key safety", () => {
  it("never includes the API key in errors, while still sending it in the header", async () => {
    const { transport, calls } = makeTransport(() => ({ status: 401, body: { error: { message: "invalid key" } } }));
    let thrown: unknown;
    try { await new ExternalEmbeddingProvider(config(transport)).embedTexts(["x"]); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(EmbeddingAuthError);
    const dump = JSON.stringify({ message: (thrown as Error).message, context: (thrown as EmbeddingError).context, str: String(thrown), name: (thrown as Error).name });
    expect(dump).not.toContain(SECRET);
    expect((thrown as EmbeddingError).context).toEqual({ provider: "openai", model: "text-embedding-3-small", status: 401 });
    expect(calls[0].headers.Authorization).toBe(`Bearer ${SECRET}`); // the key WAS sent
  });

  it("redacts the key if an upstream transport error echoes it", async () => {
    const transport: EmbeddingTransport = async () => { throw new Error(`network failed with token ${SECRET} in header`); };
    let thrown: unknown;
    try { await new ExternalEmbeddingProvider(config(transport)).embedTexts(["x"]); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(EmbeddingProviderError);
    expect((thrown as Error).message).not.toContain(SECRET);
    expect((thrown as Error).message).toContain("[redacted]");
  });

  it("redactSecret strips the secret and is a no-op when blank", () => {
    expect(redactSecret(`a ${SECRET} b`, SECRET)).not.toContain(SECRET);
    expect(redactSecret("no secret", "")).toBe("no secret");
  });
});

describe("external embedding provider — serialization/inspection cannot expose the key", () => {
  const provider = () => new ExternalEmbeddingProvider(config(makeTransport(embedResponder()).transport, { timeoutMs: 30000 }));

  it("JSON.stringify exposes only name/model/dimensions", () => {
    const p = provider();
    const serialized = JSON.stringify(p);
    expect(serialized).not.toContain(SECRET);
    expect(JSON.parse(serialized)).toEqual({ name: "openai", model: "text-embedding-3-small", dimensions: DIM });
  });

  it("object spread and key enumeration never include the key or internals", () => {
    const p = provider();
    const spread = { ...p };
    expect(spread).toEqual({ name: "openai", model: "text-embedding-3-small", dimensions: DIM });
    expect(JSON.stringify(spread)).not.toContain(SECRET);
    expect(Object.keys(p)).toEqual(["name", "model", "dimensions"]);
    expect(Object.getOwnPropertyNames(p)).toEqual(["name", "model", "dimensions"]);
    expect(Reflect.ownKeys(p)).toEqual(["name", "model", "dimensions"]);
    for (const key of Reflect.ownKeys(p)) expect(String(key)).not.toContain("apiKey");
  });

  it("util.inspect and console-style/string inspection do not reveal the key", () => {
    const p = provider();
    expect(inspect(p)).not.toContain(SECRET);
    expect(inspect(p, { showHidden: true, depth: null })).not.toContain(SECRET);
    expect(String(p)).not.toContain(SECRET);
    expect(`${p}`).not.toContain(SECRET);
  });

  it("still embeds correctly after the privacy change (behavior unchanged)", async () => {
    const p = provider();
    expect(await p.embedTexts(["alpha"])).toEqual([vec("alpha")]);
  });
});

describe("resolver: external only when configured with a key", () => {
  it("uses the external provider when a non-blank key is configured", () => {
    const { transport } = makeTransport(embedResponder());
    const resolution = resolveEmbeddingProvider(undefined, { external: config(transport) });
    expect(resolution.usedFallback).toBe(false);
    expect(resolution.provider.name).toBe("openai");
    expect(resolution.provider).toBeInstanceOf(ExternalEmbeddingProvider);
  });

  it("falls back to token-hash-v1 when the external key is missing or blank", () => {
    const { transport } = makeTransport(embedResponder());
    for (const apiKey of [undefined, "   "]) {
      const resolution = resolveEmbeddingProvider(undefined, { external: config(transport, { apiKey }) });
      expect(resolution.usedFallback).toBe(true);
      expect(resolution.requestedId).toBe("openai");
      expect(resolution.provider.model).toBe(TOKEN_HASH_MODEL);
      expect(resolution.reason).toContain(TOKEN_HASH_MODEL);
    }
  });

  it("keeps the existing default/fallback behavior when no external config is given", () => {
    expect(resolveEmbeddingProvider().usedFallback).toBe(false);
    expect(resolveEmbeddingProvider().provider.model).toBe(TOKEN_HASH_MODEL);
    expect(resolveEmbeddingProvider("anthropic").usedFallback).toBe(true);
  });
});

describe("HTTP transport timeout (injected fetch, no real network)", () => {
  afterEach(() => vi.useRealTimers());

  it("aborts the request after timeoutMs", async () => {
    vi.useFakeTimers();
    const fakeFetch = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted by signal")));
      })) as unknown as typeof fetch;
    const transport = createHttpEmbeddingTransport(fakeFetch);
    const promise = transport({ url: "https://api.test/v1/embeddings", method: "POST", headers: {}, body: "{}", timeoutMs: 1000 });
    const expectation = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    await expectation;
  });

  it("resolves normally and parses JSON when no timeout is configured", async () => {
    const fakeFetch = (async () => ({ status: 200, json: async () => ({ data: [] }) })) as unknown as typeof fetch;
    const transport = createHttpEmbeddingTransport(fakeFetch);
    expect(await transport({ url: "https://api.test/v1/embeddings", method: "POST", headers: {}, body: "{}" }))
      .toEqual({ status: 200, body: { data: [] } });
  });
});

describe("integration: metadata storage and no-mixing via rebuildRetrievalIndex (mock transport)", () => {
  let db: SqliteDatabase;
  beforeEach(() => {
    db = openDatabase(":memory:");
    importTranscript(db, { filename: "t.txt", rawText: `Alex: SQLite is the source of truth.
Sam: Markdown files are readable views only.` });
  });
  afterEach(() => db.close());

  it("stores provider/model/dimension/content-hash and keeps the external space separate from token-hash", async () => {
    const provider = new ExternalEmbeddingProvider(config(makeTransport(embedResponder()).transport));
    const result = await rebuildRetrievalIndex(db, { embeddingProvider: provider });
    expect(result.embedded).toBeGreaterThan(0);

    const row = db.prepare("SELECT embedding_provider,embedding_model,embedding_dim,content_hash FROM search_embeddings LIMIT 1").get() as {
      embedding_provider: string; embedding_model: string; embedding_dim: number; content_hash: string;
    };
    expect(row.embedding_provider).toBe("openai");
    expect(row.embedding_model).toBe("text-embedding-3-small");
    expect(row.embedding_dim).toBe(DIM);
    expect(row.content_hash).toMatch(/.+/);

    // No mixing: a token-hash query (different space) finds nothing; the external space does.
    expect(await vectorSearch(db, { query: "SQLite", embeddingProvider: new DeterministicTestEmbeddingProvider(24) })).toEqual([]);
    expect((await vectorSearch(db, { query: "SQLite", embeddingProvider: provider })).length).toBeGreaterThan(0);

    // Switching to token-hash is detected as a reindex with the external space reported as foreign.
    const assessment = detectReindexNeeded(db, new DeterministicTestEmbeddingProvider(24));
    expect(assessment.needsReindex).toBe(true);
    expect(assessment.foreignSpaces).toEqual([{ provider: "openai", model: "text-embedding-3-small", dimensions: DIM, count: assessment.documentCount }]);
  });

  it("records index errors safely (no key) and preserves documents when the provider rejects the key", async () => {
    const provider = new ExternalEmbeddingProvider(config(makeTransport(() => ({ status: 401, body: {} })).transport));
    const result = await rebuildRetrievalIndex(db, { embeddingProvider: provider });
    expect(result.embedded).toBe(0);
    expect(result.errors).toBeGreaterThan(0);
    expect(db.prepare("SELECT COUNT(*) c FROM retrieval_documents").get()).toMatchObject({ c: expect.any(Number) });
    expect((db.prepare("SELECT COUNT(*) c FROM retrieval_documents").get() as { c: number }).c).toBeGreaterThan(0);
    expect((db.prepare("SELECT COUNT(*) c FROM search_embeddings").get() as { c: number }).c).toBe(0);
    const errors = db.prepare("SELECT error FROM retrieval_index_status WHERE error IS NOT NULL").all() as Array<{ error: string }>;
    expect(errors.length).toBeGreaterThan(0);
    for (const row of errors) expect(row.error).not.toContain(SECRET);
  });
});
