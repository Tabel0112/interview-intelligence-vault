import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { getAskAIResponse, persistAskAIResponse, understandQuestion, type AskAIResponse } from "../src/ask-ai/index.js";
import { createSqliteFrontendApi, renderRoute, routeHref } from "../src/frontend/index.js";

const QUOTE = "Alex: We decided to use SQLite as the source of truth for the vault.";

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

// Seed a real, resolvable evidence pointer (persist validates pointers), then build a WEAK live answer:
// answer-level confidence = "weak" (claim weakly_supported), but the single evidence item is "mixed" — so
// provenance promotion sets answer_claims.support_status = "supported" (the historical upgrade bug).
function seedWeakAnswer(answerId = "ask_rt_1"): { response: AskAIResponse; pointerId: string } {
  const repos = createRepositories(db);
  const imported = importTranscript(db, { filename: "t.txt", rawText: QUOTE });
  const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string };
  const memory = repos.memoryObjects.createMemoryObject(
    { type: "decision", generated_text: "SQLite is authoritative.", confidence: 0.6, created_by: "agent" },
    [{ span_id: span.id, role: "supports", evidence_score: 0.6 }],
  );
  const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceRole: "support", evidenceStrength: "mixed", confidence: 0.57 });
  const ptr = pointer.evidence_pointer_id;
  const query = understandQuestion("What is the source of truth?");
  const response: AskAIResponse = {
    id: answerId, question: "What is the source of truth?",
    answerMarkdown: `The source of truth is SQLite. [1](mv://evidence/${ptr})`,
    evidenceConfidence: "weak", notEnoughEvidence: false, createdAt: "2026-06-12T00:00:00.000Z",
    queryUnderstanding: query, conflicts: [], suggestedFollowups: [],
    synthesis: { mode: "external_llm", provider: "openai", model: "gpt-x", usedFallback: false },
    evidence: [{
      evidencePointerId: ptr, sourcePointerId: pointer.source_pointer_uri, transcriptId: imported.transcriptId, spanId: span.id,
      quotePreview: QUOTE, evidenceScore: 0.57, evidenceConfidence: "mixed", scoringExplanation: "single supporting span",
      clickbackUri: `mv://evidence/${ptr}`, stance: "supports", sourceKind: "memory_object_with_pointers",
    }],
    claims: [{ id: "aiclaim_live", kind: "fact", text: "The source of truth is SQLite.", supportStatus: "weakly_supported", evidencePointerIds: [ptr], citationIds: ["aic_live"] }],
    citations: [{ id: "aic_live", label: "[1]", evidencePointerId: ptr, sourcePointerId: pointer.source_pointer_uri, transcriptId: imported.transcriptId, spanId: span.id, quotePreview: QUOTE, clickbackUri: `mv://evidence/${ptr}` }],
  };
  return { response, pointerId: ptr };
}

describe("Ask AI persist -> reconstruct fidelity", () => {
  it("preserves live weakly_supported (never reloads as supported) and aligns citations with evidence", () => {
    const { response, pointerId } = seedWeakAnswer();
    persistAskAIResponse(db, response);

    // The provenance promotion DID set answer_claims to 'supported' (the bug we are guarding against)...
    expect(db.prepare("SELECT support_status FROM answer_claims WHERE answer_id=?").get("ask_rt_1")).toMatchObject({ support_status: "supported" });
    // ...but the Ask-AI metadata stored the live value, and reconstruction prefers it.
    const reloaded = getAskAIResponse(db, "ask_rt_1");
    expect(reloaded.claims[0].supportStatus).toBe("weakly_supported"); // NOT upgraded
    expect(reloaded.answerMarkdown).toBe(response.answerMarkdown);

    // Citations line up 1:1 with evidence[] and point at the SELECTED pointer (not a re-minted answer_claim one).
    const evidencePointerIds = new Set(reloaded.evidence.map((e) => e.evidencePointerId));
    expect(reloaded.citations.length).toBeGreaterThan(0);
    for (const citation of reloaded.citations) expect(evidencePointerIds.has(citation.evidencePointerId)).toBe(true);
    expect(reloaded.citations[0].evidencePointerId).toBe(pointerId);
    expect(reloaded.claims[0].evidencePointerIds).toContain(pointerId);
  });

  it("legacy rows (null support_status) reconstruct conservatively, capped by evidence_confidence — never supported", () => {
    const { response } = seedWeakAnswer("ask_legacy_1");
    persistAskAIResponse(db, response);
    db.prepare("UPDATE ask_ai_claim_metadata SET support_status=NULL WHERE answer_claim_id IN (SELECT answer_claim_id FROM answer_claims WHERE answer_id=?)").run("ask_legacy_1");

    const reloaded = getAskAIResponse(db, "ask_legacy_1");
    // Fallback must NOT read the promoted answer_claims.support_status ('supported'); weak answer -> weakly_supported.
    expect(reloaded.claims[0].supportStatus).toBe("weakly_supported");
  });

  it("Obsidian answer view renders a reloaded weak answer as cautious (weakly_supported) with resolvable links", async () => {
    const { response, pointerId } = seedWeakAnswer("ask_view_1");
    persistAskAIResponse(db, response);
    const api = createSqliteFrontendApi(db);
    const html = await renderRoute(api, routeHref.answer("ask_view_1"));
    expect(html).toContain('data-support-status="weakly_supported"'); // not "supported"
    expect(html).not.toContain('data-support-status="supported"');
    expect(html).toContain(routeHref.evidence(pointerId)); // citation/evidence link resolves to the selected pointer
    expect(html).toContain("This answer must not be treated as strong truth"); // top-level weak warning preserved
  });
});
