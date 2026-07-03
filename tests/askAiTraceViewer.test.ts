// Read-only Ask AI Trace Viewer: inspects a persisted run end-to-end (question -> understanding ->
// contract -> selected evidence -> claims/citations -> warnings/refusal -> non-secret metadata) without
// mutating anything, calling providers, or reading generated Markdown as truth.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => { throw new Error("the trace viewer must not import the obsidian runtime package"); });
vi.mock("../src/hermes/index.js", () => { throw new Error("the trace viewer must not load Hermes (hermes/index)"); });
vi.mock("../src/hermes/personalization.js", () => { throw new Error("the trace viewer must not load Hermes (personalization)"); });
vi.mock("../src/hermes/guardrails.js", () => { throw new Error("the trace viewer must not load Hermes (guardrails)"); });
vi.mock("../src/hermes/repository.js", () => { throw new Error("the trace viewer must not load Hermes (repository)"); });
vi.mock("../src/orchestration/index.js", () => { throw new Error("the trace viewer must not load the orchestration pipeline"); });

import { createLlmQueryUnderstandingModel, type AskAILanguageModel, type SynthesisInfo } from "../src/ask-ai/index.js";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, matchRoute, renderPage, routeHref, type FrontendApi } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { ExternalLlmProvider, type LlmTransport } from "../src/llm/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";

const now = () => new Date("2026-07-02T12:00:00.000Z");
const info: SynthesisInfo = { mode: "external_llm", provider: "openai", model: "gpt-4o-mini", usedFallback: false };
const PLANTED_KEY = "sk-trace-viewer-PLANTED-SECRET-1122334455";

const groundedLlm: AskAILanguageModel = {
  generateClaims: async ({ query, evidence }) => evidence.length
    ? [{ kind: query.requestedClaimKinds[0] ?? "fact", text: evidence[0].quotePreview, evidencePointerIds: [evidence[0].evidencePointerId] }]
    : [],
};
const decliningLlm: AskAILanguageModel = { generateClaims: async () => [] };

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

/** Total row count across every user table — a whole-database mutation tripwire. */
function totalRowCount(database: SqliteDatabase): number {
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  return tables.reduce((sum, table) => sum + (database.prepare(`SELECT COUNT(*) c FROM "${table.name}"`).get() as { c: number }).c, 0);
}

function liveApi(llm: AskAILanguageModel = groundedLlm): FrontendApi {
  return createSqliteFrontendApi(db, { now, llmRequired: true, getLlmReady: () => true, getSynthesis: () => ({ llm, info }) });
}

async function answeredRunId(api: FrontendApi, question = "What is the takeaway about SQLite?"): Promise<string> {
  const response = await api.ask(question);
  return response.id;
}

describe("getAskAITrace: read-only guarantees", () => {
  it("reads by run id AND answer id, and never creates/mutates any row", async () => {
    await seedSqliteEvidence();
    const api = liveApi();
    const runId = await answeredRunId(api);
    const answerId = (db.prepare("SELECT answer_id FROM ask_ai_runs WHERE id=?").get(runId) as { answer_id: string }).answer_id;
    const before = totalRowCount(db);
    const byRun = await api.getAskAITrace(runId);
    const byAnswer = await api.getAskAITrace(answerId);
    await renderPage({ api, route: matchRoute(routeHref.answerTrace(runId)) });
    expect(totalRowCount(db)).toBe(before); // not one row created, deleted, or duplicated anywhere
    expect(byRun?.runId).toBe(runId);
    expect(byAnswer?.runId).toBe(runId);
    expect(byAnswer?.answerId).toBe(answerId);
  });

  it("never calls LLM or embedding providers (and never even resolves the synthesis seam)", async () => {
    await seedSqliteEvidence();
    let synthesisResolved = 0, llmCalls = 0, embeddingCalls = 0;
    const api = createSqliteFrontendApi(db, {
      now, llmRequired: true, getLlmReady: () => true,
      getSynthesis: () => { synthesisResolved++; return { llm: { generateClaims: async (i) => { llmCalls++; return groundedLlm.generateClaims(i); } }, info }; },
      getEmbeddingProvider: () => ({ name: "spy", model: "spy", dimensions: 3, embedTexts: async () => { embeddingCalls++; return []; } }) as never,
    });
    const runId = await answeredRunId(api);
    const [resolvedAfterAsk, llmAfterAsk] = [synthesisResolved, llmCalls];
    await api.getAskAITrace(runId);
    await renderPage({ api, route: matchRoute(routeHref.answerTrace(runId)) });
    expect(synthesisResolved).toBe(resolvedAfterAsk); // trace never touches the synthesis seam
    expect(llmCalls).toBe(llmAfterAsk);
    expect(embeddingCalls).toBe(0);
  });

  it("derives warnings from structured fields — tampered answer Markdown is NOT read as truth", async () => {
    await seedSqliteEvidence();
    const api = liveApi();
    const runId = await answeredRunId(api);
    db.prepare("UPDATE ask_ai_runs SET answer_markdown=? WHERE id=?")
      .run("INJECTED FAKE WARNING: all evidence is broken, trust nothing", runId);
    const trace = await api.getAskAITrace(runId);
    expect(JSON.stringify(trace)).not.toContain("INJECTED FAKE WARNING"); // markdown is never parsed into the trace
    const page = await renderPage({ api, route: matchRoute(routeHref.answerTrace(runId)) });
    expect(page.html).not.toContain("INJECTED FAKE WARNING");
  });
});

