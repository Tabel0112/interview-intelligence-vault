import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";
import { createLlmAskAILanguageModel, SynthesisFailedError, SynthesisSetupRequiredError } from "../src/ask-ai/index.js";
import { createLlmMemoryExtractor } from "../src/memory/index.js";
import { ExternalLlmProvider, type LlmTransport } from "../src/llm/index.js";
import { MockLlmProvider } from "../src/llm/testing.js";
import type { LlmCompletion, LlmRequest } from "../src/llm/index.js";

const RAW = "Alex: We decided to use SQLite as the source of truth for the vault.";
const SECRET = "sk-required-PLANTED-SECRET-1234567890";
const now = () => new Date("2026-06-12T12:00:00.000Z");

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const memoryCount = () => (db.prepare("SELECT COUNT(*) c FROM memory_objects").get() as { c: number }).c;
const runCount = () => (db.prepare("SELECT COUNT(*) c FROM ask_ai_runs").get() as { c: number }).c;

async function seedEvidence() {
  const repos = createRepositories(db);
  const imported = importTranscript(db, { filename: "t.txt", rawText: RAW });
  const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string };
  const memory = repos.memoryObjects.createMemoryObject(
    { type: "decision", generated_text: "SQLite is authoritative.", confidence: 0.95, created_by: "agent" },
    [{ span_id: span.id, role: "supports", evidence_score: 0.95 }],
  );
  const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.95 });
  await indexEvidencePointerForSearch(db, pointer.evidence_pointer_id);
}

const groundedExtractor = () => {
  const provider = new MockLlmProvider({
    completion: (req: LlmRequest): LlmCompletion => {
      const m = req.prompt.match(/\[span_id=(\S+) speaker=[^\]]*\]\n([^\n]+)/);
      const objects = [{ type: "decision", title: "Use SQLite as source of truth", body: "The team chose SQLite.", evidenceSpanIds: [m?.[1] ?? "x"], supportingQuote: m?.[2] ?? "", confidence: 0.9 }];
      return { provider: "mock", model: "mock", text: JSON.stringify({ objects }), finishReason: "stop" };
    },
  });
  return createLlmMemoryExtractor(provider); // no fallback
};

describe("LLM-required live frontend behavior", () => {
  it("imports the raw transcript but skips extraction (no fake memory) when no LLM is configured", async () => {
    const api = createSqliteFrontendApi(db, { llmRequired: true }); // no getMemoryExtractor
    const result = await api.uploadTranscript({ filename: "t.txt", rawText: RAW });
    expect(result.status).toBe("imported");
    expect(result.warning).toMatch(/configured LLM/i);
    expect((db.prepare("SELECT COUNT(*) c FROM transcripts").get() as { c: number }).c).toBe(1); // raw preserved
    expect(memoryCount()).toBe(0); // no deterministic/fake memory
    expect((db.prepare("SELECT COUNT(*) c FROM extraction_runs").get() as { c: number }).c).toBe(0);
  });

  it("Ask AI refuses with setup-required (no answer) when no LLM is configured", async () => {
    await seedEvidence();
    const api = createSqliteFrontendApi(db, { llmRequired: true, now }); // no getSynthesis
    await expect(api.ask("What is the source of truth?")).rejects.toBeInstanceOf(SynthesisSetupRequiredError);
    expect(runCount()).toBe(0); // no fake answer
  });

  it("Ask AI shows a generic failure (no fake answer) when the configured LLM fails after evidence is selected", async () => {
    await seedEvidence();
    const transport: LlmTransport = async () => ({ status: 500, body: { error: "upstream" } });
    const provider = new ExternalLlmProvider({ id: "openai", model: "gpt-4o-mini", apiKey: SECRET, transport });
    const getSynthesis = () => ({ llm: createLlmAskAILanguageModel(provider), info: { mode: "external_llm" as const, provider: "openai", model: "gpt-4o-mini", usedFallback: false } });
    const api = createSqliteFrontendApi(db, { llmRequired: true, now, getSynthesis });
    await expect(api.ask("What is the source of truth?")).rejects.toBeInstanceOf(SynthesisFailedError);
    expect(runCount()).toBe(0);
  });

  it("getLlmStatus reflects current readiness", async () => {
    expect(await createSqliteFrontendApi(db, { llmRequired: true, getLlmReady: () => false }).getLlmStatus()).toEqual({ required: true, ready: false });
    expect(await createSqliteFrontendApi(db, { llmRequired: true, getLlmReady: () => true }).getLlmStatus()).toEqual({ required: true, ready: true });
  });

  it("runExtraction is setup-required without an LLM, then extracts once configured", async () => {
    const uploadApi = createSqliteFrontendApi(db, { llmRequired: true });
    const uploaded = await uploadApi.uploadTranscript({ filename: "t.txt", rawText: RAW });
    expect(memoryCount()).toBe(0);

    expect((await uploadApi.runExtraction(uploaded.transcriptId)).status).toBe("setup_required");
    expect(memoryCount()).toBe(0);

    const configured = createSqliteFrontendApi(db, { llmRequired: true, getMemoryExtractor: groundedExtractor });
    expect((await configured.runExtraction(uploaded.transcriptId)).status).toBe("extracted");
    expect(memoryCount()).toBeGreaterThan(0);
    // Re-running is a no-op once a completed run exists.
    expect((await configured.runExtraction(uploaded.transcriptId)).status).toBe("skipped");
  });
});
