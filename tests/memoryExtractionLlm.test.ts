import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import {
  createLlmMemoryExtractor, DeterministicRuleExtractor, extractMemoryObjectsForTranscript, MemoryExtractionError,
  parseAndGroundMemoryCandidates, type ExtractionWindow,
} from "../src/memory/extraction/index.js";
import { ExternalLlmProvider, type LlmCompletion, type LlmRequest, type LlmTransport } from "../src/llm/index.js";
import { MockLlmProvider } from "../src/llm/testing.js";

const SECRET = "sk-extract-PLANTED-SECRET-1234567890";

const window = (text = "We decided to use SQLite as the source of truth."): ExtractionWindow => ({
  transcriptId: "tr_x", windowId: "win_x",
  spans: [{ transcriptId: "tr_x", turnId: null, spanId: "sp_1", speaker: "Alex", startOffset: 0, endOffset: text.length, text, startTimeMs: null, endTimeMs: null }],
  text: `[span_id=sp_1 speaker=Alex]\n${text}`,
});

const objectsJson = (objects: unknown[]) => JSON.stringify({ objects });
const fixedMock = (text: string) => new MockLlmProvider({ completion: { provider: "mock", model: "mock", text, finishReason: "stop" } });
const fallback = () => new DeterministicRuleExtractor();

// Extract span id + first text line from a prompt / user message (content-derived span ids).
const firstSpan = (prompt: string) => {
  const m = prompt.match(/\[span_id=(\S+) speaker=[^\]]*\]\n([^\n]+)/);
  return { spanId: m?.[1] ?? "unknown", text: m?.[2] ?? "" };
};

describe("parseAndGroundMemoryCandidates", () => {
  const w = window();

  it("keeps a grounded candidate and ignores the LLM confidence", () => {
    const grounded = parseAndGroundMemoryCandidates(objectsJson([
      { type: "decision", title: "Use SQLite", body: "The team chose SQLite.", evidenceSpanIds: ["sp_1"], supportingQuote: "source of truth", confidence: 0.99 },
    ]), w);
    expect(grounded).toEqual([{ type: "decision", title: "Use SQLite", body: "The team chose SQLite.", evidenceSpanIds: ["sp_1"], confidence: 0, reason: "source of truth" }]);
  });

  it("discards unanchored, out-of-window, and missing-quote candidates", () => {
    const grounded = parseAndGroundMemoryCandidates(objectsJson([
      { type: "decision", title: "anchored", body: "b", evidenceSpanIds: ["sp_1"], supportingQuote: "use SQLite" },
      { type: "decision", title: "unanchored", body: "b", evidenceSpanIds: ["sp_1"], supportingQuote: "the moon is made of cheese" },
      { type: "decision", title: "out of window", body: "b", evidenceSpanIds: ["sp_999"], supportingQuote: "use SQLite" },
      { type: "decision", title: "no quote", body: "b", evidenceSpanIds: ["sp_1"] },
      { type: "bogus", title: "bad type", body: "b", evidenceSpanIds: ["sp_1"], supportingQuote: "use SQLite" },
    ]), w);
    expect(grounded.map((c) => c.title)).toEqual(["anchored"]);
  });

  it("throws on malformed JSON or a missing objects array", () => {
    expect(() => parseAndGroundMemoryCandidates("not json", w)).toThrow(MemoryExtractionError);
    expect(() => parseAndGroundMemoryCandidates(JSON.stringify({ notObjects: [] }), w)).toThrow(MemoryExtractionError);
  });
});

describe("createLlmMemoryExtractor falls back to deterministic for that window", () => {
  const w = window();
  const deterministicReason = "Deterministic rule match";

  it("returns the grounded LLM candidate when valid", async () => {
    const provider = fixedMock(objectsJson([{ type: "decision", title: "Use SQLite", body: "Chose SQLite.", evidenceSpanIds: ["sp_1"], supportingQuote: "source of truth" }]));
    const out = await createLlmMemoryExtractor(provider, { fallback: fallback() }).extract(w);
    expect(out).toEqual([{ type: "decision", title: "Use SQLite", body: "Chose SQLite.", evidenceSpanIds: ["sp_1"], confidence: 0, reason: "source of truth" }]);
  });

  it("falls back on malformed JSON, empty output, and all-discarded output", async () => {
    for (const text of ["not json", objectsJson([]), objectsJson([{ type: "decision", title: "x", body: "b", evidenceSpanIds: ["sp_1"], supportingQuote: "not present here" }])]) {
      const out = await createLlmMemoryExtractor(fixedMock(text), { fallback: fallback() }).extract(w);
      expect(out.length).toBeGreaterThan(0);
      expect(out.every((c) => c.reason === deterministicReason)).toBe(true);
    }
  });

  it("falls back on a provider error", async () => {
    const provider = new MockLlmProvider({ error: new Error("provider exploded") });
    const out = await createLlmMemoryExtractor(provider, { fallback: fallback() }).extract(w);
    expect(out.every((c) => c.reason === deterministicReason)).toBe(true);
  });

  it("falls back on a timeout (fake timers, no real network)", async () => {
    vi.useFakeTimers();
    const hanging: LlmTransport = (req) => new Promise((_resolve, reject) => { req.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); });
    const provider = new ExternalLlmProvider({ id: "openai", model: "gpt-4o-mini", apiKey: SECRET, transport: hanging });
    const promise = createLlmMemoryExtractor(provider, { fallback: fallback(), timeoutMs: 1000 }).extract(w);
    await vi.advanceTimersByTimeAsync(1000);
    const out = await promise;
    vi.useRealTimers();
    expect(out.every((c) => c.reason === deterministicReason)).toBe(true);
  });
});

