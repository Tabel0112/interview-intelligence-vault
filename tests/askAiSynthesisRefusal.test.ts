import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";
import {
  askAI, createDatabaseAskAIDependencies, createLlmAskAILanguageModel, SynthesisFailedError,
  type AskAIAnalysisModel, type AskAILanguageModel, type SynthesisInfo,
} from "../src/ask-ai/index.js";
import { ExternalLlmProvider, type LlmTransport } from "../src/llm/index.js";
import { toAnswerBundle } from "../src/mcp/answerBundle.js";

const now = () => new Date("2026-06-12T12:00:00.000Z");
const info: SynthesisInfo = { mode: "external_llm", provider: "openai", model: "gpt-4o-mini", usedFallback: false };
const PLANTED_KEY = "sk-refusal-PLANTED-SECRET-1234567890";

// Mock LLM seams (offline, no network):
const decliningLlm: AskAILanguageModel = { generateClaims: async () => [] }; // call succeeds, model declines (no grounded claims)
const throwingLlm: AskAILanguageModel = { generateClaims: async () => { throw new Error("provider exploded"); } }; // genuine failure
const groundedLlm: AskAILanguageModel = { // returns a claim grounded in the selected evidence
  generateClaims: async ({ evidence }) => evidence.length ? [{ kind: "fact", text: evidence[0].quotePreview, evidencePointerIds: [evidence[0].evidencePointerId] }] : [],
};
const throwingAnalysis: AskAIAnalysisModel = { analyze: async () => { throw new Error("analysis provider exploded"); } };
const okAnalysis: AskAIAnalysisModel = { analyze: async () => [{ kind: "recommendation", text: "Tighten onboarding." }] };

let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;
beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); });
afterEach(() => db.close());
const runCount = () => (db.prepare("SELECT COUNT(*) c FROM ask_ai_runs").get() as { c: number }).c;

async function seedSqliteEvidence() {
  const imported = importTranscript(db, { filename: "t.txt", rawText: "Alex: SQLite is the source of truth for the vault." });
  const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string };
  const memory = repos.memoryObjects.createMemoryObject(
    { type: "decision", generated_text: "SQLite is authoritative.", confidence: 0.95, created_by: "agent" },
    [{ span_id: span.id, role: "supports", evidence_score: 0.95 }],
  );
  const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.95 });
  await indexEvidencePointerForSearch(db, pointer.evidence_pointer_id);
}

describe("Ask AI: LLM decline vs genuine failure", () => {
  it("1. evidence selected but the LLM declines (returns []) -> safe no-evidence refusal, NOT llm_failed", async () => {
    await seedSqliteEvidence();
    const before = runCount();
    // The Firebase-style case: evidence is retrieved/selected, the LLM call SUCCEEDS but grounds nothing.
    const response = await askAI(
      { question: "What did we decide about SQLite?" },
      createDatabaseAskAIDependencies(db, { now, llm: decliningLlm, synthesisInfo: info, requireLlm: true }),
    );
    expect(response.notEnoughEvidence).toBe(true);
    expect(response.evidenceConfidence).toBe("no_evidence");
    expect(response.claims).toHaveLength(0);
    expect(response.answerMarkdown).toContain("don't have enough transcript-backed evidence");
    expect(runCount()).toBe(before + 1); // a refusal IS persisted (it is not a fake answer)
  });

  it("2. a no-evidence factual query refuses WITHOUT calling external synthesis", async () => {
    let calls = 0;
    const spyLlm: AskAILanguageModel = { generateClaims: async (i) => { calls++; return decliningLlm.generateClaims(i); } };
    const response = await askAI( // nothing seeded -> no evidence selected
      { question: "What did we decide about Firebase authentication?" },
      createDatabaseAskAIDependencies(db, { now, llm: spyLlm, synthesisInfo: info, requireLlm: true }),
    );
    expect(response.notEnoughEvidence).toBe(true);
    expect(calls).toBe(0); // no evidence -> the LLM is never called (deterministic refusal before synthesis)
  });

  it("3. genuine LLM failure (call throws) still maps to SynthesisFailedError and persists no fake answer", async () => {
    await seedSqliteEvidence();
    const before = runCount();
    await expect(askAI(
      { question: "What did we decide about SQLite?" },
      createDatabaseAskAIDependencies(db, { now, llm: throwingLlm, synthesisInfo: info, requireLlm: true }),
    )).rejects.toBeInstanceOf(SynthesisFailedError);
    expect(runCount()).toBe(before); // no answer persisted on a real failure
  });

  it("4. LLM failure never fabricates claims and the error is generic + key-free", async () => {
    await seedSqliteEvidence();
    const transport: LlmTransport = async () => ({ status: 401, body: { error: "bad key" } }); // provider rejects -> adapter throws
    const llm = createLlmAskAILanguageModel(new ExternalLlmProvider({ id: "openai", model: "gpt-4o-mini", apiKey: PLANTED_KEY, transport }));
    const promise = askAI({ question: "What did we decide about SQLite?" }, createDatabaseAskAIDependencies(db, { now, llm, synthesisInfo: info, requireLlm: true }));
    await expect(promise).rejects.toBeInstanceOf(SynthesisFailedError);
    await expect(promise).rejects.toThrow(/could not generate an answer/i); // generic message
    await expect(promise).rejects.not.toThrow(PLANTED_KEY); // never leaks the key
    expect(runCount()).toBe(0);
  });

  it("5. a supported query still succeeds with cited claims", async () => {
    await seedSqliteEvidence();
    const response = await askAI(
      { question: "What did we decide about SQLite?" },
      createDatabaseAskAIDependencies(db, { now, llm: groundedLlm, synthesisInfo: info, requireLlm: true }),
    );
    expect(response.notEnoughEvidence).toBe(false);
    expect(response.claims.length).toBeGreaterThan(0);
    expect(response.claims.every((c) => c.citationIds.length > 0)).toBe(true);
  });
});

describe("Ask AI: optional analysis degrades gracefully", () => {
  it("6. advice query whose AI analysis FAILS still returns a safe answer + analysisUnavailable warning", async () => {
    // Advice intent permits analysis; the analysis seam throws. The whole answer must NOT fail.
    const response = await askAI(
      { question: "What are the risks, conflicts, or uncertain ideas in this project?" },
      createDatabaseAskAIDependencies(db, { now, llm: decliningLlm, analysis: throwingAnalysis, synthesisInfo: info, requireLlm: true }),
    );
    expect(response.analysisUnavailable).toBe(true);
    expect(response.analysis ?? []).toHaveLength(0); // analysis skipped, not fabricated
    expect(response.hasAnalysis).toBeUndefined();
    const bundle = toAnswerBundle(response);
    expect(bundle.warnings.some((w) => /AI analysis could not be generated/i.test(w))).toBe(true);
    expect(JSON.stringify(bundle)).not.toContain("exploded"); // raw provider error never surfaced
  });

  it("7. advice query with WORKING analysis is unaffected (no analysisUnavailable flag)", async () => {
    const response = await askAI(
      { question: "How should we improve the business?" },
      createDatabaseAskAIDependencies(db, { now, llm: decliningLlm, analysis: okAnalysis, synthesisInfo: info, requireLlm: true }),
    );
    expect(response.hasAnalysis).toBe(true);
    expect(response.analysisUnavailable).toBeUndefined();
    expect(response.analysis).toHaveLength(1);
  });
});
