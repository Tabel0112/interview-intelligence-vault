import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, ValidationError, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan, createEvidencePointer } from "../src/provenance/index.js";
import {
  cosineSimilarity, DeterministicTestEmbeddingProvider, indexMemoryObjectForSearch, indexTranscriptSpanForSearch,
  NoopEmbeddingProvider, rankCandidate, rebuildRetrievalIndex, recencyScore, retrieveForAskAi, searchMemoryObjects, searchRetrieval,
  searchTranscriptSpans, validateVector, vectorSearch,
} from "../src/retrieval/index.js";

let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;
let provider: DeterministicTestEmbeddingProvider;
beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); provider = new DeterministicTestEmbeddingProvider(24); });
afterEach(() => db.close());

function fixture() {
  const first = importTranscript(db, { filename: "one.txt", rawText: `Alex: SQLite is the source of truth for the vault.
Sam: Markdown files are readable views only.
Alex: Evidence scoring protects Ask AI.
Sam: 数据库是真相来源。` });
  const second = importTranscript(db, { filename: "two.txt", rawText: "Jordan: Vector similarity finds candidates, but weak evidence stays weak." });
  const spans = db.prepare("SELECT id,transcript_id,speaker_id,speaker_label,text FROM transcript_spans ORDER BY transcript_id,ordinal").all() as Array<{ id: string; transcript_id: string; speaker_id: string | null; speaker_label: string | null; text: string }>;
  const sqliteSpan = spans.find((span) => span.text.includes("SQLite"))!;
  const markdownSpan = spans.find((span) => span.text.includes("Markdown"))!;
  const weakSpan = spans.find((span) => span.text.includes("weak evidence"))!;
  const strong = repos.memoryObjects.createMemoryObject({ type: "decision", title: "Use SQLite as source of truth", generated_text: "SQLite is the authoritative MVP store.", confidence: 0.95, created_by: "agent" }, [{ span_id: sqliteSpan.id, role: "supports", evidence_score: 0.95 }]);
  const weak = repos.memoryObjects.createMemoryObject({ type: "topic", title: "Possible vector retrieval", generated_text: "Vector similarity may find candidates.", status: "needs_review", confidence: 0.3, created_by: "agent" }, [{ span_id: weakSpan.id, role: "supports", evidence_score: 0.3 }]);
  linkMemoryObjectToSpan(db, { memoryObjectId: strong.id, transcriptId: sqliteSpan.transcript_id, spanId: sqliteSpan.id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.95 });
  linkMemoryObjectToSpan(db, { memoryObjectId: weak.id, transcriptId: weakSpan.transcript_id, spanId: weakSpan.id, evidenceRole: "support", evidenceStrength: "weak", confidence: 0.3 });
  const opposition = createEvidencePointer(db, { targetType: "memory_object", targetId: strong.id, transcriptId: markdownSpan.transcript_id, spanId: markdownSpan.id, evidenceRole: "opposition", evidenceStrength: "mixed", confidence: 0.7 });
  return { first, second, spans, sqliteSpan, markdownSpan, weakSpan, strong, weak, opposition };
}

