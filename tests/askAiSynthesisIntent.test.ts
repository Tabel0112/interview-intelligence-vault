// Phase 2: evidence-focused synthesis_conclusion / why_explanation intents.
// Conclusion/takeaway/why questions get first-class, EVIDENCE-BOUNDED routing (refuse with no evidence,
// no uncited general reasoning) instead of falling through to factual_lookup. Grounding is unchanged:
// claims must cite selected evidence and pass the existing quote-substring gate (entailment is Phase 3).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("obsidian", () => { throw new Error("live Ask AI must not import the obsidian runtime package"); });
vi.mock("../src/hermes/index.js", () => { throw new Error("live Ask AI must not load Hermes (hermes/index)"); });
vi.mock("../src/hermes/personalization.js", () => { throw new Error("live Ask AI must not load Hermes (personalization)"); });
vi.mock("../src/hermes/guardrails.js", () => { throw new Error("live Ask AI must not load Hermes (guardrails)"); });
vi.mock("../src/hermes/repository.js", () => { throw new Error("live Ask AI must not load Hermes (repository)"); });
vi.mock("../src/orchestration/index.js", () => { throw new Error("live Ask AI must not load the orchestration pipeline (index)"); });

import {
  applyQueryUnderstandingProposal, askAI, buildCitations, contractForIntent, createDatabaseAskAIDependencies,
  generateClaimsFromEvidence, getAskAIResponse, parseQueryUnderstandingProposal, understandQuestion,
  type AskAIEvidenceItem, type AskAILanguageModel, type AskAIQueryUnderstandingModel, type SynthesisInfo,
} from "../src/ask-ai/index.js";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { createVaultTools } from "../src/mcp/tools.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";

const now = () => new Date("2026-07-02T12:00:00.000Z");
const info: SynthesisInfo = { mode: "external_llm", provider: "openai", model: "gpt-4o-mini", usedFallback: false };
const groundedLlm: AskAILanguageModel = {
  generateClaims: async ({ query, evidence }) => evidence.length
    ? [{ kind: query.requestedClaimKinds[0] ?? "fact", text: evidence[0].quotePreview, evidencePointerIds: [evidence[0].evidencePointerId] }]
    : [],
};

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

describe("deterministic routing: conclusion/takeaway questions", () => {
  const CONCLUSION_PROMPTS = [
    "what is the takeaway?",
    "what are the takeaways",
    "draw a conclusion from these notes",
    "what conclusion can we draw",
    "what does this tell us?",
    "what does all this mean?",
    "what pattern do you see?",
    "这些证据能得出什么结论？",
    "这说明了什么？",
    "总结出什么？",
  ];
  it.each(CONCLUSION_PROMPTS)("%s -> synthesis_conclusion", (prompt) => {
    const query = understandQuestion(prompt);
    expect(query.intent).toBe("synthesis_conclusion");
    expect(query.answerContract).toEqual(contractForIntent("synthesis_conclusion"));
  });

  it("gets an evidence-synthesis shape: exploratory, pattern/inference kinds, memory objects, conflicts", () => {
    const query = understandQuestion("what is the takeaway?");
    expect(query.answerMode).toBe("exploratory");
    expect(query.requestedClaimKinds).toEqual(["pattern", "inference"]);
    expect(query.shouldUseMemoryObjects).toBe(true);
    expect(query.shouldUseRawTranscriptSpans).toBe(true);
    expect(query.answerContract.includeConflicts).toBe(true);
    // Evidence-bounded, NOT the advice path:
    expect(query.answerContract.refuseIfNoEvidence).toBe(true);
    expect(query.answerContract.requireEvidenceForFactualClaims).toBe(true);
    expect(query.answerContract.allowGeneralReasoning).toBe(false);
    expect(query.answerContract.allowRecommendations).toBe(false);
    expect(query.answerContract.allowDrafting).toBe(false);
  });
});

