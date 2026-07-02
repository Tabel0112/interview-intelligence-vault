import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// NEGATIVE live-path guard (Pass F): the LIVE Ask AI surfaces — the frontend/Obsidian api and MCP
// ask_vault — must NOT invoke (or even load) Hermes or the dormant orchestration Ask AI pipeline.
// Every Hermes/orchestration runtime module is mocked with a THROWING factory (the same durable seam this
// repo uses to prove the MCP service never loads the "obsidian" package): if any live import graph ever
// pulls one of these modules in, module load throws and this test fails loudly.
vi.mock("obsidian", () => { throw new Error("the live Ask AI path must not import the obsidian runtime package"); });
vi.mock("../src/hermes/index.js", () => { throw new Error("live Ask AI must not load Hermes (hermes/index)"); });
vi.mock("../src/hermes/personalization.js", () => { throw new Error("live Ask AI must not load Hermes (personalization)"); });
vi.mock("../src/hermes/guardrails.js", () => { throw new Error("live Ask AI must not load Hermes (guardrails)"); });
vi.mock("../src/hermes/repository.js", () => { throw new Error("live Ask AI must not load Hermes (repository)"); });
vi.mock("../src/orchestration/index.js", () => { throw new Error("live Ask AI must not load the orchestration pipeline (index)"); });
vi.mock("../src/orchestration/askAiPipeline.js", () => { throw new Error("live Ask AI must not load the orchestration Ask AI pipeline"); });
vi.mock("../src/orchestration/runner.js", () => { throw new Error("live Ask AI must not load the orchestration runner"); });
vi.mock("../src/orchestration/agents/answerSynthesisAgent.js", () => { throw new Error("live Ask AI must not load answerSynthesisAgent"); });

import { type AskAILanguageModel, type SynthesisInfo } from "../src/ask-ai/index.js";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, type FrontendApi } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { createVaultTools } from "../src/mcp/tools.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";

const now = () => new Date("2026-07-01T12:00:00.000Z");
// Live-style LLM-required wiring with an explicitly injected mock external LLM (the allowed test seam).
const mockLlm: AskAILanguageModel = {
  generateClaims: async ({ evidence }) => evidence.length
    ? [{ kind: "fact", text: evidence[0].quotePreview, evidencePointerIds: [evidence[0].evidencePointerId] }]
    : [],
};
const info: SynthesisInfo = { mode: "external_llm", provider: "mock", model: "mock", usedFallback: false };

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const liveApi = (): FrontendApi => createSqliteFrontendApi(db, {
  now, llmRequired: true, getLlmReady: () => true, getSynthesis: () => ({ llm: mockLlm, info }),
});

async function seedEvidence() {
  const repos = createRepositories(db);
  const imported = importTranscript(db, { filename: "t.txt", rawText: "Alex: SQLite is the source of truth for the vault." });
  const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string };
  const memory = repos.memoryObjects.createMemoryObject(
    { type: "decision", generated_text: "SQLite is authoritative.", confidence: 0.95, created_by: "agent" },
    [{ span_id: span.id, role: "supports", evidence_score: 0.95 }],
  );
  const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.95 });
  await indexEvidencePointerForSearch(db, pointer.evidence_pointer_id);
}

describe("live Ask AI paths never invoke Hermes or the orchestration pipeline", () => {
  it("frontend/Obsidian Ask AI answers through the evidence-first pipeline with Hermes/orchestration unloaded", async () => {
    await seedEvidence();
    const response = await liveApi().ask("What is the source of truth?");
    // A real grounded answer was produced by the direct evidence-first pipeline...
    expect(response.claims.length).toBeGreaterThan(0);
    expect(response.citations.length).toBeGreaterThan(0);
    expect(response.synthesis?.mode).toBe("external_llm");
    // ...and no Hermes personalization artifacts exist on the live response shape.
    expect(JSON.stringify(response)).not.toMatch(/hermes/i);
  });

  it("MCP ask_vault answers through the same pipeline with Hermes/orchestration unloaded", async () => {
    await seedEvidence();
    const tools = createVaultTools({ db, api: liveApi() });
    const result = await tools.call("ask_vault", { question: "What is the source of truth?" }) as { ok: boolean; answer_bundle: { claims: unknown[]; citations: unknown[] } };
    expect(result.ok).toBe(true);
    expect(result.answer_bundle.claims.length).toBeGreaterThan(0);
    expect(result.answer_bundle.citations.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toMatch(/hermes/i);
  });

  it("the live refusal path (no evidence) also runs without Hermes/orchestration", async () => {
    const response = await liveApi().ask("What did we decide about Firebase authentication?");
    expect(response.notEnoughEvidence).toBe(true);
    expect(response.claims).toHaveLength(0);
  });
});
