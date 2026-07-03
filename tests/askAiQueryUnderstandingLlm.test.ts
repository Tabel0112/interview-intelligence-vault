import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// NEGATIVE live-path guard: the LLM query-understanding seam must not pull Hermes, the dormant
// orchestration pipeline, or the obsidian runtime into the live Ask AI import graph. Throwing module
// factories fail this suite loudly if any code path ever loads them.
vi.mock("obsidian", () => { throw new Error("live Ask AI must not import the obsidian runtime package"); });
vi.mock("../src/hermes/index.js", () => { throw new Error("live Ask AI must not load Hermes (hermes/index)"); });
vi.mock("../src/hermes/personalization.js", () => { throw new Error("live Ask AI must not load Hermes (personalization)"); });
vi.mock("../src/hermes/guardrails.js", () => { throw new Error("live Ask AI must not load Hermes (guardrails)"); });
vi.mock("../src/hermes/repository.js", () => { throw new Error("live Ask AI must not load Hermes (repository)"); });
vi.mock("../src/orchestration/index.js", () => { throw new Error("live Ask AI must not load the orchestration pipeline (index)"); });
vi.mock("../src/orchestration/askAiPipeline.js", () => { throw new Error("live Ask AI must not load the orchestration Ask AI pipeline"); });

import {
  applyQueryUnderstandingProposal, askAI, contractForIntent, createDatabaseAskAIDependencies,
  createLlmQueryUnderstandingModel, getAskAIResponse, parseQueryUnderstandingProposal,
  QueryUnderstandingError, SynthesisSetupRequiredError, understandQuestion, understandQuestionWithModel,
  type AskAIAnalysisModel, type AskAILanguageModel, type AskAIQueryUnderstandingModel, type SynthesisInfo,
} from "../src/ask-ai/index.js";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { ValidationError } from "../src/db/errors.js";
import { createSqliteFrontendApi } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { ExternalLlmProvider, type LlmTransport } from "../src/llm/index.js";
import { MockLlmProvider } from "../src/llm/testing.js";
import { createVaultTools } from "../src/mcp/tools.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";

const now = () => new Date("2026-07-02T12:00:00.000Z");
const info: SynthesisInfo = { mode: "external_llm", provider: "openai", model: "gpt-4o-mini", usedFallback: false };
const PLANTED_KEY = "sk-query-understanding-PLANTED-SECRET-0987654321";

// Injected mock seams (offline, no network):
const groundedLlm: AskAILanguageModel = {
  generateClaims: async ({ evidence }) => evidence.length
    ? [{ kind: "fact", text: evidence[0].quotePreview, evidencePointerIds: [evidence[0].evidencePointerId] }]
    : [],
};
const okAnalysis: AskAIAnalysisModel = { analyze: async () => [{ kind: "recommendation", text: "Tighten the onboarding flow." }] };
const understandingModel = (proposal: unknown): AskAIQueryUnderstandingModel & { calls: string[] } => {
  const calls: string[] = [];
  return { calls, understand: async ({ question }) => { calls.push(question); return proposal as never; } };
};
const throwingUnderstanding: AskAIQueryUnderstandingModel = { understand: async () => { throw new Error("understanding provider exploded"); } };

let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;
beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); });
afterEach(() => db.close());

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