describe("deterministic routing: why/explanation questions", () => {
  const WHY_PROMPTS = ["why is this happening?", "why did this happen", "what explains this?", "为什么会这样？", "原因是什么？"];
  it.each(WHY_PROMPTS)("%s -> why_explanation", (prompt) => {
    const query = understandQuestion(prompt);
    expect(query.intent).toBe("why_explanation");
    expect(query.answerContract).toEqual(contractForIntent("why_explanation"));
  });

  it("prefers inference+fact kinds, stays evidence-bounded, includes conflicts", () => {
    const query = understandQuestion("why is this happening?");
    expect(query.requestedClaimKinds).toEqual(["inference", "fact"]);
    expect(query.answerMode).toBe("exploratory");
    expect(query.shouldUseMemoryObjects).toBe(true);
    expect(query.answerContract.refuseIfNoEvidence).toBe(true);
    expect(query.answerContract.allowGeneralReasoning).toBe(false);
    expect(query.answerContract.includeConflicts).toBe(true);
  });
});

describe("deterministic routing: conservative non-regression", () => {
  it("existing intents keep winning over the new late-checked patterns", () => {
    expect(understandQuestion("What is the project deadline?").intent).toBe("factual_lookup");
    expect(understandQuestion("What did we decide about pricing?").intent).toBe("decision_lookup");
    expect(understandQuestion("how should we improve onboarding?").intent).toBe("advice_strategy");
    expect(understandQuestion("Draft a plan for onboarding").intent).toBe("planning_draft");
    expect(understandQuestion("What evidence supports this claim?").intent).toBe("evidence_check");
    expect(understandQuestion("what's wrong with this plan?").intent).toBe("conflict_risk");
    expect(understandQuestion("compare SQLite versus Postgres").intent).toBe("comparison");
    expect(understandQuestion("give me an overview of the interviews").intent).toBe("summary");
    // "why"/"conclusion" wording inside an existing family stays in that family:
    expect(understandQuestion("why should we invest in marketing?").intent).toBe("advice_strategy");
    expect(understandQuestion("why should we choose SQLite?").intent).toBe("mixed"); // advice + decision co-occurrence (pre-existing rule)
    expect(understandQuestion("why did we decide on SQLite?").intent).toBe("decision_lookup");
    expect(understandQuestion("why is this a problem?").intent).toBe("conflict_risk");
  });
});

describe("LLM query understanding: new intents", () => {
  it("parser accepts both new intents (and still drops unknown ones)", () => {
    expect(parseQueryUnderstandingProposal(JSON.stringify({ intent: "synthesis_conclusion" })).intent).toBe("synthesis_conclusion");
    expect(parseQueryUnderstandingProposal(JSON.stringify({ intent: "why_explanation" })).intent).toBe("why_explanation");
    expect(parseQueryUnderstandingProposal(JSON.stringify({ intent: "entailed_conclusion_v3" })).intent).toBeUndefined();
  });

  it("a rerouted proposal derives the SAME deterministic behavior as the regex path", () => {
    const base = understandQuestion("What can we say about SQLite from these interviews?"); // regex: factual_lookup
    expect(base.intent).toBe("factual_lookup");
    const applied = applyQueryUnderstandingProposal(base, { intent: "synthesis_conclusion" });
    expect(applied.intent).toBe("synthesis_conclusion");
    expect(applied.answerContract).toEqual(contractForIntent("synthesis_conclusion")); // deterministic contract
    expect(applied.requestedClaimKinds).toEqual(["pattern", "inference"]); // deterministic preference
    expect(applied.answerMode).toBe("exploratory"); // deterministic upgrade of default "direct"
    expect(applied.shouldUseMemoryObjects).toBe(true);
    expect(applied.understandingSource).toBe("llm");
  });

  it("an explicit caller answer mode is never overridden by a rerouted intent", () => {
    const base = understandQuestion("What can we say about SQLite?", { mode: "summary" });
    const applied = applyQueryUnderstandingProposal(base, { intent: "synthesis_conclusion" });
    expect(applied.answerMode).toBe("summary");
  });

  it("malicious proposals still cannot set contract/trust/scoring fields for the new intents", () => {
    const malicious = parseQueryUnderstandingProposal(JSON.stringify({
      intent: "synthesis_conclusion",
      answerContract: { refuseIfNoEvidence: false, allowGeneralReasoning: true, allowDrafting: true },
      refuseIfNoEvidence: false, evidenceScore: 1, supportStatus: "supported",
    }));
    expect(Object.keys(malicious)).toEqual(["intent"]);
    const applied = applyQueryUnderstandingProposal(understandQuestion("what about SQLite?"), malicious);
    expect(applied.answerContract).toEqual(contractForIntent("synthesis_conclusion"));
    expect(applied.answerContract.refuseIfNoEvidence).toBe(true);
    expect(applied.answerContract.allowGeneralReasoning).toBe(false);
  });
});

