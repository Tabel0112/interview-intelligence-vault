import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, PACKAGED_MIGRATIONS, ValidationError, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";
import {
  askAI, createDatabaseAskAIDependencies, getAskAIResponse, persistAskAIResponse,
  understandQuestion, type AskAIAnalysisModel, type AskAIResponse,
} from "../src/ask-ai/index.js";
import { toAnswerBundle } from "../src/mcp/answerBundle.js";
import { buildObsidianGraph } from "../src/obsidian/index.js";

const now = () => new Date("2026-06-12T12:00:00.000Z");
const mockAnalysis: AskAIAnalysisModel = {
  analyze: async () => [
    { kind: "recommendation", text: "Tighten onboarding to lift retention.", explanation: "Reasoning, not transcript." },
    { kind: "inference", text: "Growth is likely constrained by activation." },
  ],
};

let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;
beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); });
afterEach(() => db.close());

const deps = () => createDatabaseAskAIDependencies(db, { now, analysis: mockAnalysis });
const count = (sql: string, ...args: unknown[]) => (db.prepare(`SELECT COUNT(*) c FROM ${sql}`).get(...args) as { c: number }).c;

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

describe("Step 3: migration + schema", () => {
  it("1. registers migration 014 and creates ask_ai_analysis_claims with NO evidence/citation/support columns", () => {
    expect(PACKAGED_MIGRATIONS.some((m) => m.filename === "014_ask_ai_analysis.sql")).toBe(true);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ask_ai_analysis_claims'").get()).toBeDefined();
    const cols = (db.prepare("PRAGMA table_info(ask_ai_analysis_claims)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(["id", "ask_ai_run_id", "position", "kind", "text", "explanation", "warning", "metadata_json", "created_at"]);
    // 6. No evidence/citation/support columns exist on the analysis table.
    for (const forbidden of ["evidence_pointer_id", "source_pointer_id", "citation_id", "citation_link_id", "support_status"]) {
      expect(cols).not.toContain(forbidden);
    }
  });
});

describe("Step 3: analysis claim id is run-scoped (regression for the analysis-PK collision, migration 016)", () => {
  it("two answers with IDENTICAL analysis text both persist + reconstruct (no PRIMARY KEY collision)", async () => {
    // The live analysis id is a content hash unique only within a run; identical analysis across two answers
    // (e.g. the same advice question twice) must not collide on the persisted primary key.
    const a1 = await askAI({ question: "How do I improve the business?" }, deps());
    const a2 = await askAI({ question: "How do I improve the business?" }, deps());
    expect(a1.analysis?.map((x) => x.id)).toEqual(a2.analysis?.map((x) => x.id)); // deterministic ids collide across runs
    expect(a1.id).not.toBe(a2.id);
    // Both persisted their own analysis rows under the composite (ask_ai_run_id, id) key.
    expect((db.prepare("SELECT COUNT(*) c FROM ask_ai_analysis_claims WHERE ask_ai_run_id=?").get(a1.id) as { c: number }).c).toBe(a1.analysis!.length);
    expect((db.prepare("SELECT COUNT(*) c FROM ask_ai_analysis_claims WHERE ask_ai_run_id=?").get(a2.id) as { c: number }).c).toBe(a2.analysis!.length);
    expect(getAskAIResponse(db, a2.id).analysis?.map((x) => x.text)).toEqual(a2.analysis?.map((x) => x.text));
  });
});

describe("Step 3: persistence + reconstruction", () => {
  it("2. an answer with no analysis reconstructs with analysis=[]", async () => {
    const response = await askAI({ question: "What did we decide about SQLite?" }, deps());
    expect(response.hasAnalysis).toBeUndefined();
    const reconstructed = getAskAIResponse(db, response.id);
    expect(reconstructed.analysis ?? []).toHaveLength(0);
    expect(reconstructed.hasAnalysis).toBeUndefined();
  });

  it("3/4/7/11/14. advice with no evidence persists + reconstructs structured analysis (uncited, never supported)", async () => {
    const live = await askAI({ question: "How do I improve the business?" }, deps());
    // 3. persisted rows exist.
    expect(count("ask_ai_analysis_claims WHERE ask_ai_run_id=?", live.id)).toBe(2);
    // 14. analysis-only answer keeps notEnoughEvidence true + hasAnalysis true (live).
    expect(live.notEnoughEvidence).toBe(true);
    expect(live.hasAnalysis).toBe(true);

    const r = getAskAIResponse(db, live.id);
    // 4. reconstructed structured analysis + hasAnalysis.
    expect(r.hasAnalysis).toBe(true);
    expect(r.analysis).toHaveLength(2);
    expect(r.notEnoughEvidence).toBe(true); // 14 (reconstructed)
    for (const item of r.analysis!) {
      // 7 + 11. uncited, unsupported, never "supported".
      expect(item.supportStatus).toBe("ai_analysis");
      expect(item.evidencePointerIds).toEqual([]);
      expect(item.citationIds).toEqual([]);
    }
    expect(r.analysis!.map((a) => a.text)).toEqual(live.analysis!.map((a) => a.text)); // order/content preserved
  });

  it("5. ask_vault (live) and get_answer (reconstructed) expose analysis consistently", async () => {
    const live = await askAI({ question: "How can we grow revenue?" }, deps());
    const liveBundle = toAnswerBundle(live);
    const reconstructedBundle = toAnswerBundle(getAskAIResponse(db, live.id));
    expect(reconstructedBundle.has_analysis).toBe(true);
    expect(reconstructedBundle.analysis).toEqual(liveBundle.analysis);
  });

  it("8/9/10. analysis never lands in answer_claims, citation_links, evidence_pointers, or source_pointers", async () => {
    const live = await askAI({ question: "How do I improve the business?" }, deps());
    // 8. not an answer claim.
    expect(db.prepare("SELECT COUNT(*) c FROM answer_claims WHERE answer_id=?").get(live.id)).toEqual({ c: 0 });
    expect(count("answer_claims WHERE claim_text LIKE '%retention%' OR claim_text LIKE '%activation%'")).toBe(0);
    // 9. no citation links.
    expect(db.prepare("SELECT COUNT(*) c FROM citation_links WHERE answer_id=?").get(live.id)).toEqual({ c: 0 });
    // 10. no provenance pointers created (the vault is empty; analysis must add none).
    expect(count("evidence_pointers")).toBe(0);
    expect(count("source_pointers")).toBe(0);
  });

  it("12. factual lookup with no evidence still refuses and has no analysis (reconstructed)", async () => {
    const live = await askAI({ question: "What evidence supports SQLite as source of truth?" }, deps());
    expect(live.hasAnalysis).toBeUndefined();
    const r = getAskAIResponse(db, live.id);
    expect(r.analysis ?? []).toHaveLength(0);
    expect(r.notEnoughEvidence).toBe(true);
    expect(toAnswerBundle(r).warnings.some((w) => /refusal, not an answer/i.test(w))).toBe(true);
  });

  it("13. advice WITH evidence reconstructs both cited transcript facts and uncited analysis", async () => {
    const pointer = await seedEvidence();
    const llm = { generateClaims: async () => [{ kind: "fact" as const, text: "SQLite is the source of truth.", evidencePointerIds: [pointer.evidence_pointer_id] }] };
    const live = await askAI({ question: "How should we use SQLite as the source of truth?" }, createDatabaseAskAIDependencies(db, { now, llm, analysis: mockAnalysis }));
    const r = getAskAIResponse(db, live.id);
    expect(r.claims.length).toBeGreaterThan(0);
    // cited facts: an evidence-backed support status (the AskAIClaim type structurally excludes "ai_analysis").
    expect(r.claims.every((c) => c.citationIds.length > 0 && ["supported", "weakly_supported", "conflicting", "unsupported"].includes(c.supportStatus))).toBe(true);
    expect(r.analysis).toHaveLength(2);
    expect(r.analysis!.every((a) => a.citationIds.length === 0 && a.evidencePointerIds.length === 0)).toBe(true); // uncited analysis
  });

  it("15. generated graph contains no analysis node/edge for an advice answer", async () => {
    const live = await askAI({ question: "How do I improve the business?" }, deps());
    const graph = buildObsidianGraph(db).graph;
    // The analysis-only answer has no evidence, so it is not even an answer node; and no node carries analysis text.
    expect(graph.nodes.some((n) => n.id === `answer:${live.id}`)).toBe(false);
    expect(graph.nodes.some((n) => /retention|activation/i.test(n.label))).toBe(false);
    expect(graph.nodes.some((n) => (live.analysis ?? []).some((a) => n.id.includes(a.id)))).toBe(false);
  });
});

describe("Step 3: trust guard on persistence", () => {
  it("rejects persisting an analysis item that carries a citation or evidence pointer", () => {
    const query = understandQuestion("How do I improve the business?");
    const tainted = {
      id: "ask_taint_1", question: "How do I improve the business?", answerMarkdown: "x",
      evidenceConfidence: "no_evidence", notEnoughEvidence: true, createdAt: now().toISOString(),
      queryUnderstanding: query, conflicts: [], suggestedFollowups: [], claims: [], citations: [], evidence: [],
      // Bypass the compile-time guard to prove the runtime guard rejects a cited/evidence-bearing analysis item.
      analysis: [{ id: "bad", kind: "recommendation", text: "x", supportStatus: "ai_analysis", evidencePointerIds: ["evp_x"], citationIds: [], warning: "AI analysis — not from transcript evidence" }],
    } as unknown as AskAIResponse;
    expect(() => persistAskAIResponse(db, tainted)).toThrow(ValidationError);
    expect(db.prepare("SELECT COUNT(*) c FROM ask_ai_analysis_claims").get()).toEqual({ c: 0 }); // rolled back
  });
});
