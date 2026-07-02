import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, ValidationError, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import {
  assertCompatibleEmbeddingSpace, createEmbeddingProvider, DEFAULT_EMBEDDING_PROVIDER_ID, describeEmbeddingSpace,
  detectReindexNeeded, DeterministicTestEmbeddingProvider, embeddingSpaceOf, isVectorCapable, NoopEmbeddingProvider,
  rebuildRetrievalIndex, resolveEmbeddingProvider, sameEmbeddingSpace, TOKEN_HASH_MODEL, vectorSearch,
  type EmbeddingProvider, type EmbeddingSpace,
} from "../src/retrieval/index.js";

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const seedTranscript = () =>
  importTranscript(db, { filename: "t.txt", rawText: `Alex: SQLite is the source of truth.
Sam: Markdown files are readable views only.
Jordan: Vector similarity finds candidates.` });

const documentCount = () => (db.prepare("SELECT COUNT(*) c FROM retrieval_documents").get() as { c: number }).c;

describe("embedding space metadata and compatibility", () => {
  it("derives a (provider, model, dimension) descriptor from a provider", () => {
    expect(embeddingSpaceOf(new DeterministicTestEmbeddingProvider(32))).toEqual({
      provider: "deterministic-test", model: "token-hash-v1", dimensions: 32,
    });
    expect(embeddingSpaceOf(new DeterministicTestEmbeddingProvider(24)).dimensions).toBe(24);
    expect(embeddingSpaceOf(new NoopEmbeddingProvider())).toEqual({ provider: "noop", model: "disabled", dimensions: 0 });
  });

  it("compares spaces strictly on provider, model, and dimensions", () => {
    const base: EmbeddingSpace = { provider: "deterministic-test", model: "token-hash-v1", dimensions: 32 };
    expect(sameEmbeddingSpace(base, { ...base })).toBe(true);
    expect(sameEmbeddingSpace(base, { ...base, dimensions: 24 })).toBe(false);
    expect(sameEmbeddingSpace(base, { ...base, model: "other" })).toBe(false);
    expect(sameEmbeddingSpace(base, { ...base, provider: "openai" })).toBe(false);
  });

  it("asserts compatibility and rejects mixing across spaces", () => {
    const a: EmbeddingSpace = { provider: "deterministic-test", model: "token-hash-v1", dimensions: 32 };
    expect(() => assertCompatibleEmbeddingSpace(a, { ...a })).not.toThrow();
    expect(() => assertCompatibleEmbeddingSpace(a, { ...a, dimensions: 24 })).toThrow(ValidationError);
    expect(() => assertCompatibleEmbeddingSpace(a, { ...a, model: "v2" })).toThrow(ValidationError);
    expect(() => assertCompatibleEmbeddingSpace(a, { ...a, provider: "openai" })).toThrow(ValidationError);
  });

  it("describes a space and reports vector capability", () => {
    expect(describeEmbeddingSpace({ provider: "deterministic-test", model: "token-hash-v1", dimensions: 32 })).toBe("deterministic-test/token-hash-v1@32");
    expect(isVectorCapable({ provider: "deterministic-test", model: "token-hash-v1", dimensions: 32 })).toBe(true);
    expect(isVectorCapable(embeddingSpaceOf(new NoopEmbeddingProvider()))).toBe(false);
  });
});

describe("provider registry and default fallback", () => {
  it("defaults to the local token-hash-v1 provider", () => {
    const resolution = resolveEmbeddingProvider();
    expect(resolution.requestedId).toBe(DEFAULT_EMBEDDING_PROVIDER_ID);
    expect(resolution.usedFallback).toBe(false);
    expect(resolution.provider.name).toBe("deterministic-test");
    expect(resolution.provider.model).toBe(TOKEN_HASH_MODEL);
  });

  it("resolves the noop provider without marking it a fallback", () => {
    const resolution = resolveEmbeddingProvider("noop");
    expect(resolution.usedFallback).toBe(false);
    expect(resolution.provider.dimensions).toBe(0);
  });

  it("falls back to token-hash-v1 for not-yet-available providers, flagged as fallback", () => {
    const resolution = resolveEmbeddingProvider("anthropic");
    expect(resolution.usedFallback).toBe(true);
    expect(resolution.requestedId).toBe("anthropic");
    expect(resolution.provider.model).toBe(TOKEN_HASH_MODEL);
    expect(resolution.reason).toContain(TOKEN_HASH_MODEL);
  });

  it("honors a custom dimension and stays deterministic", async () => {
    expect(resolveEmbeddingProvider(undefined, { dimensions: 16 }).provider.dimensions).toBe(16);
    const provider = createEmbeddingProvider();
    const reference = new DeterministicTestEmbeddingProvider();
    expect(await provider.embedTexts(["SQLite"]))
      .toEqual(await reference.embedTexts(["SQLite"]));
  });
});