describe("full pipeline: LLM extraction stores needs_review with audit metadata", () => {
  let db: SqliteDatabase;
  beforeEach(() => { db = openDatabase(":memory:"); });
  afterEach(() => db.close());

  const seed = () => importTranscript(db, { filename: "m.txt", rawText: "Alex: We decided to use SQLite as the source of truth.", sourceType: "test" }).transcriptId;

  const llmExtractor = (objectsFor: (spanId: string, text: string) => unknown[]) =>
    createLlmMemoryExtractor(new MockLlmProvider({
      completion: (req: LlmRequest): LlmCompletion => {
        const { spanId, text } = firstSpan(req.prompt);
        return { provider: "mock", model: "mock", text: objectsJson(objectsFor(spanId, text)), finishReason: "stop" };
      },
    }), { fallback: fallback() });

  it("stores a grounded LLM candidate as needs_review and records the supportingQuote", async () => {
    const transcriptId = seed();
    const extractor = llmExtractor((id, text) => [{ type: "decision", title: "Use SQLite as source of truth", body: "The team chose SQLite.", evidenceSpanIds: [id], supportingQuote: text }]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    expect(result.objectsInserted).toBe(1);
    const row = db.prepare("SELECT extraction_status, generated_text, metadata_json FROM memory_objects WHERE extraction_run_id=?").get(result.extractionRunId) as { extraction_status: string; generated_text: string; metadata_json: string };
    expect(row.extraction_status).toBe("needs_review");
    expect(row.generated_text).toBe("The team chose SQLite.");
    expect(JSON.parse(row.metadata_json).extraction_reason).toContain("SQLite as the source of truth");
  });

  it("never promotes an LLM candidate to active even with high reported confidence", async () => {
    const transcriptId = seed();
    const extractor = llmExtractor((id, text) => [{ type: "decision", title: "Use SQLite as source of truth", body: "Chose SQLite.", evidenceSpanIds: [id], supportingQuote: text, confidence: 0.99 }]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    const statuses = db.prepare("SELECT extraction_status FROM memory_objects WHERE extraction_run_id=?").all(result.extractionRunId) as Array<{ extraction_status: string }>;
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((s) => s.extraction_status === "needs_review")).toBe(true);
    expect(statuses.some((s) => s.extraction_status === "active")).toBe(false);
  });

  it("leaves deterministic extraction unchanged (can still auto-promote to active)", async () => {
    const transcriptId = seed();
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor: new DeterministicRuleExtractor() });
    const statuses = db.prepare("SELECT extraction_status FROM memory_objects WHERE extraction_run_id=?").all(result.extractionRunId) as Array<{ extraction_status: string }>;
    expect(statuses.some((s) => s.extraction_status === "active")).toBe(true);
  });

  it("records the LLM prompt version on the run and objects for LLM extraction", async () => {
    const transcriptId = seed();
    const extractor = llmExtractor((id, text) => [{ type: "decision", title: "Use SQLite as source of truth", body: "Chose SQLite.", evidenceSpanIds: [id], supportingQuote: text }]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    const run = db.prepare("SELECT prompt_version FROM extraction_runs WHERE id=?").get(result.extractionRunId) as { prompt_version: string };
    expect(run.prompt_version).toBe("mvp-memory-extraction-llm-v1");
    const object = db.prepare("SELECT prompt_version FROM memory_objects WHERE extraction_run_id=?").get(result.extractionRunId) as { prompt_version: string };
    expect(object.prompt_version).toBe("mvp-memory-extraction-llm-v1");
  });

  it("keeps the deterministic prompt version for deterministic extraction", async () => {
    const transcriptId = seed();
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor: new DeterministicRuleExtractor() });
    const run = db.prepare("SELECT prompt_version FROM extraction_runs WHERE id=?").get(result.extractionRunId) as { prompt_version: string };
    expect(run.prompt_version).toBe("mvp-memory-extraction-v1");
  });

  it("does not leak the API key into any persisted row when using a real external provider", async () => {
    const transcriptId = seed();
    const transport: LlmTransport = async (req) => {
      const body = JSON.parse(req.body) as { messages: Array<{ content: string }> };
      const { spanId, text } = firstSpan(body.messages[body.messages.length - 1].content);
      return { status: 200, body: { choices: [{ message: { content: objectsJson([{ type: "decision", title: "Use SQLite", body: "Chose SQLite.", evidenceSpanIds: [spanId], supportingQuote: text }]) }, finish_reason: "stop" }] } };
    };
    const provider = new ExternalLlmProvider({ id: "openai", model: "gpt-4o-mini", apiKey: SECRET, transport });
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor: createLlmMemoryExtractor(provider, { fallback: fallback() }) });
    expect(result.objectsInserted).toBe(1);
    const dump = JSON.stringify([
      db.prepare("SELECT * FROM memory_objects").all(),
      db.prepare("SELECT * FROM memory_object_evidence").all(),
      db.prepare("SELECT * FROM extraction_runs").all(),
    ]);
    expect(dump).not.toContain(SECRET);
  });
});
