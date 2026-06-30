import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, ValidationError, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";
import {
  askAI, createDatabaseAskAIDependencies, getAskAIResponse, renderAnswer,
  type AskAIAnalysisModel,
} from "../src/ask-ai/index.js";
import { toAnswerBundle } from "../src/mcp/answerBundle.js";

const now = () => new Date("2026-06-12T12:00:00.000Z");
// A deterministic mock of the live AI-analysis seam (no network). Returns two uncited reasoning items.
const mockAnalysis: AskAIAnalysisModel = {
  analyze: async () => [
    { kind: "recommendation", text: "Tighten onboarding to lift retention." },
    { kind: "inference", text: "Growth is likely constrained by activation, not traffic." },
  ],
};

let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;
beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); });
afterEach(() => db.close());

async function seedEvidence() {
  const imported = importTranscript(db, { filename: "t.txt", rawText: "Alex: SQLite is the source of truth for the vault." });
  const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string };
  const memory = repos.memoryObjects.createMemoryObject(
    { type: "decision", generated_text: "SQLite is authoritative.", confidence: 0.95, created_by: "agent" },
    [{ span_id: span.id, role: "supports", evidence_score: 0.95 }],
  );
  const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.95 });
  await indexEvidencePointerForSearch(db, pointer.evidence_pointer_id);
  return pointer;
}

describe("Step 2: factual/evidence lookup behavior is unchanged (no analysis branch)", () => {
  it("1. factual lookup with no evidence still refuses and produces NO analysis (even with an analysis model present)", async () => {
    const response = await askAI({ question: "What did we decide about SQLite?" }, createDatabaseAskAIDependencies(db, { now, analysis: mockAnalysis }));
    expect(response.queryUnderstanding.intent).toBe("decision_lookup");
    expect(response.notEnoughEvidence).toBe(true);
    expect(response.claims).toHaveLength(0);
    expect(response.analysis).toBeUndefined();
    expect(response.hasAnalysis).toBeUndefined();
    expect(response.answerMarkdown).toBe("I don't have enough transcript-backed evidence to answer that.");
  });

  it("2. evidence-check with no evidence still refuses with no analysis", async () => {
    const response = await askAI({ question: "What evidence supports SQLite as source of truth?" }, createDatabaseAskAIDependencies(db, { now, analysis: mockAnalysis }));
    expect(response.queryUnderstanding.intent).toBe("evidence_check");
    expect(response.notEnoughEvidence).toBe(true);
    expect(response.analysis).toBeUndefined();
    expect(response.answerMarkdown).toContain("don't have enough transcript-backed evidence");
  });
});

describe("Step 2: advice/strategy/planning prompts return live AI analysis", () => {
  it("3. advice prompt with no evidence returns labeled AI analysis, uncited, not transcript-backed", async () => {
    const response = await askAI({ question: "How do I improve the business?" }, createDatabaseAskAIDependencies(db, { now, analysis: mockAnalysis }));
    expect(response.queryUnderstanding.intent).toBe("advice_strategy");
    expect(response.hasAnalysis).toBe(true);
    expect(response.analysis).toHaveLength(2);
    for (const item of response.analysis!) {
      expect(item.supportStatus).toBe("ai_analysis");
      expect(item.evidencePointerIds).toEqual([]);
      expect(item.citationIds).toEqual([]);
      expect(item.warning).toContain("not from transcript evidence");
    }
    // No transcript-backed claims; notEnoughEvidence still reflects that.
    expect(response.claims).toHaveLength(0);
    expect(response.notEnoughEvidence).toBe(true);
    expect(response.answerMarkdown).toContain("AI analysis — not from your transcripts");
    expect(response.answerMarkdown).toContain("not from your transcripts"); // explicit disclaimer in the lead
  });

  it("4. planning prompt with no evidence returns AI planning labeled as analysis", async () => {
    const response = await askAI({ question: "Make me a plan for this project" }, createDatabaseAskAIDependencies(db, { now, analysis: mockAnalysis }));
    expect(response.queryUnderstanding.intent).toBe("planning_draft");
    expect(response.hasAnalysis).toBe(true);
    expect(response.answerMarkdown).toContain("AI analysis — not from your transcripts");
    expect(response.claims).toHaveLength(0);
  });

  it("5. advice prompt WITH evidence returns a mixed answer: cited facts + separate uncited analysis", async () => {
    const pointer = await seedEvidence();
    const llm = { generateClaims: async () => [{ kind: "fact" as const, text: "SQLite is the source of truth.", evidencePointerIds: [pointer.evidence_pointer_id] }] };
    const response = await askAI({ question: "How should we use SQLite as the source of truth?" }, createDatabaseAskAIDependencies(db, { now, llm, analysis: mockAnalysis }));

    expect(response.claims.length).toBeGreaterThan(0); // transcript-backed, cited
    for (const claim of response.claims) {
      expect(claim.citationIds.length).toBeGreaterThan(0);
      expect(claim.supportStatus).not.toBe("ai_analysis");
    }
    expect(response.analysis).toHaveLength(2); // separate, uncited
    expect(response.analysis!.every((a) => a.citationIds.length === 0 && a.evidencePointerIds.length === 0)).toBe(true);
    // Both sections present and separate; facts stay cited and are not merged into analysis.
    expect(response.answerMarkdown).toContain("mv://evidence/"); // the transcript-backed section is cited
    expect(response.answerMarkdown).toContain("AI analysis — not from your transcripts");
    // The analysis section follows the factual section (separate, not interleaved into a claim).
    expect(response.answerMarkdown.indexOf("mv://evidence/")).toBeLessThan(response.answerMarkdown.indexOf("AI analysis — not from your transcripts"));
  });
});