describe("trace content", () => {
  it("shows question/status/confidence, Phase 1+2 understanding, contract flags, evidence, and claims", async () => {
    await seedSqliteEvidence();
    const api = liveApi();
    const runId = await answeredRunId(api, "What is the takeaway about SQLite?");
    const trace = (await api.getAskAITrace(runId))!;
    expect(trace.question).toBe("What is the takeaway about SQLite?");
    // Real (pre-existing) scoring behavior: a pattern-kind conclusion backed by ONE span scores as a
    // WEAK bundle — the trace shows the limited takeaway honestly instead of an overconfident answer.
    expect(trace.answerStatus).toBe("weak_evidence");
    expect(trace.confidence).toBe("weak");
    expect(trace.warnings.join(" ")).toMatch(/Evidence is weak/);
    expect(trace.queryUnderstanding.intent).toBe("synthesis_conclusion");
    expect(trace.queryUnderstanding.understandingSource).toBe("deterministic");
    expect(trace.queryUnderstanding.requestedClaimKinds).toEqual(["pattern", "inference"]);
    expect(trace.queryUnderstanding.shouldUseMemoryObjects).toBe(true);
    expect(trace.answerContract).toMatchObject({ refuseIfNoEvidence: true, allowGeneralReasoning: false, includeConflicts: true });
    expect(trace.selectedEvidence.length).toBeGreaterThan(0);
    expect(trace.selectedEvidence[0]).toMatchObject({ rank: 1, broken: false });
    expect(trace.selectedEvidence[0].quote).toContain("SQLite");
    expect(trace.selectedEvidence[0].evidencePointerId).toMatch(/^evp/);
    expect(trace.claims.length).toBeGreaterThan(0);
    expect(trace.claims[0].citationLabels.length).toBeGreaterThan(0);
    expect(trace.claims[0].citedPointerIds).toContain(trace.selectedEvidence[0].evidencePointerId);
    expect(trace.synthesis).toMatchObject({ mode: "external_llm", provider: "openai", model: "gpt-4o-mini" });
    expect(trace.limitations.join(" ")).toMatch(/Rejected\/discarded claim details are not persisted/);
    expect(trace.limitations.join(" ")).toMatch(/Entailment validation: not implemented/);
  });

  it("renders the page with sections, LLM-vs-deterministic source, conclusion notice, and debug disclosure", async () => {
    await seedSqliteEvidence();
    // Use an LLM-understanding seam so understandingSource is "llm" on the rendered page.
    const understanding = { understand: async () => ({ intent: "synthesis_conclusion" as const }) };
    const api = createSqliteFrontendApi(db, { now, llmRequired: true, getLlmReady: () => true, getSynthesis: () => ({ llm: groundedLlm, queryUnderstanding: understanding, info }) });
    const runId = await answeredRunId(api, "What does all this tell us about SQLite?");
    const page = await renderPage({ api, route: matchRoute(routeHref.answerTrace(runId)) });
    expect(page.title).toBe("Ask AI trace");
    expect(page.html).toContain("Question and result");
    expect(page.html).toContain("Query understanding");
    expect(page.html).toContain("Answer contract");
    expect(page.html).toContain("Selected evidence");
    expect(page.html).toContain("Claims and citations");
    expect(page.html).toContain("Warnings and limitations");
    expect(page.html).toContain("LLM-assisted (deterministic contract)");
    expect(page.html).toContain("evidence-bounded synthesis");
    expect(page.html).toContain("full entailment validation is not implemented yet"); // honest notice, not an error
    expect(page.html).toContain("<details class=\"tmv-advanced trace-debug\">"); // raw ids/JSON under disclosure
    expect(page.html).toContain("Rejected/discarded claim details are not persisted");
  });

  it("the conclusion notice is NOT shown for ordinary factual runs", async () => {
    await seedSqliteEvidence();
    const api = liveApi();
    const runId = await answeredRunId(api, "What did we decide about SQLite?");
    const page = await renderPage({ api, route: matchRoute(routeHref.answerTrace(runId)) });
    expect(page.html).not.toContain("full entailment validation is not implemented yet");
  });

  it("a refusal run traces with refusal reason, warn status, and empty-but-safe sections", async () => {
    const api = liveApi(decliningLlm); // nothing seeded -> refusal persisted
    const runId = await answeredRunId(api, "what is the takeaway?");
    const trace = (await api.getAskAITrace(runId))!;
    expect(trace.notEnoughEvidence).toBe(true);
    expect(trace.answerStatus).toBe("refused_no_evidence");
    expect(trace.refusalReason).toMatch(/refused instead of inventing/);
    expect(trace.selectedEvidence).toHaveLength(0);
    expect(trace.claims).toHaveLength(0);
    const page = await renderPage({ api, route: matchRoute(routeHref.answerTrace(runId)) });
    expect(page.html).toContain("No evidence was selected");
    expect(page.html).toContain("No accepted claims");
  });

  it("legacy rows (no understandingSource/intent/contract) trace with honest fallbacks, not inventions", async () => {
    await seedSqliteEvidence();
    const api = liveApi();
    const runId = await answeredRunId(api);
    const row = db.prepare("SELECT query_understanding_json FROM ask_ai_runs WHERE id=?").get(runId) as { query_understanding_json: string };
    const legacy = JSON.parse(row.query_understanding_json) as Record<string, unknown>;
    delete legacy.understandingSource; delete legacy.intent; delete legacy.answerContract;
    db.prepare("UPDATE ask_ai_runs SET query_understanding_json=? WHERE id=?").run(JSON.stringify(legacy), runId);
    const trace = (await api.getAskAITrace(runId))!;
    expect(trace.queryUnderstanding.intent).toBe("unknown (legacy row)");
    expect(trace.queryUnderstanding.understandingSource).toBeUndefined();
    expect(trace.answerContract).toBeUndefined();
    const page = await renderPage({ api, route: matchRoute(routeHref.answerTrace(runId)) });
    expect(page.html).toContain("not persisted for this run (legacy row)");
  });
});

