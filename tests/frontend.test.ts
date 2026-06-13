import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askAI, createDatabaseAskAIDependencies, type AskAIResponse } from "../src/ask-ai/index.js";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, matchRoute, renderPage, renderRoute, routeHref, validateTranscriptUpload, type FrontendApi } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";

const now = () => new Date("2026-06-13T12:00:00.000Z");
let db: SqliteDatabase;

beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

async function fixture() {
  const repos = createRepositories(db);
  const rawText = "Alex: SQLite is the structured source of truth.\nSam: Weak evidence must stay visibly weak.";
  const imported = importTranscript(db, { filename: "frontend.txt", rawText, importedAt: now().toISOString() });
  const spans = db.prepare("SELECT id,text FROM transcript_spans WHERE transcript_id=? ORDER BY ordinal").all(imported.transcriptId) as Array<{ id: string; text: string }>;
  const strong = repos.memoryObjects.createMemoryObject(
    { type: "decision", title: "SQLite source of truth", generated_text: "SQLite is authoritative.", confidence: 0.95, created_by: "agent" },
    [{ span_id: spans[0].id, role: "supports", evidence_score: 0.95 }],
  );
  const pointer = linkMemoryObjectToSpan(db, {
    memoryObjectId: strong.id, transcriptId: imported.transcriptId, spanId: spans[0].id,
    evidenceRole: "support", evidenceStrength: "strong", confidence: 0.95,
  });
  await indexEvidencePointerForSearch(db, pointer.evidence_pointer_id);
  const weak = repos.memoryObjects.createMemoryObject(
    { type: "claim", title: "Review weak statement", generated_text: "Weak statement.", status: "needs_review", confidence: 0.3, created_by: "agent" },
    [{ span_id: spans[1].id, role: "context", evidence_score: 0.3 }],
  );
  return { rawText, imported, spans, strong, weak, pointer };
}

describe("frontend routes and trust rendering", () => {
  it("matches every required MVP route", () => {
    expect([
      "/", "/upload", "/transcripts/tr_1?span=sp_1", "/ask", "/answers/a_1", "/evidence/e_1",
      "/memory/m_1", "/graph", "/search?q=truth", "/review", "/review/item_1",
    ].map((path) => matchRoute(path).id)).toEqual([
      "dashboard", "upload", "transcript", "ask", "answer", "evidence",
      "memory", "graph", "search", "review", "review_detail",
    ]);
  });

  it("renders upload selection, processing, and validation states", async () => {
    const api = createSqliteFrontendApi(db, { now });
    const html = await renderRoute(api, "/upload");
    expect(html).toContain('type="file"');
    expect(html).toContain("No file selected");
    expect(html).toContain("Importing immutable transcript source");
    expect(() => validateTranscriptUpload({ filename: "bad.pdf", rawText: "text" })).toThrow("Unsupported transcript type");
    await expect(api.uploadTranscript({ filename: "empty.txt", rawText: " " })).rejects.toThrow("non-empty");
    expect(await renderRoute(api, "/ask")).toContain("Optional transcript filter");
  });

  it("renders every primary plugin page inside the scoped app shell", async () => {
    const api = createSqliteFrontendApi(db, { now });
    for (const route of ["/", "/upload", "/ask", "/search", "/graph", "/review"]) {
      const html = await renderRoute(api, route);
      expect(html).toContain('class="transcript-memory-vault vault-app"');
      expect(html).toContain('aria-label="Primary"');
      expect(html).toContain('data-route="mv://dashboard"');
    }
  });

  it("renders explicit weak, conflicting, and no-evidence answer states", async () => {
    const answer = (confidence: AskAIResponse["evidenceConfidence"]): AskAIResponse => {
      const hasEvidence = confidence !== "no_evidence";
      return ({
      id: "ask_1", question: "What is true?", answerMarkdown: "Answer", evidenceConfidence: confidence, suggestedFollowups: [], notEnoughEvidence: !hasEvidence,
      claims: hasEvidence ? [{ id: "claim_1", kind: "fact", text: "Traceable claim", supportStatus: confidence === "conflicting" ? "conflicting" : "weakly_supported", evidencePointerIds: ["evp_1"], citationIds: ["cit_1"] }] : [],
      citations: hasEvidence ? [{ id: "cit_1", label: "[1]", evidencePointerId: "evp_1", transcriptId: "tr_1", spanId: "sp_1", quotePreview: "Source", clickbackUri: "mv://evidence/evp_1" }] : [],
      evidence: hasEvidence ? [{ evidencePointerId: "evp_1", transcriptId: "tr_1", spanId: "sp_1", quotePreview: "Source", evidenceScore: 0.4, evidenceConfidence: confidence, scoringExplanation: "Traceable", clickbackUri: "mv://evidence/evp_1", stance: confidence === "conflicting" ? "opposes" : "supports", sourceKind: "raw_transcript_span" }] : [],
      createdAt: now().toISOString(), queryUnderstanding: {
        originalQuestion: "What is true?", normalizedQuestion: "What is true?", answerMode: "direct", detectedEntities: [],
        detectedTopics: [], timeHints: [], requestedClaimKinds: ["fact"], needsRecommendation: false, needsComparison: false,
        needsChronology: false, shouldUseMemoryObjects: true, shouldUseRawTranscriptSpans: true, transcriptIds: [], entityIds: [], memoryObjectIds: [],
      }, conflicts: [],
    });
    };
    for (const state of ["weak", "conflicting", "no_evidence"] as const) {
      const api = { getAnswer: async () => answer(state) } as unknown as FrontendApi;
      const rendered = await renderPage({ api, route: matchRoute("/answers/ask_1") });
      expect(rendered.html).toContain(`data-trust-state="${state}"`);
      if (state !== "no_evidence") expect(rendered.html).toContain("citation-preview");
    }
  });

  it("does not display an unsupported answer as confident", async () => {
    const unsupported = {
      id: "ask_bad", question: "Unsupported?", answerMarkdown: "Trust me", evidenceConfidence: "strong",
      claims: [], citations: [], evidence: [], suggestedFollowups: [], notEnoughEvidence: false, createdAt: now().toISOString(),
      queryUnderstanding: {
        originalQuestion: "Unsupported?", normalizedQuestion: "Unsupported?", answerMode: "direct", detectedEntities: [], detectedTopics: [],
        timeHints: [], requestedClaimKinds: ["fact"], needsRecommendation: false, needsComparison: false, needsChronology: false,
        shouldUseMemoryObjects: true, shouldUseRawTranscriptSpans: true, transcriptIds: [], entityIds: [], memoryObjectIds: [],
      }, conflicts: [],
    } satisfies AskAIResponse;
    const api = { getAnswer: async () => unsupported } as unknown as FrontendApi;
    const html = await renderRoute(api, "/answers/ask_bad");
    expect(html).toContain('data-trust-state="no_evidence"');
    expect(html).not.toContain('data-trust-state="strong"');
  });
});

