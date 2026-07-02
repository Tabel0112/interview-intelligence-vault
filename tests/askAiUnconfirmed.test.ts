import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConflictRepository } from "../src/conflicts/index.js";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { rebuildRetrievalIndex } from "../src/retrieval/index.js";
import { askAI, createDatabaseAskAIDependencies, getAskAIResponse, type AskAIResponse } from "../src/ask-ai/index.js";
import { toAnswerBundle } from "../src/mcp/answerBundle.js";

const now = () => new Date("2026-06-12T12:00:00.000Z");
let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;
beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); });
afterEach(() => db.close());

const span = (t: string, i = 0) => (db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? ORDER BY span_index").all(t) as Array<{ id: string }>)[i].id;
const ask = (question: string) => askAI({ question }, createDatabaseAskAIDependencies(db, { now }));
const kinds = (r: AskAIResponse) => (r.unconfirmed ?? []).map((u) => u.kind);

// A/B confirm SQLite (active, bridged); C carries a "not SQLite" conflict + a "maybe PostgreSQL" tentative idea.
function seedProject() {
  const a = importTranscript(db, { filename: "A.txt", rawText: "Alex: We decided to use SQLite as the source of truth." });
  const c = importTranscript(db, { filename: "C.txt", rawText: "Pat: We should not use SQLite as the source of truth.\nPat: Maybe we should use PostgreSQL instead." });
  // needs_review tentative memory (PostgreSQL)
  repos.memoryObjects.createMemoryObject({ type: "preference", title: "Maybe PostgreSQL", generated_text: "Maybe we should use PostgreSQL instead.", status: "needs_review", confidence: 0.4, created_by: "agent" },
    [{ span_id: span(c.transcriptId, 1), role: "qualifies", evidence_score: 0.3 }]);
  // a conflict between two memories (use vs not-use SQLite), both bridged so it has live evidence
  const left = repos.memoryObjects.createMemoryObject({ type: "decision", title: "Use SQLite", generated_text: "Use SQLite as the source of truth.", confidence: 0.95, created_by: "agent" }, [{ span_id: span(a.transcriptId), role: "supports", evidence_score: 0.95 }]);
  const right = repos.memoryObjects.createMemoryObject({ type: "decision", title: "Not SQLite", generated_text: "Do not use SQLite as the source of truth.", confidence: 0.9, created_by: "agent" }, [{ span_id: span(c.transcriptId), role: "supports", evidence_score: 0.9 }]);
  const lp = linkMemoryObjectToSpan(db, { memoryObjectId: left.id, transcriptId: a.transcriptId, spanId: span(a.transcriptId), evidenceStrength: "strong", confidence: 0.95 });
  const rp = linkMemoryObjectToSpan(db, { memoryObjectId: right.id, transcriptId: c.transcriptId, spanId: span(c.transcriptId), evidenceStrength: "strong", confidence: 0.9 });
  const conflict = createConflictRepository(db, { now }).createConflictAssessment({ candidate: {
    leftTargetId: left.id, leftTargetType: "memory_object", leftText: left.generated_text, leftEvidenceIds: [lp.evidence_pointer_id],
    rightTargetId: right.id, rightTargetType: "memory_object", rightText: right.generated_text, rightEvidenceIds: [rp.evidence_pointer_id], sharedTopics: ["sqlite"],
  } });
  rebuildRetrievalIndex(db); // index memories so keyword-relevance retrieval (advice/planning) can find them
  return { conflictId: conflict.id };
}

describe("Ask AI unconfirmed surfacing — contract gating", () => {
  it("1/11/12. conflict_risk surfaces conflicts (even without selected active evidence) + review-only, labeled", async () => {
    const { conflictId } = seedProject();
    const r = await ask("What are the risks, conflicts, or uncertain ideas in this project?");
    expect(r.hasUnconfirmed).toBe(true);
    expect(kinds(r)).toContain("conflict");
    expect((r.unconfirmed ?? []).some((u) => u.kind === "tentative" || u.kind === "review_only")).toBe(true);
    const conf = (r.unconfirmed ?? []).find((u) => u.kind === "conflict");
    expect(conf?.conflictId).toBe(conflictId);
    expect(conf?.label).toBe("Conflict / tension");
    expect(r.answerMarkdown).toContain("not confirmed transcript-backed facts");
    expect(r.answerMarkdown).toContain("Conflicts / tensions");
  });

  it("2/3. advice/planning surface relevant tentative/review-only context (keyword-relevant)", async () => {
    seedProject();
    const advice = await askAI({ question: "How should we approach the PostgreSQL idea to improve things?" }, createDatabaseAskAIDependencies(db, { now }));
    expect(advice.queryUnderstanding.intent).toBe("advice_strategy");
    expect((advice.unconfirmed ?? []).some((u) => /PostgreSQL/i.test(u.text))).toBe(true);
    const planning = await askAI({ question: "Make me a plan to evaluate PostgreSQL." }, createDatabaseAskAIDependencies(db, { now }));
    expect(planning.queryUnderstanding.intent).toBe("planning_draft");
    expect(planning.hasUnconfirmed).toBe(true);
  });

  it("4. strict factual lookup does not surface unrelated review-only items and still refuses with no evidence", async () => {
    seedProject();
    const r = await ask("What did we decide about SQLite?");
    expect(r.queryUnderstanding.intent).toBe("decision_lookup");
    // decision_lookup includes conflicts only (relevant) — never a review-only/tentative dump.
    expect(kinds(r)).not.toContain("review_only");
    expect(kinds(r)).not.toContain("tentative");
  });

  it("5. evidence_check with no evidence still refuses and surfaces no review-only items", async () => {
    const r = await ask("What evidence supports SQLite as the source of truth?");
    expect(r.notEnoughEvidence).toBe(true);
    expect(r.answerMarkdown).toContain("don't have enough transcript-backed evidence");
    expect(r.hasUnconfirmed).toBe(false);
    expect(r.unconfirmed).toEqual([]);
  });

  it("factual_lookup never runs the unconfirmed branch", async () => {
    seedProject();
    const r = await ask("What is the source of truth for this app?");
    expect(r.queryUnderstanding.intent).toBe("factual_lookup");
    expect(r.hasUnconfirmed).toBe(false);
    expect(r.unconfirmed).toEqual([]);
  });
});

describe("Ask AI unconfirmed surfacing — classification & trust", () => {
  it("6/7/8/9/10. classifies review_only / tentative / possible_duplicate / degraded; skips rejected/superseded", async () => {
    const t = importTranscript(db, { filename: "T.txt", rawText: "Pat: Maybe avoid SQLite.\nPat: A plain review note.\nPat: A duplicate-ish note.\nPat: Degraded one." });
    repos.memoryObjects.createMemoryObject({ type: "preference", title: "Maybe avoid", generated_text: "Maybe we should avoid SQLite.", status: "needs_review", confidence: 0.4, created_by: "agent" }, [{ span_id: span(t.transcriptId, 0), role: "qualifies", evidence_score: 0.3 }]);
    repos.memoryObjects.createMemoryObject({ type: "topic", title: "Plain review note", generated_text: "A plain unresolved finding.", status: "needs_review", confidence: 0.5, created_by: "agent" }, [{ span_id: span(t.transcriptId, 1), role: "supports", evidence_score: 0.4 }]);
    const canon = repos.memoryObjects.createMemoryObject({ type: "topic", title: "Canonical note", generated_text: "Canonical finding.", confidence: 0.9, created_by: "agent" }, [{ span_id: span(t.transcriptId, 1), role: "supports", evidence_score: 0.9 }]);
    const dup = repos.memoryObjects.createMemoryObject({ type: "topic", title: "Dup note", generated_text: "A duplicate-ish finding.", status: "needs_review", confidence: 0.5, created_by: "agent" }, [{ span_id: span(t.transcriptId, 2), role: "supports", evidence_score: 0.4 }]);
    db.prepare("UPDATE memory_objects SET duplicate_of_id=? WHERE id=?").run(canon.id, dup.id);
    // degraded: needs_review with NO evidence span at all (allowed via the missing-evidence reason)
    repos.memoryObjects.createMemoryObject({ type: "topic", title: "Degraded one", generated_text: "Lost its evidence.", status: "needs_review", confidence: 0.5, created_by: "agent", metadata: { missing_evidence_reason: "transcript_deleted" } }, []);
    // rejected + superseded must NOT appear
    repos.memoryObjects.createMemoryObject({ type: "topic", title: "Rejected one", generated_text: "Rejected finding.", status: "rejected", confidence: 0.5, created_by: "agent" }, [{ span_id: span(t.transcriptId, 3), role: "supports", evidence_score: 0.4 }]);

    const r = await ask("What are the risks or uncertain ideas in this project?");
    const got = kinds(r);
    expect(got).toContain("tentative");          // "Maybe avoid"
    expect(got).toContain("review_only");         // "Plain review note"
    expect(got).toContain("possible_duplicate");  // duplicate_of set
    expect(got).toContain("degraded");            // no evidence span
    const degraded = (r.unconfirmed ?? []).find((u) => u.kind === "degraded");
    expect(degraded?.missingEvidence).toBe(true);
    expect(degraded?.evidenceUri).toBeUndefined(); // no evidence link
    expect((r.unconfirmed ?? []).some((u) => /Rejected/.test(u.text))).toBe(false); // rejected never surfaced
  });

  it("14/15/16/17. unconfirmed items are not claims/citations, create no pointers, and don't change confidence", async () => {
    const pointersBefore = (db.prepare("SELECT COUNT(*) c FROM evidence_pointers").get() as { c: number }).c;
    const sourceBefore = (db.prepare("SELECT COUNT(*) c FROM source_pointers").get() as { c: number }).c;
    seedProject();
    const created = { ptr: (db.prepare("SELECT COUNT(*) c FROM evidence_pointers").get() as { c: number }).c, src: (db.prepare("SELECT COUNT(*) c FROM source_pointers").get() as { c: number }).c };
    const r = await ask("What are the risks, conflicts, or uncertain ideas in this project?");
    // 14/15: unconfirmed never leak into claims or citations.
    expect(r.claims.every((c) => !c.id.startsWith("unc_"))).toBe(true);
    expect(r.citations.length).toBe(0);
    expect(r.unconfirmed!.every((u) => !("citationIds" in u) && !("supportStatus" in u))).toBe(true);
    // 16: the unconfirmed pass created NO new evidence/source pointers (only the seed's bridging did).
    expect((db.prepare("SELECT COUNT(*) c FROM evidence_pointers").get() as { c: number }).c).toBe(created.ptr);
    expect((db.prepare("SELECT COUNT(*) c FROM source_pointers").get() as { c: number }).c).toBe(created.src);
    expect(created.ptr).toBeGreaterThan(pointersBefore); expect(created.src).toBeGreaterThanOrEqual(sourceBefore);
    // 17: surfacing unconfirmed context did not fabricate transcript-backed confidence.
    expect(r.evidenceConfidence).toBe("no_evidence");
    expect(r.notEnoughEvidence).toBe(true);
  });
});

describe("Ask AI unconfirmed surfacing — MCP & reconstruction", () => {
  it("19. MCP bundle exposes unconfirmed[] separately from claims/citations, with a warning", async () => {
    seedProject();
    const r = await ask("What are the risks, conflicts, or uncertain ideas in this project?");
    const bundle = toAnswerBundle(r);
    expect(bundle.has_unconfirmed).toBe(true);
    expect(bundle.unconfirmed!.length).toBeGreaterThan(0);
    expect(bundle.claims.some((c) => c.claim_id.startsWith("unc_"))).toBe(false);
    expect(bundle.unconfirmed!.every((u) => "kind" in u && "label" in u && "warning" in u)).toBe(true);
    expect(bundle.warnings.some((w) => /not confirmed transcript-backed fact/i.test(w))).toBe(true);
  });

  it("sub-step B: a reconstructed answer restores structured unconfirmed[] (not as claims/citations)", async () => {
    seedProject();
    const live = await ask("What are the risks, conflicts, or uncertain ideas in this project?");
    expect(live.hasUnconfirmed).toBe(true);
    const reconstructed = getAskAIResponse(db, live.id);
    expect(reconstructed.hasUnconfirmed).toBe(true);
    expect((reconstructed.unconfirmed ?? []).map((u) => u.kind).sort()).toEqual((live.unconfirmed ?? []).map((u) => u.kind).sort());
    expect(reconstructed.claims).toHaveLength(0);
    expect(reconstructed.citations).toHaveLength(0);
    expect(reconstructed.answerMarkdown).toContain("Conflicts / tensions");
  });
});