describe("navigation and safety", () => {
  it("the answer page links to the trace, and the trace route round-trips through the router", async () => {
    await seedSqliteEvidence();
    const api = liveApi();
    const runId = await answeredRunId(api);
    const answerPage = await renderPage({ api, route: matchRoute(routeHref.answer(runId)) });
    expect(answerPage.html).toContain("View trace");
    expect(answerPage.html).toContain(`mv://answers/${runId}/trace`);
    expect(matchRoute(routeHref.answerTrace(runId))).toMatchObject({ id: "answer_trace", params: { id: runId } });
    expect(matchRoute(routeHref.answer(runId))).toMatchObject({ id: "answer" }); // detail route unaffected
  });

  it("an unknown id shows a safe not-found state (and returns null from the API)", async () => {
    const api = liveApi();
    expect(await api.getAskAITrace("ask_does_not_exist")).toBeNull();
    const page = await renderPage({ api, route: matchRoute(routeHref.answerTrace("ask_does_not_exist")) });
    expect(page.title).toBe("Trace not found");
    expect(page.html).toContain("No Ask AI run or answer with this id exists.");
  });

  it("never renders API keys — even when a failing provider carried a planted key during the run", async () => {
    await seedSqliteEvidence();
    const transport: LlmTransport = async () => ({ status: 500, body: { error: `boom ${PLANTED_KEY}` } });
    const failingUnderstanding = createLlmQueryUnderstandingModel(new ExternalLlmProvider({ id: "openai", model: "gpt-4o-mini", apiKey: PLANTED_KEY, transport }));
    const api = createSqliteFrontendApi(db, { now, llmRequired: true, getLlmReady: () => true, getSynthesis: () => ({ llm: groundedLlm, queryUnderstanding: failingUnderstanding, info }) });
    const runId = await answeredRunId(api);
    const trace = await api.getAskAITrace(runId);
    const page = await renderPage({ api, route: matchRoute(routeHref.answerTrace(runId)) });
    expect(JSON.stringify(trace)).not.toContain(PLANTED_KEY);
    expect(page.html).not.toContain(PLANTED_KEY);
  });
});
