import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { askAI, createDatabaseAskAIDependencies, understandQuestion } from "../src/ask-ai/index.js";

const intentOf = (question: string) => understandQuestion(question).intent;

describe("Ask AI intent classification (Step 1 metadata)", () => {
  it("classifies advice/strategy prompts", () => {
    expect(intentOf("How do I improve the business?")).toBe("advice_strategy");
    expect(intentOf("How can we grow revenue?")).toBe("advice_strategy");
    expect(["advice_strategy", "planning_draft"]).toContain(intentOf("What should we do next?"));
  });

  it("classifies planning/drafting prompts", () => {
    expect(intentOf("Make me a plan for this project")).toBe("planning_draft");
    expect(intentOf("Draft an email based on this transcript")).toBe("planning_draft");
  });

  it("classifies decision and evidence lookups", () => {
    expect(intentOf("What did we decide about SQLite?")).toBe("decision_lookup");
    expect(intentOf("What evidence supports SQLite as source of truth?")).toBe("evidence_check");
  });

  it("classifies conflict/risk prompts (even when a 'plan' is mentioned)", () => {
    expect(intentOf("What are the conflicts or contradictions?")).toBe("conflict_risk");
    expect(intentOf("What are the risks/problems with this plan?")).toBe("conflict_risk");
  });

  it("classifies comparison and summary prompts", () => {
    expect(intentOf("Compare SQLite and PostgreSQL")).toBe("comparison");
    expect(intentOf("Summarize the transcript")).toBe("summary");
  });

  it("falls back to factual_lookup and detects genuinely combined asks as mixed", () => {
    expect(intentOf("What is the source of truth for this app?")).toBe("factual_lookup");
    expect(intentOf("What did we decide, and how can we improve it?")).toBe("mixed");
  });
});

describe("Ask AI answer contract (Step 1 metadata)", () => {
  it("keeps lookup intents evidence-required and refusing", () => {
    for (const q of ["What did we decide about SQLite?", "What evidence supports this?", "What is the source of truth?", "Compare A and B", "Summarize the project"]) {
      const c = understandQuestion(q).answerContract;
      expect(c.requireEvidenceForFactualClaims).toBe(true);
      expect(c.refuseIfNoEvidence).toBe(true);
      expect(c.allowGeneralReasoning).toBe(false);
      expect(c.allowRecommendations).toBe(false);
    }
    expect(understandQuestion("What did we decide about SQLite?").answerContract.includeConflicts).toBe(true);
  });

  it("marks advice/planning/conflict intents as analysis-capable WITHOUT weakening factual evidence", () => {
    const advice = understandQuestion("How do I improve the business?").answerContract;
    expect(advice).toMatchObject({ requireEvidenceForFactualClaims: true, allowGeneralReasoning: true, allowRecommendations: true, refuseIfNoEvidence: false, includeReviewOnlyItems: true, includeConflicts: true, allowDrafting: false });

    const plan = understandQuestion("Make me a plan for this project").answerContract;
    expect(plan).toMatchObject({ requireEvidenceForFactualClaims: true, allowDrafting: true, refuseIfNoEvidence: false });

    const risk = understandQuestion("What are the risks with this plan?").answerContract;
    expect(risk).toMatchObject({ requireEvidenceForFactualClaims: true, includeReviewOnlyItems: true, includeConflicts: true, allowRecommendations: false });
  });
});

describe("Ask AI behavior is unchanged in Step 1", () => {
  let db: SqliteDatabase;
  beforeEach(() => { db = openDatabase(":memory:"); });
  afterEach(() => db.close());

  it("still refuses an advice prompt when there is no transcript evidence (contract not yet consumed)", async () => {
    const response = await askAI({ question: "How do I improve the business?" }, createDatabaseAskAIDependencies(db));
    expect(response.notEnoughEvidence).toBe(true);
    expect(response.evidenceConfidence).toBe("no_evidence");
    expect(response.claims).toHaveLength(0);
    // The new metadata rides along but did not alter the outcome.
    expect(response.queryUnderstanding.intent).toBe("advice_strategy");
    expect(response.queryUnderstanding.answerContract.refuseIfNoEvidence).toBe(false);
  });
});