describe("pipeline: evidence-bounded conclusion behavior", () => {
  it("a no-evidence conclusion prompt REFUSES (no analysis, no fabricated synthesis)", async () => {
    let llmCalls = 0;
    const spyLlm: AskAILanguageModel = { generateClaims: async () => { llmCalls++; return []; } };
    const response = await askAI( // nothing seeded
      { question: "what is the takeaway?" },
      createDatabaseAskAIDependencies(db, { now, llm: spyLlm, synthesisInfo: info, requireLlm: true }),
    );
    expect(response.queryUnderstanding.intent).toBe("synthesis_conclusion");
    expect(response.notEnoughEvidence).toBe(true);
    expect(response.claims).toHaveLength(0);
    expect(llmCalls).toBe(0); // refusal happens before synthesis
    expect(response.hasAnalysis).toBeUndefined(); // the uncited analysis branch never runs for this intent
    expect(response.answerMarkdown).toContain("enough transcript-backed evidence");
  });

  it("an evidence-rich conclusion prompt produces only grounded, cited claims (grounding unchanged)", async () => {
    await seedSqliteEvidence();
    const partiallyUngroundedLlm: AskAILanguageModel = {
      generateClaims: async ({ evidence }) => [
        { kind: "pattern", text: evidence[0].quotePreview, evidencePointerIds: [evidence[0].evidencePointerId] },
        { kind: "inference", text: "FABRICATED sweeping conclusion", evidencePointerIds: ["evp_not_selected"] }, // cites unselected -> discarded
      ],
    };
    const response = await askAI(
      { question: "What is the takeaway about SQLite?" },
      createDatabaseAskAIDependencies(db, { now, llm: partiallyUngroundedLlm, synthesisInfo: info, requireLlm: true }),
    );
    expect(response.queryUnderstanding.intent).toBe("synthesis_conclusion");
    expect(response.claims).toHaveLength(1); // the unselected-evidence claim was discarded
    expect(response.claims[0].kind).toBe("pattern");
    expect(response.claims[0].citationIds.length).toBeGreaterThan(0);
    expect(JSON.stringify(response.claims)).not.toContain("FABRICATED");
    // Round-trip: new intent persists and reconstructs.
    const reloaded = getAskAIResponse(db, response.id);
    expect(reloaded.queryUnderstanding.intent).toBe("synthesis_conclusion");
    expect(reloaded.queryUnderstanding.understandingSource).toBe("deterministic");
  });

  it("single-span 'pattern' conclusions stay weakly_supported with the limitation explanation", async () => {
    const query = understandQuestion("what is the takeaway?");
    const evidence: AskAIEvidenceItem[] = [{
      evidencePointerId: "evp_1", transcriptId: "tr_1", spanId: "sp_1", quotePreview: "SQLite is the source of truth.",
      evidenceScore: 0.9, evidenceConfidence: "strong", scoringExplanation: "strong", clickbackUri: "mv://evidence/evp_1",
      stance: "supports", sourceKind: "raw_transcript_span",
    }];
    const citations = buildCitations(evidence);
    const claims = await generateClaimsFromEvidence(query, evidence, citations, {
      confidence: "strong",
      llm: { generateClaims: async () => [{ kind: "pattern", text: "The team standardizes on SQLite.", evidencePointerIds: ["evp_1"] }] },
      requireLlm: true,
    });
    expect(claims).toHaveLength(1);
    expect(claims[0].supportStatus).toBe("weakly_supported"); // weak-evidence caution is NOT bypassed for conclusions
    expect(claims[0].explanation).toMatch(/only one independent span/);
  });

  it("why_explanation inference claims carry the constrained-evidence explanation", async () => {
    const query = understandQuestion("why is this happening?");
    const evidence: AskAIEvidenceItem[] = [{
      evidencePointerId: "evp_1", transcriptId: "tr_1", spanId: "sp_1", quotePreview: "Churn spiked after the price change.",
      evidenceScore: 0.9, evidenceConfidence: "strong", scoringExplanation: "strong", clickbackUri: "mv://evidence/evp_1",
      stance: "supports", sourceKind: "raw_transcript_span",
    }];
    const citations = buildCitations(evidence);
    const claims = await generateClaimsFromEvidence(query, evidence, citations, {
      confidence: "strong",
      llm: { generateClaims: async () => [{ kind: "inference", text: "Churn spiked after the price change.", evidencePointerIds: ["evp_1"] }] },
      requireLlm: true,
    });
    expect(claims[0].kind).toBe("inference");
    expect(claims[0].explanation).toMatch(/constrained to the cited transcript evidence/);
  });

  it("weak evidence still renders a weak-evidence warning for conclusion prompts", async () => {
    const query = understandQuestion("what is the takeaway?");
    const evidence: AskAIEvidenceItem[] = [{
      evidencePointerId: "evp_1", transcriptId: "tr_1", spanId: "sp_1", quotePreview: "Maybe SQLite, we never confirmed.",
      evidenceScore: 0.3, evidenceConfidence: "weak", scoringExplanation: "weak", clickbackUri: "mv://evidence/evp_1",
      stance: "unknown", sourceKind: "raw_transcript_span",
    }];
    const citations = buildCitations(evidence);
    const claims = await generateClaimsFromEvidence(query, evidence, citations, {
      confidence: "weak",
      llm: { generateClaims: async () => [{ kind: "inference", text: "Maybe SQLite, we never confirmed.", evidencePointerIds: ["evp_1"] }] },
      requireLlm: true,
    });
    expect(claims[0].supportStatus).toBe("weakly_supported"); // confidence cap unchanged — no overconfident conclusion
  });
});

