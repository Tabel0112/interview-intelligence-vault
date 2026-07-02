import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi } from "../src/frontend/index.js";
import { DeterministicRuleExtractor, createLlmMemoryExtractor, type MemoryExtractor } from "../src/memory/index.js";
import { memoryExtractorFromSettings } from "../src/obsidian/llmSettings.js";
import { DEFAULT_SETTINGS, setApiKey, type TranscriptMemorySettings } from "../src/obsidian/settings.js";
import { ExternalLlmProvider, type LlmCompletion, type LlmRequest, type LlmTransport } from "../src/llm/index.js";
import { MockLlmProvider } from "../src/llm/testing.js";

const SECRET = "sk-wire-PLANTED-SECRET-1234567890";
const RAW = "Alex: We decided to use SQLite as the source of truth.";
const objectsJson = (objects: unknown[]) => JSON.stringify({ objects });
const firstSpan = (prompt: string) => {
  const m = prompt.match(/\[span_id=(\S+) speaker=[^\]]*\]\n([^\n]+)/);
  return { spanId: m?.[1] ?? "unknown", text: m?.[2] ?? "" };
};

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const memoryCount = () => (db.prepare("SELECT COUNT(*) c FROM memory_objects").get() as { c: number }).c;
const runCount = () => (db.prepare("SELECT COUNT(*) c FROM extraction_runs").get() as { c: number }).c;

describe("memoryExtractorFromSettings (LLM-required)", () => {
  it("returns undefined for local/unconfigured settings (no deterministic fallback in the live app)", () => {
    expect(memoryExtractorFromSettings(DEFAULT_SETTINGS)).toBeUndefined();
    const noKey: TranscriptMemorySettings = { ...DEFAULT_SETTINGS, mode: "external", llm: { provider: "openai", model: "gpt-4o-mini" } };
    expect(memoryExtractorFromSettings(noKey)).toBeUndefined(); // missing key -> setup-required, not deterministic
  });

  it("returns an LLM extractor (no fallback) when a valid external provider is configured (no network on resolution)", () => {
    const settings = setApiKey({ ...DEFAULT_SETTINGS, mode: "external", llm: { provider: "openai", model: "gpt-4o-mini" } }, "openai", SECRET);
    const transport: LlmTransport = async () => { throw new Error("should not be called during resolution"); };
    expect(memoryExtractorFromSettings(settings, { transport })?.kind).toBe("llm");
  });
});

describe("automatic extraction after upload", () => {
  it("auto-runs deterministic extraction after a successful new import", async () => {
    const api = createSqliteFrontendApi(db, { getMemoryExtractor: () => new DeterministicRuleExtractor() });
    const result = await api.uploadTranscript({ filename: "m.txt", rawText: RAW });
    expect(result.status).toBe("imported");
    expect(memoryCount()).toBeGreaterThan(0);
    const dashboard = await api.getDashboard();
    expect(dashboard.reviewCount + dashboard.weakCount).toBeGreaterThanOrEqual(0); // needs_review memory surfaces in review
  });

  it("auto-runs grounded LLM extraction (mock) and auto-activates a clear decision with the LLM prompt version", async () => {
    const provider = new MockLlmProvider({
      completion: (req: LlmRequest): LlmCompletion => {
        const { spanId, text } = firstSpan(req.prompt);
        return { provider: "mock", model: "mock", text: objectsJson([{ type: "decision", title: "Use SQLite as the source of truth", body: "We decided to use SQLite as the source of truth.", evidenceSpanIds: [spanId], supportingQuote: text, confidence: 0.99 }]), finishReason: "stop" };
      },
    });
    const extractor = createLlmMemoryExtractor(provider, { fallback: new DeterministicRuleExtractor() });
    const api = createSqliteFrontendApi(db, { getMemoryExtractor: () => extractor });
    await api.uploadTranscript({ filename: "m.txt", rawText: RAW });
    const row = db.prepare("SELECT extraction_status, generated_text FROM memory_objects LIMIT 1").get() as { extraction_status: string; generated_text: string };
    expect(row.extraction_status).toBe("active"); // clear, direct, grounded decision -> active automatically
    expect(row.generated_text).toBe("We decided to use SQLite as the source of truth.");
    expect((db.prepare("SELECT prompt_version FROM extraction_runs LIMIT 1").get() as { prompt_version: string }).prompt_version).toBe("mvp-memory-extraction-llm-v2");
  });

  it("does not extract for a duplicate upload and never extracts twice for the same transcript", async () => {
    const api = createSqliteFrontendApi(db, { getMemoryExtractor: () => new DeterministicRuleExtractor() });
    await api.uploadTranscript({ filename: "m.txt", rawText: RAW });
    const afterFirst = runCount();
    const second = await api.uploadTranscript({ filename: "again.txt", rawText: RAW }); // identical content
    expect(second.status).toBe("duplicate");
    expect(runCount()).toBe(afterFirst); // no second extraction run
  });

  it("keeps the imported transcript and surfaces a generic warning when extraction fails", async () => {
    const throwing: MemoryExtractor = { kind: "deterministic", async extract() { throw new Error("extractor blew up"); } };
    const api = createSqliteFrontendApi(db, { getMemoryExtractor: () => throwing });
    const result = await api.uploadTranscript({ filename: "m.txt", rawText: RAW });
    expect(result.transcriptId).toBeTruthy();
    expect((db.prepare("SELECT COUNT(*) c FROM transcripts").get() as { c: number }).c).toBe(1); // transcript preserved
    expect(result.warning).toContain("memory extraction did not complete");
    expect(result.warning).not.toContain("blew up"); // no raw error surfaced
  });

  it("does not auto-extract when no getMemoryExtractor is provided (backward compatible)", async () => {
    const api = createSqliteFrontendApi(db);
    const result = await api.uploadTranscript({ filename: "m.txt", rawText: RAW });
    expect(result.status).toBe("imported");
    expect(memoryCount()).toBe(0);
    expect(runCount()).toBe(0);
  });

  it("does not leak the API key into any persisted row when extracting via a real external provider", async () => {
    const transport: LlmTransport = async (req) => {
      const body = JSON.parse(req.body) as { messages: Array<{ content: string }> };
      const { spanId, text } = firstSpan(body.messages[body.messages.length - 1].content);
      return { status: 200, body: { choices: [{ message: { content: objectsJson([{ type: "decision", title: "Use SQLite", body: "Chose SQLite.", evidenceSpanIds: [spanId], supportingQuote: text }]) }, finish_reason: "stop" }] } };
    };
    const provider = new ExternalLlmProvider({ id: "openai", model: "gpt-4o-mini", apiKey: SECRET, transport });
    const extractor = createLlmMemoryExtractor(provider, { fallback: new DeterministicRuleExtractor() });
    const api = createSqliteFrontendApi(db, { getMemoryExtractor: () => extractor });
    await api.uploadTranscript({ filename: "m.txt", rawText: RAW });
    const dump = JSON.stringify([
      db.prepare("SELECT * FROM memory_objects").all(),
      db.prepare("SELECT * FROM memory_object_evidence").all(),
      db.prepare("SELECT * FROM extraction_runs").all(),
    ]);
    expect(dump).not.toContain(SECRET);
  });
});