describe("SQLite frontend adapter", () => {
  it("preserves the answer to citation to evidence to exact transcript span chain", async () => {
    const seeded = await fixture();
    const response = await askAI({ question: "SQLite structured source truth" }, createDatabaseAskAIDependencies(db, { now }));
    const api = createSqliteFrontendApi(db, { now });
    const answerHtml = await renderRoute(api, routeHref.answer(response.id));
    expect(answerHtml).toContain(routeHref.evidence(seeded.pointer.evidence_pointer_id));
    expect(answerHtml).toContain("Generated answer");

    const evidenceHtml = await renderRoute(api, routeHref.evidence(seeded.pointer.evidence_pointer_id));
    expect(evidenceHtml).toContain(routeHref.transcript(seeded.imported.transcriptId, seeded.spans[0].id));
    expect(evidenceHtml).toContain("supporting");

    const transcriptHtml = await renderRoute(api, routeHref.transcript(seeded.imported.transcriptId, seeded.spans[0].id));
    expect(transcriptHtml).toContain(`data-selected-span="${seeded.spans[0].id}"`);
    expect(transcriptHtml).toContain("selected-span");
    expect(transcriptHtml).toContain("Raw transcript source is immutable");
    expect(transcriptHtml).toContain("Copy quote");
    expect(await renderRoute(api, routeHref.transcript(seeded.imported.transcriptId, "missing"))).toContain("Requested span");
    const duplicate = await api.uploadTranscript({ filename: "frontend.txt", rawText: seeded.rawText });
    expect(duplicate).toMatchObject({ status: "duplicate", transcriptId: seeded.imported.transcriptId });
  });

  it("surfaces canonical review-only memory and broken provenance without promoting trust", async () => {
    const seeded = await fixture();
    const api = createSqliteFrontendApi(db, { now });
    const answer = await askAI({ question: "SQLite structured source truth" }, createDatabaseAskAIDependencies(db, { now }));
    const memory = await api.getMemory(seeded.weak.id);
    expect(memory).toMatchObject({ trustState: "needs_review" });
    expect(await api.getMemoryObject(seeded.weak.id)).toEqual(memory);
    expect(await renderRoute(api, routeHref.memory(seeded.weak.id))).toContain('data-trust-state="needs_review"');

    db.prepare("UPDATE source_pointers SET span_text_sha256='broken' WHERE pointer_uri=?").run(seeded.pointer.source_pointer_uri);
    const evidence = await api.getEvidence(seeded.pointer.evidence_pointer_id);
    expect(evidence).toMatchObject({ strength: "broken", brokenReason: "hash_mismatch" });
    expect(await renderRoute(api, routeHref.answer(answer.id))).toContain("citation pointer(s) no longer resolve");
    const review = await api.listReviewItems();
    expect(review).toEqual(expect.arrayContaining([expect.objectContaining({
      type: "broken_pointer", trustState: "broken", severity: "high", status: "open",
      relatedTranscriptIds: [seeded.imported.transcriptId], relatedEvidenceIds: [seeded.pointer.evidence_pointer_id],
    })]));
    expect((await api.listReviewItems({ type: "broken_pointer", status: "open" })).length).toBeGreaterThanOrEqual(1);
    expect(await renderRoute(api, `/review/broken:${seeded.pointer.evidence_pointer_id}`)).toContain("Linked evidence");
  });

  it("uses existing ingestion/search/graph services and appends corrections without mutating raw text", async () => {
    const seeded = await fixture();
    const api = createSqliteFrontendApi(db, { now });
    expect((await api.askAI("SQLite structured source truth", { transcriptIds: [seeded.imported.transcriptId] })).question).toBe("SQLite structured source truth");
    expect(await api.search("source of truth")).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "transcript", href: routeHref.transcript(seeded.imported.transcriptId) }),
      expect.objectContaining({ type: "memory_object", trustState: "strong" }),
      expect.objectContaining({ href: routeHref.evidence(seeded.pointer.evidence_pointer_id), trustState: "strong" }),
    ]));
    expect(await api.searchVault("source of truth", { evidenceStrength: "strong" })).toMatchObject({
      transcripts: [], answers: [], memoryObjects: [expect.objectContaining({ type: "memory_object" })],
      evidence: [expect.objectContaining({ type: "evidence", trustState: "strong" })],
    });
    const searchHtml = await renderRoute(api, "/search?q=source%20of%20truth&strength=strong");
    expect(searchHtml).toContain("evidence scores decide how much to trust it");
    expect(searchHtml).toContain("<h2>evidence</h2>");
    const graph = await api.getGraph();
    expect(graph.graph.edges.some((edge) => edge.evidencePointerId === seeded.pointer.evidence_pointer_id)).toBe(true);
    const graphHtml = await renderRoute(api, "/graph?limit=1");
    expect(graphHtml).toContain("max 100");
    expect(graphHtml).toContain("Showing 1 of");
    const selectedGraphHtml = await renderRoute(api, `/graph?selectedNode=${encodeURIComponent(graph.graph.nodes[0].id)}`);
    expect(selectedGraphHtml).toContain("Selected node");

    const correction = await api.submitCorrection({
      targetType: "memory_object", targetId: seeded.weak.id, correctionText: "Clarify this in review.", reason: "Needs context",
    });
    expect(correction.correctionId).toMatch(/^corr_/);
    expect(db.prepare("SELECT COUNT(*) count FROM user_corrections WHERE target_id=?").get(seeded.weak.id)).toEqual({ count: 1 });
    expect(await api.listReviewItems()).toEqual(expect.arrayContaining([expect.objectContaining({ type: "user_correction", trustState: "needs_review" })]));
    expect(await renderRoute(api, routeHref.memory(seeded.weak.id))).toContain("Submit a correction");
    const evidenceCorrection = await api.submitCorrection({ targetType: "evidence", targetId: seeded.pointer.evidence_pointer_id, correctionText: "Review pointer wording." });
    expect(evidenceCorrection.correctionId).toMatch(/^corr_/);
    const normalized = db.prepare("SELECT target_type,target_id,metadata_json FROM user_corrections WHERE id=?").get(evidenceCorrection.correctionId) as { target_type: string; target_id: string; metadata_json: string };
    expect(normalized).toMatchObject({ target_type: "memory_object", target_id: seeded.strong.id });
    expect(JSON.parse(normalized.metadata_json)).toMatchObject({ requested_target_type: "evidence", requested_target_id: seeded.pointer.evidence_pointer_id });
    expect((db.prepare("SELECT raw_text FROM transcripts WHERE id=?").get(seeded.imported.transcriptId) as { raw_text: string }).raw_text).toBe(seeded.rawText);
  });

  it("limits dashboard and transcript rendering for large vaults", async () => {
    for (let index = 0; index < 12; index += 1) {
      importTranscript(db, { filename: `many-${index}.txt`, rawText: `Speaker: Unique transcript ${index}.` });
    }
    const api = createSqliteFrontendApi(db, { now });
    const dashboard = await api.getDashboard();
    expect(dashboard.totalTranscriptCount).toBe(12);
    expect(dashboard.transcripts).toHaveLength(10);
    expect(await renderRoute(api, "/")).toContain("Quick actions");
  });
});