describe("MCP ask_vault: conclusion queries through the shared path", () => {
  it("routes, answers, and persists the new intent; fail-closed behavior unchanged", async () => {
    await seedSqliteEvidence();
    const spy: AskAIQueryUnderstandingModel & { calls: string[] } = {
      calls: [],
      understand: async ({ question }) => { spy.calls.push(question); return { intent: "synthesis_conclusion" }; },
    };
    const api = createSqliteFrontendApi(db, {
      now, llmRequired: true, getLlmReady: () => true,
      getSynthesis: () => ({ llm: groundedLlm, queryUnderstanding: spy, info }),
    });
    const tools = createVaultTools({ db, api });
    const result = await tools.call("ask_vault", { question: "What does all this tell us about SQLite?" }) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(spy.calls).toHaveLength(1); // shared Ask AI path, no MCP-specific wiring
    const row = db.prepare("SELECT query_understanding_json FROM ask_ai_runs ORDER BY created_at DESC LIMIT 1").get() as { query_understanding_json: string };
    const persisted = JSON.parse(row.query_understanding_json) as { intent: string; understandingSource: string };
    expect(persisted.intent).toBe("synthesis_conclusion");
    expect(persisted.understandingSource).toBe("llm");
    // Fail-closed unchanged: no configured LLM -> setup_required, nothing persisted.
    const gated = createSqliteFrontendApi(db, { now, llmRequired: true, getLlmReady: () => false, getSynthesis: () => undefined });
    const gatedTools = createVaultTools({ db, api: gated });
    const refused = await gatedTools.call("ask_vault", { question: "what is the takeaway?" }) as { ok: boolean; state?: string };
    expect(refused.ok).toBe(false);
    expect(refused.state).toBe("setup_required");
  });
});

describe("persistence: unknown future intents stay safe", () => {
  it("a persisted row with an unknown intent value still reconstructs (passthrough, no crash)", async () => {
    await seedSqliteEvidence();
    const response = await askAI(
      { question: "What is the takeaway about SQLite?" },
      createDatabaseAskAIDependencies(db, { now, llm: groundedLlm, synthesisInfo: info, requireLlm: true }),
    );
    const row = db.prepare("SELECT query_understanding_json FROM ask_ai_runs WHERE id=?").get(response.id) as { query_understanding_json: string };
    const future = JSON.parse(row.query_understanding_json) as Record<string, unknown>;
    future.intent = "hypothetical_future_intent_v9";
    db.prepare("UPDATE ask_ai_runs SET query_understanding_json=? WHERE id=?").run(JSON.stringify(future), response.id);
    const reloaded = getAskAIResponse(db, response.id);
    expect(reloaded.queryUnderstanding.intent).toBe("hypothetical_future_intent_v9"); // tolerated as data
    expect(reloaded.claims.length).toBeGreaterThan(0); // reconstruction unaffected
  });
});