describe("no mixing vectors across incompatible providers/models", () => {
  it("returns no vector matches when the query space differs from the indexed space", async () => {
    seedTranscript();
    const indexed = new DeterministicTestEmbeddingProvider(24);
    await rebuildRetrievalIndex(db, { embeddingProvider: indexed });

    // Same query, but a different dimension -> incompatible space -> no matches.
    const differentDimension = new DeterministicTestEmbeddingProvider(32);
    expect(await vectorSearch(db, { query: "SQLite", embeddingProvider: differentDimension })).toEqual([]);

    // Same dimension but a different model id -> still incompatible -> no matches.
    const differentModel: EmbeddingProvider = {
      name: "deterministic-test", model: "token-hash-v2", dimensions: 24,
      embedTexts: (texts) => indexed.embedTexts(texts),
    };
    expect(await vectorSearch(db, { query: "SQLite", embeddingProvider: differentModel })).toEqual([]);

    // Matching space still works (control).
    expect((await vectorSearch(db, { query: "SQLite", embeddingProvider: indexed })).length).toBeGreaterThan(0);
  });
});

describe("reindex-needed detection on provider/model change", () => {
  it("flags reindex when documents exist but are not embedded under the active space", async () => {
    seedTranscript();
    await rebuildRetrievalIndex(db); // keyword-only: documents but no embeddings
    const assessment = detectReindexNeeded(db, new DeterministicTestEmbeddingProvider(24));
    expect(assessment.documentCount).toBe(documentCount());
    expect(assessment.documentCount).toBeGreaterThan(0);
    expect(assessment.embeddedUnderActive).toBe(0);
    expect(assessment.missingUnderActive).toBe(assessment.documentCount);
    expect(assessment.indexedSpaces).toEqual([]);
    expect(assessment.needsReindex).toBe(true);
  });

  it("reports no reindex once everything is embedded under the active space", async () => {
    seedTranscript();
    const provider = new DeterministicTestEmbeddingProvider(24);
    await rebuildRetrievalIndex(db, { embeddingProvider: provider });
    const assessment = detectReindexNeeded(db, provider);
    expect(assessment.needsReindex).toBe(false);
    expect(assessment.missingUnderActive).toBe(0);
    expect(assessment.embeddedUnderActive).toBe(assessment.documentCount);
    expect(assessment.indexedSpaces).toEqual([{ provider: "deterministic-test", model: "token-hash-v1", dimensions: 24, count: assessment.documentCount }]);
    expect(assessment.foreignSpaces).toEqual([]);
  });

  it("flags reindex and surfaces the foreign space when the provider/model changes", async () => {
    seedTranscript();
    await rebuildRetrievalIndex(db, { embeddingProvider: new DeterministicTestEmbeddingProvider(24) });
    const assessment = detectReindexNeeded(db, new DeterministicTestEmbeddingProvider(32));
    expect(assessment.needsReindex).toBe(true);
    expect(assessment.embeddedUnderActive).toBe(0);
    expect(assessment.missingUnderActive).toBe(assessment.documentCount);
    expect(assessment.foreignSpaces).toEqual([{ provider: "deterministic-test", model: "token-hash-v1", dimensions: 24, count: assessment.documentCount }]);
    expect(assessment.reasons.join(" ")).toContain("ignored by vector search");
  });

  it("treats a 0-dimension (disabled) provider as not needing reindex", async () => {
    seedTranscript();
    await rebuildRetrievalIndex(db, { embeddingProvider: new DeterministicTestEmbeddingProvider(24) });
    const assessment = detectReindexNeeded(db, new NoopEmbeddingProvider());
    expect(assessment.vectorCapable).toBe(false);
    expect(assessment.needsReindex).toBe(false);
    expect(assessment.reasons.join(" ")).toContain("disabled");
  });

  it("does not require reindex when there are no indexed documents", () => {
    const assessment = detectReindexNeeded(db, new DeterministicTestEmbeddingProvider(24));
    expect(assessment.documentCount).toBe(0);
    expect(assessment.needsReindex).toBe(false);
  });
});