describe("Step 2: trust guards", () => {
  it("6a. an uncited factual/supported claim still throws", () => {
    expect(() => renderAnswer({
      confidence: "strong",
      claims: [{ id: "c1", kind: "fact", text: "Unsupported", supportStatus: "supported", evidencePointerIds: [], citationIds: ["missing"] }],
      citations: [],
    })).toThrow(ValidationError);
  });

  it("6b. analysis claims are structurally uncited and never marked supported, and are never persisted", async () => {
    const response = await askAI({ question: "How can we grow revenue?" }, createDatabaseAskAIDependencies(db, { now, analysis: mockAnalysis }));
    // The analysis seam returns only {kind,text} — there is no channel to attach pointers/citations,
    // and the pipeline forces them empty with the ai_analysis marker.
    expect(response.analysis!.every((a) => a.supportStatus === "ai_analysis")).toBe(true);
    // Persistence ignores analysis: no answer_claims / claim metadata carry the analysis text.
    const claimRows = db.prepare("SELECT claim_text FROM answer_claims").all() as Array<{ claim_text: string }>;
    expect(claimRows.some((r) => /retention|activation/i.test(r.claim_text))).toBe(false);
  });
});

describe("Step 2: MCP ask_vault live bundle", () => {
  it("7a. advice prompt live bundle includes a labeled analysis section with disclaimer", async () => {
    const response = await askAI({ question: "How do I improve the business?" }, createDatabaseAskAIDependencies(db, { now, analysis: mockAnalysis }));
    const bundle = toAnswerBundle(response);
    expect(bundle.has_analysis).toBe(true);
    expect(bundle.analysis).toHaveLength(2);
    expect(bundle.analysis!.every((a) => a.support_state === "ai_analysis" && a.warning.length > 0)).toBe(true);
    expect(bundle.warnings.some((w) => /not from your transcripts/i.test(w))).toBe(true);
  });

  it("7b. factual lookup live bundle still refuses with no analysis", async () => {
    const response = await askAI({ question: "What did we decide about SQLite?" }, createDatabaseAskAIDependencies(db, { now, analysis: mockAnalysis }));
    const bundle = toAnswerBundle(response);
    expect(bundle.has_analysis).toBeUndefined();
    expect(bundle.analysis).toBeUndefined();
    expect(bundle.not_enough_evidence).toBe(true);
    expect(bundle.warnings.some((w) => /refusal, not an answer/i.test(w))).toBe(true);
  });
});

describe("reconstructed advice answer (Step 3: analysis persists, never as supported)", () => {
  it("8. reconstructs structured analysis but never as a supported transcript claim", async () => {
    const live = await askAI({ question: "How do I improve the business?" }, createDatabaseAskAIDependencies(db, { now, analysis: mockAnalysis }));
    expect(live.hasAnalysis).toBe(true);

    const reconstructed = getAskAIResponse(db, live.id);
    expect(reconstructed.hasAnalysis).toBe(true); // Step 3: analysis now round-trips...
    expect(reconstructed.analysis).toHaveLength(2);
    expect(reconstructed.analysis!.every((a) => a.supportStatus === "ai_analysis")).toBe(true);
    expect(reconstructed.claims).toHaveLength(0); // ...but it is NOT a transcript-backed claim
    expect(reconstructed.claims.some((c) => c.supportStatus === "supported")).toBe(false);
  });
});
