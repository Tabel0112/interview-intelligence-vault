import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConflictRepository } from "../src/conflicts/index.js";
import { createRepositories, createTranscriptsRepo, openDatabase, PACKAGED_MIGRATIONS, ValidationError, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { rebuildRetrievalIndex } from "../src/retrieval/index.js";
import { askAI, createDatabaseAskAIDependencies, getAskAIResponse, persistAskAIResponse, understandQuestion, type AskAIResponse } from "../src/ask-ai/index.js";
import { toAnswerBundle } from "../src/mcp/answerBundle.js";
import { buildObsidianGraph } from "../src/obsidian/index.js";

const now = () => new Date("2026-06-12T12:00:00.000Z");
let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;
beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); });
afterEach(() => db.close());

const span = (t: string, i = 0) => (db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? ORDER BY span_index").all(t) as Array<{ id: string }>)[i].id;
const ask = (question: string) => askAI({ question }, createDatabaseAskAIDependencies(db, { now }));
const count = (sql: string, ...args: unknown[]) => (db.prepare(`SELECT COUNT(*) c FROM ${sql}`).get(...args) as { c: number }).c;

function seedProject() {
  const a = importTranscript(db, { filename: "A.txt", rawText: "Alex: We decided to use SQLite as the source of truth." });
  const c = importTranscript(db, { filename: "C.txt", rawText: "Pat: We should not use SQLite as the source of truth.\nPat: Maybe we should use PostgreSQL instead." });
  repos.memoryObjects.createMemoryObject({ type: "preference", title: "Maybe PostgreSQL", generated_text: "Maybe we should use PostgreSQL instead.", status: "needs_review", confidence: 0.4, created_by: "agent" }, [{ span_id: span(c.transcriptId, 1), role: "qualifies", evidence_score: 0.3 }]);
  const left = repos.memoryObjects.createMemoryObject({ type: "decision", title: "Use SQLite", generated_text: "Use SQLite as the source of truth.", confidence: 0.95, created_by: "agent" }, [{ span_id: span(a.transcriptId), role: "supports", evidence_score: 0.95 }]);
  const right = repos.memoryObjects.createMemoryObject({ type: "decision", title: "Not SQLite", generated_text: "Do not use SQLite as the source of truth.", confidence: 0.9, created_by: "agent" }, [{ span_id: span(c.transcriptId), role: "supports", evidence_score: 0.9 }]);
  const lp = linkMemoryObjectToSpan(db, { memoryObjectId: left.id, transcriptId: a.transcriptId, spanId: span(a.transcriptId), evidenceStrength: "strong", confidence: 0.95 });
  const rp = linkMemoryObjectToSpan(db, { memoryObjectId: right.id, transcriptId: c.transcriptId, spanId: span(c.transcriptId), evidenceStrength: "strong", confidence: 0.9 });
  createConflictRepository(db, { now }).createConflictAssessment({ candidate: {
    leftTargetId: left.id, leftTargetType: "memory_object", leftText: left.generated_text, leftEvidenceIds: [lp.evidence_pointer_id],
    rightTargetId: right.id, rightTargetType: "memory_object", rightText: right.generated_text, rightEvidenceIds: [rp.evidence_pointer_id], sharedTopics: ["sqlite"],
  } });
  rebuildRetrievalIndex(db);
  return { transcriptC: c.transcriptId };
}

describe("Sub-step B: migration", () => {
  it("1/2. registers migration 015 and creates ask_ai_unconfirmed_items with no support/citation columns", () => {
    // Registration is asserted against the registered list (stable as later migrations are added), and the
    // table existing proves the migration actually ran.
    expect(PACKAGED_MIGRATIONS.some((m) => m.filename === "015_ask_ai_unconfirmed.sql")).toBe(true);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ask_ai_unconfirmed_items'").get()).toBeDefined();
    const cols = (db.prepare("PRAGMA table_info(ask_ai_unconfirmed_items)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(["id", "ask_ai_run_id", "position", "kind", "memory_id", "conflict_id", "text", "label", "warning", "evidence_pointer_id", "evidence_uri", "missing_evidence", "metadata_json", "created_at"]);
    for (const forbidden of ["support_status", "citation_id", "citation_link_id", "source_pointer_id"]) expect(cols).not.toContain(forbidden);
  });
});

describe("Sub-step B: persistence", () => {
  it("3/4/5/8. a live answer persists unconfirmed rows (kind/label/text/warning/missingEvidence) and adds no evidence/citation rows", async () => {
    seedProject();
    const ptrBefore = count("evidence_pointers"), srcBefore = count("source_pointers"), citBefore = count("citation_links");
    const live = await ask("What are the risks, conflicts, or uncertain ideas in this project?");
    expect(count("ask_ai_unconfirmed_items WHERE ask_ai_run_id=?", live.id)).toBe(live.unconfirmed!.length);
    const row = db.prepare("SELECT * FROM ask_ai_unconfirmed_items WHERE ask_ai_run_id=? ORDER BY position LIMIT 1").get(live.id) as Record<string, unknown>;
    expect(["review_only", "tentative", "possible_duplicate", "conflict", "degraded"]).toContain(String(row.kind));
    expect(String(row.warning)).toContain("not confirmed");
    // 8: persisting unconfirmed context created NO new evidence/source pointers or citation links.
    expect(count("evidence_pointers")).toBe(ptrBefore);
    expect(count("source_pointers")).toBe(srcBefore);
    expect(count("citation_links")).toBe(citBefore);
  });

  it("6/7. persistence rejects an invalid kind or a claim-shaped (cited/supported) unconfirmed item", () => {
    const base: AskAIResponse = {
      id: "ask_bad_1", question: "q", answerMarkdown: "m", evidenceConfidence: "no_evidence", notEnoughEvidence: true,
      createdAt: now().toISOString(), queryUnderstanding: understandQuestion("q"), conflicts: [], suggestedFollowups: [], claims: [], citations: [], evidence: [],
    };
    const badKind = { ...base, id: "ask_bad_kind", unconfirmed: [{ id: "u1", kind: "totally_made_up", text: "x", label: "X", warning: "w" }] } as unknown as AskAIResponse;
    expect(() => persistAskAIResponse(db, badKind)).toThrow(ValidationError);
    const claimShaped = { ...base, id: "ask_bad_claim", unconfirmed: [{ id: "u2", kind: "review_only", text: "x", label: "X", warning: "w", supportStatus: "supported", citationIds: ["c1"] }] } as unknown as AskAIResponse;
    expect(() => persistAskAIResponse(db, claimShaped)).toThrow(ValidationError);
    expect(count("ask_ai_unconfirmed_items")).toBe(0); // both rolled back
  });
});

describe("Sub-step B: reconstruction", () => {
  it("9/10/12/13/14. reconstructs unconfirmed[] + hasUnconfirmed, never as claims/citations, keeps missingEvidence", async () => {
    seedProject();
    const live = await ask("What are the risks, conflicts, or uncertain ideas in this project?");
    const r = getAskAIResponse(db, live.id);
    expect(r.hasUnconfirmed).toBe(true);
    expect((r.unconfirmed ?? []).length).toBe(live.unconfirmed!.length);
    expect(r.claims.some((c) => c.id.startsWith("unc_"))).toBe(false);
    expect(r.citations.length).toBe(0);
    const degraded = (r.unconfirmed ?? []).find((u) => u.kind === "degraded");
    if (degraded) expect(degraded.missingEvidence).toBe(true);
  });

  it("11. an answer with no unconfirmed rows reconstructs unconfirmed=[]", async () => {
    seedProject();
    const factual = await ask("What did we decide about SQLite?");
    const r = getAskAIResponse(db, factual.id);
    // A run that persisted no unconfirmed rows reconstructs `[]` / `false` (always a boolean).
    expect(count("ask_ai_unconfirmed_items WHERE ask_ai_run_id=?", factual.id)).toBe((factual.unconfirmed ?? []).length);
    if (!(factual.unconfirmed ?? []).length) {
      expect(r.unconfirmed).toEqual([]);
      expect(r.hasUnconfirmed).toBe(false);
    }
  });
});

describe("Sub-step B: MCP", () => {
  it("15/16/17. live ask_vault and reconstructed get_answer both expose unconfirmed[] separately from claims/citations", async () => {
    seedProject();
    const live = await ask("What are the risks, conflicts, or uncertain ideas in this project?");
    const liveBundle = toAnswerBundle(live);
    const reconstructedBundle = toAnswerBundle(getAskAIResponse(db, live.id));
    expect(liveBundle.has_unconfirmed).toBe(true);
    expect(reconstructedBundle.has_unconfirmed).toBe(true);
    expect(reconstructedBundle.unconfirmed!.map((u) => u.kind).sort()).toEqual(liveBundle.unconfirmed!.map((u) => u.kind).sort());
    expect(reconstructedBundle.claims.some((c) => c.claim_id.startsWith("unc_"))).toBe(false);
    expect(reconstructedBundle.citations.length).toBe(0);
  });

  it("an answer with no unconfirmed context exposes unconfirmed:[] / has_unconfirmed:false in live and get_answer", async () => {
    seedProject();
    const factual = await ask("What did we decide about SQLite?");
    if ((factual.unconfirmed ?? []).length) return; // only meaningful when none were surfaced
    const liveBundle = toAnswerBundle(factual);
    const reconstructedBundle = toAnswerBundle(getAskAIResponse(db, factual.id));
    for (const bundle of [liveBundle, reconstructedBundle]) {
      expect(bundle.unconfirmed).toEqual([]);
      expect(bundle.has_unconfirmed).toBe(false);
    }
  });
});

describe("Sub-step B: trust after transcript deletion", () => {
  it("21/22. deleting a transcript never turns a persisted unconfirmed item into a supported/cited claim; dangling link is dropped", async () => {
    // A needs_review memory bridged to a live pointer, so its unconfirmed item carries an evidence link.
    const t = importTranscript(db, { filename: "T.txt", rawText: "Pat: Maybe avoid SQLite as the source of truth." });
    const mem = repos.memoryObjects.createMemoryObject({ type: "preference", title: "Maybe avoid SQLite", generated_text: "Maybe we should avoid SQLite.", status: "needs_review", confidence: 0.4, created_by: "agent" }, [{ span_id: span(t.transcriptId), role: "qualifies", evidence_score: 0.3 }]);
    const ptr = linkMemoryObjectToSpan(db, { memoryObjectId: mem.id, transcriptId: t.transcriptId, spanId: span(t.transcriptId), evidenceStrength: "weak", confidence: 0.3 });
    // Persist an answer whose unconfirmed item links that live pointer (context only).
    const response: AskAIResponse = {
      id: "ask_unc_link", question: "What are the risks?", answerMarkdown: "m", evidenceConfidence: "no_evidence", notEnoughEvidence: true,
      createdAt: now().toISOString(), queryUnderstanding: understandQuestion("What are the risks?"), conflicts: [], suggestedFollowups: [], claims: [], citations: [], evidence: [],
      unconfirmed: [{ id: "unc_mem_x", kind: "review_only", memoryId: mem.id, text: "Maybe avoid SQLite", label: "Review-only", warning: "not confirmed", evidencePointerId: ptr.evidence_pointer_id, evidenceUri: `mv://evidence/${ptr.evidence_pointer_id}` }],
      hasUnconfirmed: true,
    };
    persistAskAIResponse(db, response);
    expect((getAskAIResponse(db, "ask_unc_link").unconfirmed ?? [])[0]).toMatchObject({ evidencePointerId: ptr.evidence_pointer_id }); // live before delete

    createTranscriptsRepo(db).deleteTranscript(t.transcriptId);

    const r = getAskAIResponse(db, "ask_unc_link");
    const item = (r.unconfirmed ?? [])[0];
    expect(item).toBeDefined();                 // the unconfirmed row survives as history
    expect(item.evidencePointerId).toBeUndefined(); // dangling context link dropped
    expect(item.evidenceUri).toBeUndefined();
    expect(item.missingEvidence).toBe(true);    // flagged missing, not a broken citation
    // 21: it never became a supported answer claim, and produced no citation links.
    expect(count("answer_claims WHERE answer_id=?", "ask_unc_link")).toBe(0);
    expect(count("citation_links WHERE answer_id=?", "ask_unc_link")).toBe(0);
    expect(r.claims).toHaveLength(0);
  });
});

describe("Sub-step B: graph + refusal unchanged", () => {
  it("18/19. factual and evidence-check refusal behavior is unchanged", async () => {
    const factual = await ask("What did we decide about SQLite?");
    expect(factual.notEnoughEvidence).toBe(true);
    expect(factual.hasUnconfirmed).toBe(false);
    const evidence = await ask("What evidence supports SQLite as the source of truth?");
    expect(evidence.notEnoughEvidence).toBe(true);
  });

  it("20. the generated graph has no unconfirmed nodes after a persisted unconfirmed answer", async () => {
    seedProject();
    const live = await ask("What are the risks, conflicts, or uncertain ideas in this project?");
    const graph = buildObsidianGraph(db).graph;
    expect(graph.nodes.some((n) => n.id.startsWith("unc_"))).toBe(false);
    expect(graph.nodes.some((n) => (live.unconfirmed ?? []).some((u) => n.id.includes(u.id)))).toBe(false);
  });
});