describe("parseQueryUnderstandingProposal: strict validation", () => {
  it("1. accepts a valid proposal and normalizes/dedupes strings", () => {
    const proposal = parseQueryUnderstandingProposal(JSON.stringify({
      intent: "advice_strategy",
      claimKinds: ["recommendation", "recommendation", "fact"],
      entities: ["  Acme   Corp ", "Acme Corp", ""],
      topics: ["onboarding\nflow"],
      timeHints: ["last month"],
    }));
    expect(proposal).toEqual({
      intent: "advice_strategy",
      requestedClaimKinds: ["recommendation", "fact"],
      detectedEntities: ["Acme Corp"],
      detectedTopics: ["onboarding flow"],
      timeHints: ["last month"],
    });
  });

  it("2. drops unknown intents and unknown claim kinds instead of guessing", () => {
    const proposal = parseQueryUnderstandingProposal(JSON.stringify({
      intent: "synthesis_conclusion", // not a known intent yet (Phase 2) -> dropped, deterministic base decides
      claimKinds: ["fact", "opinion", 42],
    }));
    expect(proposal.intent).toBeUndefined();
    expect(proposal.requestedClaimKinds).toEqual(["fact"]);
  });

  it("3. strips contract/trust/evidence fields the LLM must never set", () => {
    const proposal = parseQueryUnderstandingProposal(JSON.stringify({
      intent: "factual_lookup",
      answerContract: { refuseIfNoEvidence: false, allowGeneralReasoning: true, allowDrafting: true },
      refuseIfNoEvidence: false,
      allowGeneralReasoning: true,
      evidencePointerIds: ["evp_fabricated"],
      supportStatus: "supported",
      evidenceScore: 1.0,
      warnings: [],
      shouldUseMemoryObjects: true,
      answerMode: "recommendation",
    }));
    // Only whitelisted proposal keys survive — no contract, trust, scoring, or citation fields.
    expect(Object.keys(proposal)).toEqual(["intent"]);
  });

  it("4. caps array lengths, strips empties, truncates oversized items", () => {
    const proposal = parseQueryUnderstandingProposal(JSON.stringify({
      entities: [...Array.from({ length: 12 }, (_, i) => `Entity ${i}`), "", "   "],
      topics: ["x".repeat(500)],
    }));
    expect(proposal.detectedEntities).toHaveLength(8);
    expect(proposal.detectedTopics?.[0]).toHaveLength(200);
  });

  it("5. rejects malformed JSON and non-object payloads", () => {
    expect(() => parseQueryUnderstandingProposal("not json {")).toThrow(QueryUnderstandingError);
    expect(() => parseQueryUnderstandingProposal(JSON.stringify(["factual_lookup"]))).toThrow(QueryUnderstandingError);
    expect(() => parseQueryUnderstandingProposal(JSON.stringify(null))).toThrow(QueryUnderstandingError);
  });
});

describe("applyQueryUnderstandingProposal: deterministic contract ownership", () => {
  it("6. an LLM intent label gets EXACTLY the deterministic contract for that intent", () => {
    const base = understandQuestion("What did we decide about pricing?");
    const applied = applyQueryUnderstandingProposal(base, { intent: "advice_strategy" });
    expect(applied.intent).toBe("advice_strategy");
    expect(applied.answerContract).toEqual(contractForIntent("advice_strategy"));
    // Same contract the regex path produces for a native advice question — no LLM-widened variant.
    expect(applied.answerContract).toEqual(understandQuestion("how should we improve onboarding?").answerContract);
    expect(applied.understandingSource).toBe("llm");
  });

  it("7. contract injection is impossible end-to-end (parser strips, apply recomputes)", () => {
    const malicious = parseQueryUnderstandingProposal(JSON.stringify({
      intent: "factual_lookup",
      answerContract: { requireEvidenceForFactualClaims: false, refuseIfNoEvidence: false, allowGeneralReasoning: true, allowRecommendations: true, allowDrafting: true, includeReviewOnlyItems: true, includeConflicts: true },
      refuseIfNoEvidence: false,
    }));
    const applied = applyQueryUnderstandingProposal(understandQuestion("What did we decide about pricing?"), malicious);
    expect(applied.answerContract).toEqual(contractForIntent("factual_lookup"));
    expect(applied.answerContract.requireEvidenceForFactualClaims).toBe(true);
    expect(applied.answerContract.refuseIfNoEvidence).toBe(true);
    expect(applied.answerContract.allowGeneralReasoning).toBe(false);
  });

  it("8. hints merge with the deterministic base; scope/trust fields stay from the base", () => {
    const base = understandQuestion('What did Jordan say about "pricing"?', { transcriptIds: ["tr_1"], timeRange: { start: "2026-01-01" } });
    const applied = applyQueryUnderstandingProposal(base, {
      detectedEntities: ["Jordan", "Acme"], detectedTopics: ["pricing", "discount policy"], timeHints: ["january"],
    });
    expect(applied.detectedEntities).toEqual(expect.arrayContaining(["Jordan", "Acme"]));
    expect(new Set(applied.detectedEntities).size).toBe(applied.detectedEntities.length); // deduped
    expect(applied.detectedTopics).toEqual(expect.arrayContaining(["pricing", "discount policy"]));
    // Deterministic base ownership of scope and derived flags:
    expect(applied.transcriptIds).toEqual(["tr_1"]);
    expect(applied.timeRange).toEqual({ start: "2026-01-01" });
    expect(applied.answerMode).toBe(base.answerMode);
    expect(applied.shouldUseMemoryObjects).toBe(base.shouldUseMemoryObjects);
    expect(applied.shouldUseRawTranscriptSpans).toBe(base.shouldUseRawTranscriptSpans);
  });
});