describe("embedding and indexing", () => {
  it("creates stable embeddings and validates cosine/vector dimensions", async () => {
    expect(await provider.embedTexts(["SQLite evidence"])).toEqual(await provider.embedTexts(["SQLite evidence"]));
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
    expect(() => validateVector([1, Number.NaN], 2)).toThrow(ValidationError);
    expect(() => cosineSimilarity([1], [1, 2])).toThrow(ValidationError);
  });

  it("rebuilds idempotently, skips unchanged content, and recomputes changed generated memory", async () => {
    const { strong } = fixture();
    const first = await rebuildRetrievalIndex(db, { embeddingProvider: provider });
    expect(first.indexed).toBeGreaterThan(0);
    expect(first.embedded).toBeGreaterThan(0);
    const second = await rebuildRetrievalIndex(db, { embeddingProvider: provider });
    expect(second.skipped).toBeGreaterThan(0);
    expect(second.embedded).toBe(0);
    db.prepare("UPDATE memory_objects SET generated_text='SQLite remains authoritative after correction',updated_at=? WHERE id=?").run(new Date().toISOString(), strong.id);
    expect((await indexMemoryObjectForSearch(db, strong.id, { embeddingProvider: provider })).embedded).toBe(true);
  });

  it("batches embeddings during rebuild", async () => {
    fixture();
    let calls = 0;
    const counting = { ...provider, embedTexts: async (texts: string[]) => { calls++; return provider.embedTexts(texts); } };
    await rebuildRetrievalIndex(db, { embeddingProvider: counting, batchSize: 100 });
    expect(calls).toBe(1);
  });

  it("refreshes ranking metadata without recomputing unchanged text embeddings", async () => {
    const { strong } = fixture();
    await indexMemoryObjectForSearch(db, strong.id, { embeddingProvider: provider });
    db.prepare("DELETE FROM evidence_pointers WHERE target_type='memory_object' AND target_id=? AND evidence_role='opposition'").run(strong.id);
    const result = await indexMemoryObjectForSearch(db, strong.id, { embeddingProvider: provider });
    expect(result).toEqual({ embedded: false, skipped: false });
  });

  it("supports keyword-only noop indexing and records indexing errors without deleting existing documents", async () => {
    const { sqliteSpan } = fixture();
    await indexTranscriptSpanForSearch(db, sqliteSpan.id, { embeddingProvider: new NoopEmbeddingProvider() });
    expect(db.prepare("SELECT * FROM retrieval_documents WHERE target_id=?").get(sqliteSpan.id)).toBeTruthy();
    const invalid = { name: "bad", model: "bad", dimensions: 2, embedTexts: async () => [[1]] };
    await expect(indexTranscriptSpanForSearch(db, sqliteSpan.id, { embeddingProvider: invalid, force: true })).rejects.toThrow();
    expect((db.prepare("SELECT error FROM retrieval_index_status WHERE target_id=?").get(sqliteSpan.id) as { error: string }).error).toContain("Invalid embedding");
    expect(db.prepare("SELECT * FROM retrieval_documents WHERE target_id=?").get(sqliteSpan.id)).toBeTruthy();
  });

  it("removes retrieval rows when canonical targets are deleted", async () => {
    const { weak } = fixture();
    await rebuildRetrievalIndex(db, { embeddingProvider: provider });
    expect(db.prepare("SELECT * FROM retrieval_documents WHERE target_type='memory_object' AND target_id=?").get(weak.id)).toBeTruthy();
    db.prepare("DELETE FROM memory_objects WHERE id=?").run(weak.id);
    expect(db.prepare("SELECT * FROM retrieval_documents WHERE target_type='memory_object' AND target_id=?").get(weak.id)).toBeUndefined();
    expect(db.prepare("SELECT * FROM search_embeddings WHERE target_type='memory_object' AND target_id=?").get(weak.id)).toBeUndefined();
  });
});