describe("understandQuestionWithModel: fallback behavior", () => {
  it("9. no model -> deterministic result marked deterministic", async () => {
    const query = await understandQuestionWithModel("What did we decide about SQLite?");
    expect(query.intent).toBe("decision_lookup");
    expect(query.understandingSource).toBe("deterministic");
  });

  it("10. model failure -> deterministic fallback, never a crash", async () => {
    const query = await understandQuestionWithModel("What did we decide about SQLite?", {}, throwingUnderstanding);
    expect(query.intent).toBe("decision_lookup");
    expect(query.understandingSource).toBe("deterministic");
  });

  it("11. empty question still throws ValidationError BEFORE the model is called", async () => {
    const spy = understandingModel({ intent: "summary" });
    await expect(understandQuestionWithModel("   ", {}, spy)).rejects.toBeInstanceOf(ValidationError);
    expect(spy.calls).toHaveLength(0);
  });
});

describe("createLlmQueryUnderstandingModel: adapter", () => {
  it("12. sends a planner prompt (not an answering prompt) and returns the validated proposal", async () => {
    const provider = new MockLlmProvider({ completion: { provider: "mock", model: "mock-model", text: JSON.stringify({ intent: "summary", topics: ["quarterly recap"] }), finishReason: "stop" } });
    const model = createLlmQueryUnderstandingModel(provider);
    const proposal = await model.understand({ question: "give me the recap" });
    expect(proposal).toEqual({ intent: "summary", detectedTopics: ["quarterly recap"] });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0].system).toMatch(/NOT answering/);
    expect(provider.calls[0].system).toMatch(/Do not invent facts/);
    expect(provider.calls[0].system).toMatch(/do not decide whether evidence is sufficient/i);
    expect(provider.calls[0].prompt).toContain("give me the recap");
    expect(provider.calls[0].responseFormat).toBe("json");
  });

  it("13. provider failure -> generic, key-free QueryUnderstandingError", async () => {
    const transport: LlmTransport = async () => ({ status: 401, body: { error: `bad key ${PLANTED_KEY}` } });
    const model = createLlmQueryUnderstandingModel(new ExternalLlmProvider({ id: "openai", model: "gpt-4o-mini", apiKey: PLANTED_KEY, transport }));
    const promise = model.understand({ question: "what happened?" });
    await expect(promise).rejects.toBeInstanceOf(QueryUnderstandingError);
    await expect(promise).rejects.toThrow(/query-understanding request failed/i);
    await expect(promise).rejects.not.toThrow(PLANTED_KEY);
  });

  it("14. malformed completion -> QueryUnderstandingError", async () => {
    const provider = new MockLlmProvider({ completion: { provider: "mock", model: "mock-model", text: "I think the intent is summary.", finishReason: "stop" } });
    await expect(createLlmQueryUnderstandingModel(provider).understand({ question: "q" })).rejects.toBeInstanceOf(QueryUnderstandingError);
  });
});