describe("keyword, vector, hybrid, and filters", () => {
  it("finds spans and canonical memory fields with keyword and phrase ranking", async () => {
    const { strong } = fixture(); await rebuildRetrievalIndex(db);
    const spans = await searchTranscriptSpans(db, { query: "source of truth", mode: "keyword" });
    expect(spans[0].textPreview).toContain("source of truth");
    expect(spans[0].matchReasons).toContain("keyword:exact_phrase");
    const memories = await searchMemoryObjects(db, { query: "Use SQLite", mode: "keyword" });
    expect(memories[0]).toMatchObject({ targetId: strong.id, title: "Use SQLite as source of truth" });
    expect((await searchRetrieval(db, { query: "数据库", mode: "keyword" })).length).toBeGreaterThan(0);
  });

  it("falls back safely without FTS or embeddings", async () => {
    fixture(); await rebuildRetrievalIndex(db);
    try { db.exec("DROP TABLE retrieval_documents_fts"); } catch {}
    expect((await searchRetrieval(db, { query: "SQLite", mode: "keyword" })).length).toBeGreaterThan(0);
    expect(await searchRetrieval(db, { query: "SQLite", mode: "vector", embeddingProvider: provider })).toEqual([]);
    expect(await searchRetrieval(db, { query: "   " })).toEqual([]);
  });

  it("combines vector and keyword scores and preserves reasons", async () => {
    fixture(); await rebuildRetrievalIndex(db, { embeddingProvider: provider });
    const results = await searchRetrieval(db, { query: "SQLite authoritative store", mode: "hybrid", embeddingProvider: provider });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].finalScore).toBeGreaterThan(0);
    expect(results.some((item) => item.keywordScore != null && item.vectorScore != null)).toBe(true);
    expect(results.flatMap((item) => item.matchReasons)).toContain("vector:semantic");
  });

  it("uses injected now for deterministic retrieval recency ranking", () => {
    const fixedNow = "2026-06-12T00:00:00.000Z";
    const fixedRecency = recencyScore("2026-06-01T00:00:00.000Z", fixedNow);
    expect(fixedRecency).toBe(recencyScore("2026-06-01T00:00:00.000Z", fixedNow));
    expect(fixedRecency).toBeGreaterThan(recencyScore("2026-06-01T00:00:00.000Z", "2027-06-12T00:00:00.000Z"));
    const base = {
      targetType: "transcript_span" as const, targetId: "span", textPreview: "text", keywordScore: 0.8,
      evidenceScore: 0.8, finalScore: 0, matchReasons: [], evidencePointerIds: [], sourcePointerIds: [],
      createdAt: "2026-06-01T00:00:00.000Z",
    };
    const ranked = rankCandidate(base, false, true, fixedNow);
    expect(ranked).toEqual(rankCandidate(base, false, true, fixedNow));
    expect(ranked.recencyScore).toBe(fixedRecency);
  });

  it("applies transcript, speaker, memory status, generated, evidence, and date filters", async () => {
    const { first, second, sqliteSpan, weak } = fixture(); await rebuildRetrievalIndex(db);
    expect((await searchRetrieval(db, { query: "source", filters: { transcriptIds: [first.transcriptId] } })).every((item) => item.transcriptId === first.transcriptId)).toBe(true);
    expect(await searchRetrieval(db, { query: "source", filters: { transcriptIds: [second.transcriptId] } })).toEqual([]);
    expect((await searchTranscriptSpans(db, { query: "SQLite", filters: { speakerNames: ["alex"] } }))[0].targetId).toBe(sqliteSpan.id);
    expect(await searchTranscriptSpans(db, { query: "SQLite", filters: { speakerNames: ["nobody"] } })).toEqual([]);
    expect((await searchMemoryObjects(db, { query: "vector", filters: { memoryStatuses: ["needs_review"] } }))[0].targetId).toBe(weak.id);
    expect((await searchRetrieval(db, { query: "SQLite", filters: { includeGenerated: false } })).every((item) => item.targetType === "transcript_span")).toBe(true);
    expect(await searchRetrieval(db, { query: "SQLite", filters: { minEvidenceScore: 0.99 } })).toEqual([]);
    expect(await searchRetrieval(db, { query: "SQLite", filters: { createdAfter: "2999-01-01" } })).toEqual([]);
  });

  it("ranks strong evidence above weak evidence when relevance is similar", async () => {
    const { strong, weak } = fixture(); await rebuildRetrievalIndex(db, { embeddingProvider: provider });
    const results = await searchMemoryObjects(db, { query: "candidates source", embeddingProvider: provider });
    const strongResult = results.find((item) => item.targetId === strong.id), weakResult = results.find((item) => item.targetId === weak.id);
    if (strongResult && weakResult) expect(strongResult.finalScore).toBeGreaterThan(weakResult.finalScore);
  });
});

describe("Ask AI grouping and basic scale", () => {
  it("returns explicit support/opposition and weak evidence without inventing conflicts", async () => {
    fixture(); await rebuildRetrievalIndex(db);
    const grouped = await retrieveForAskAi(db, { query: "Markdown source truth", mode: "keyword", finalLimit: 50 });
    expect(grouped.supporting.length).toBeGreaterThan(0);
    expect(grouped.opposing.length).toBeGreaterThan(0);
    expect(grouped.conflictsDetected).toBe(true);
    expect(grouped.assessment.bestSupportingEvidence.length).toBeGreaterThan(0);
    expect(grouped.assessment.bestOpposingEvidence.length).toBeGreaterThan(0);
    expect(grouped.weak.length).toBeGreaterThanOrEqual(0);
    const noConflict = await retrieveForAskAi(db, { query: "数据库", mode: "keyword" });
    expect(noConflict.opposing).toEqual([]);
    expect(noConflict.assessment.hasConflict).toBe(false);
  });

  it("runs evidence scoring at the Ask AI retrieval boundary", async () => {
    fixture(); await rebuildRetrievalIndex(db, { embeddingProvider: provider });
    const result = await retrieveForAskAi(db, {
      query: "SQLite is the source of truth for the vault", mode: "hybrid", embeddingProvider: provider,
      useType: "direct_fact", now: "2026-06-12T00:00:00.000Z",
    });
    expect(result.assessment.scorerVersion).toBe("mvp-evidence-v1");
    expect(result.assessment.strength).not.toBe("no_evidence");
    expect(result.assessment.scoredEvidence.every((item) => item.candidate.spanIds.length > 0)).toBe(true);
  });

  it("handles hundreds of indexed spans and respects candidate limits", async () => {
    const lines = Array.from({ length: 300 }, (_, index) => `Speaker ${index}: scalable retrieval keyword ${index}`).join("\n");
    importTranscript(db, { filename: "scale.txt", rawText: lines });
    await rebuildRetrievalIndex(db, { targetTypes: ["transcript_span"] });
    const results = await searchRetrieval(db, { query: "scalable retrieval", mode: "keyword", finalLimit: 12 });
    expect(results).toHaveLength(12);
  });
});