describe("askAI pipeline: LLM query understanding end-to-end", () => {
  it("15. a valid proposal reroutes intent, keeps the deterministic contract, and persists", async () => {
    await seedSqliteEvidence();
    const spy = understandingModel({ intent: "advice_strategy", entities: ["SQLite"], claimKinds: ["recommendation"] });
    const response = await askAI(
      { question: "What did we decide about SQLite?" }, // regex alone would say decision_lookup
      createDatabaseAskAIDependencies(db, { now, llm: groundedLlm, analysis: okAnalysis, queryUnderstanding: spy, synthesisInfo: info, requireLlm: true }),
    );
    expect(spy.calls).toEqual(["What did we decide about SQLite?"]);
    expect(response.queryUnderstanding.intent).toBe("advice_strategy");
    expect(response.queryUnderstanding.understandingSource).toBe("llm");
    expect(response.queryUnderstanding.answerContract).toEqual(contractForIntent("advice_strategy")); // deterministic contract
    expect(response.hasAnalysis).toBe(true); // reasoning-allowed contract activated the (uncited) analysis branch
    expect(response.claims.every((claim) => claim.citationIds.length > 0)).toBe(true); // factual claims still cited
    // Persisted + reconstructed additively:
    const reloaded = getAskAIResponse(db, response.id);
    expect(reloaded.queryUnderstanding.intent).toBe("advice_strategy");
    expect(reloaded.queryUnderstanding.understandingSource).toBe("llm");
    expect(reloaded.queryUnderstanding.answerContract).toEqual(contractForIntent("advice_strategy"));
  });

  it("16. understanding-model failure falls back to deterministic understanding; the answer still works", async () => {
    await seedSqliteEvidence();
    const response = await askAI(
      { question: "What did we decide about SQLite?" },
      createDatabaseAskAIDependencies(db, { now, llm: groundedLlm, queryUnderstanding: throwingUnderstanding, synthesisInfo: info, requireLlm: true }),
    );
    expect(response.queryUnderstanding.intent).toBe("decision_lookup"); // regex fallback
    expect(response.queryUnderstanding.understandingSource).toBe("deterministic");
    expect(response.claims.length).toBeGreaterThan(0);
  });

  it("17. fail-closed is unchanged: no configured LLM refuses setup-required BEFORE any understanding runs", async () => {
    await seedSqliteEvidence();
    const api = createSqliteFrontendApi(db, { now, llmRequired: true, getLlmReady: () => false, getSynthesis: () => undefined });
    await expect(api.ask("What did we decide about SQLite?")).rejects.toBeInstanceOf(SynthesisSetupRequiredError);
    expect((db.prepare("SELECT COUNT(*) c FROM ask_ai_runs").get() as { c: number }).c).toBe(0); // nothing persisted
  });

  it("18. legacy persisted query_understanding_json (no understandingSource) still reconstructs", async () => {
    await seedSqliteEvidence();
    const response = await askAI(
      { question: "What did we decide about SQLite?" },
      createDatabaseAskAIDependencies(db, { now, llm: groundedLlm, synthesisInfo: info, requireLlm: true }),
    );
    // Simulate a pre-Phase-1 row: strip the new field from the persisted JSON.
    const row = db.prepare("SELECT query_understanding_json FROM ask_ai_runs WHERE id=?").get(response.id) as { query_understanding_json: string };
    const legacy = JSON.parse(row.query_understanding_json) as Record<string, unknown>;
    delete legacy.understandingSource;
    db.prepare("UPDATE ask_ai_runs SET query_understanding_json=? WHERE id=?").run(JSON.stringify(legacy), response.id);
    const reloaded = getAskAIResponse(db, response.id);
    expect(reloaded.queryUnderstanding.intent).toBe("decision_lookup");
    expect(reloaded.queryUnderstanding.understandingSource).toBeUndefined(); // safely absent, no default invented
  });

  it("19. a failing external understanding provider never leaks its key into the answer or the database", async () => {
    await seedSqliteEvidence();
    const transport: LlmTransport = async () => ({ status: 500, body: { error: `boom ${PLANTED_KEY}` } });
    const failingUnderstanding = createLlmQueryUnderstandingModel(new ExternalLlmProvider({ id: "openai", model: "gpt-4o-mini", apiKey: PLANTED_KEY, transport }));
    const response = await askAI(
      { question: "What did we decide about SQLite?" },
      createDatabaseAskAIDependencies(db, { now, llm: groundedLlm, queryUnderstanding: failingUnderstanding, synthesisInfo: info, requireLlm: true }),
    );
    expect(response.queryUnderstanding.understandingSource).toBe("deterministic"); // graceful fallback
    expect(JSON.stringify(response)).not.toContain(PLANTED_KEY);
    const dump = ["ask_ai_runs", "ai_answers", "answer_claims", "evidence_pointers"].map((table) =>
      JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all())).join("\n");
    expect(dump).not.toContain(PLANTED_KEY);
  });
});

describe("MCP ask_vault: shared query-understanding path", () => {
  it("20. ask_vault flows through the same seam (called once, answer validated)", async () => {
    await seedSqliteEvidence();
    const spy = understandingModel({ intent: "advice_strategy" });
    const api = createSqliteFrontendApi(db, {
      now, llmRequired: true, getLlmReady: () => true,
      getSynthesis: () => ({ llm: groundedLlm, analysis: okAnalysis, queryUnderstanding: spy, info }),
    });
    const tools = createVaultTools({ db, api });
    const result = await tools.call("ask_vault", { question: "What did we decide about SQLite?" }) as { ok: boolean; answer_bundle?: Record<string, unknown> };
    expect(result.ok).toBe(true);
    expect(spy.calls).toHaveLength(1); // MCP inherits the seam through the shared Ask AI wiring
    expect(result.answer_bundle).toBeDefined();
    expect(JSON.stringify(result)).not.toContain(PLANTED_KEY);
  });
});
