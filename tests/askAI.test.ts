import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValidationError, createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import {
  askAI, buildCitations, createDatabaseAskAIDependencies, generateClaimsFromEvidence, getAskAIResponse,
  renderAnswer, selectEvidenceForAnswer, understandQuestion, type AskAIEvidenceItem,
} from "../src/ask-ai/index.js";
import { scoreEvidenceBundle, type EvidenceCandidate } from "../src/evidence/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";

const now = () => new Date("2026-06-12T12:00:00.000Z");
const candidate = (overrides: Partial<EvidenceCandidate> = {}): EvidenceCandidate => ({
  id: "evp_1", evidencePointerId: "evp_1", transcriptId: "tr_1", spanIds: ["sp_1"],
  quote: "Alex: SQLite is the source of truth for the vault.", sourceKind: "raw_transcript_span",
  stance: "supports", retrievalScore: 0.95, keywordScore: 0.95, sourceConfidence: 0.95,
  provenanceValidated: true, metadata: { sourcePointerId: "mv://source/transcript/tr_1/span/sp_1" }, ...overrides,
});
const materialized = (overrides: Partial<AskAIEvidenceItem> = {}): AskAIEvidenceItem => ({
  evidencePointerId: "evp_1", sourcePointerId: "mv://source/transcript/tr_1/span/sp_1", transcriptId: "tr_1", spanId: "sp_1",
  quotePreview: "Alex: SQLite is the source of truth for the vault.", evidenceScore: 0.9, evidenceConfidence: "strong",
  scoringExplanation: "Direct raw span.", clickbackUri: "mv://evidence/evp_1", stance: "supports", sourceKind: "raw_transcript_span", ...overrides,
});

describe("Ask AI query understanding", () => {
  it("validates and normalizes questions while preserving filters", () => {
    expect(() => understandQuestion("   ")).toThrow(ValidationError);
    const query = understandQuestion("  What should I do after June 2026 compared with Acme?  ", {
      transcriptIds: ["tr_1"], entityIds: ["entity_1"],
    });
    expect(query).toMatchObject({
      normalizedQuestion: "What should I do after June 2026 compared with Acme?", answerMode: "recommendation",
      needsRecommendation: true, needsComparison: true, needsChronology: true, transcriptIds: ["tr_1"], entityIds: ["entity_1"],
    });
    expect(query.timeHints).toEqual(expect.arrayContaining(["after", "June", "2026"]));
  });
});

describe("Ask AI selection, claims, citations, and rendering", () => {
  it("selects direct strong evidence first, deduplicates spans, and respects limits", () => {
    const assessment = scoreEvidenceBundle({
      claimText: "SQLite is the source of truth", useType: "direct_fact", candidates: [
        candidate(), candidate({ id: "evp_dup", evidencePointerId: "evp_dup" }),
        candidate({ id: "evp_weak", evidencePointerId: "evp_weak", spanIds: ["sp_2"], quote: "SQLite was mentioned.", retrievalScore: 0.2, keywordScore: 0.2 }),
      ], now: now().toISOString(),
    });
    const selection = selectEvidenceForAnswer(assessment, { maxEvidenceItems: 1 });
    expect(selection.evidence).toHaveLength(1);
    expect(selection.evidence[0].evidencePointerId).toBe("evp_1");
  });

  it("rejects evidence without materialized provenance and preserves conflicts", () => {
    const conflict = scoreEvidenceBundle({
      claimText: "SQLite is truth", useType: "direct_fact", candidates: [
        candidate({ quote: "SQLite is truth." }),
        candidate({ id: "evp_2", evidencePointerId: "evp_2", spanIds: ["sp_2"], quote: "SQLite is not truth.", stance: "opposes" }),
      ],
    });
    expect(selectEvidenceForAnswer(conflict).confidence).toBe("conflicting");
    const unsupported = scoreEvidenceBundle({ claimText: "X", useType: "direct_fact", candidates: [candidate({ evidencePointerId: undefined })] });
    expect(selectEvidenceForAnswer(unsupported).confidence).toBe("no_evidence");
  });

  it("renders both supporting and opposing sides for conflicting evidence", async () => {
    const evidence = [materialized(), materialized({
      evidencePointerId: "evp_2", spanId: "sp_2", quotePreview: "Sam: SQLite is not the source of truth.",
      clickbackUri: "mv://evidence/evp_2", stance: "opposes",
    })];
    const citations = buildCitations(evidence);
    const claims = await generateClaimsFromEvidence(understandQuestion("Is SQLite the source of truth?"), evidence, citations, { confidence: "conflicting" });
    const answer = renderAnswer({ confidence: "conflicting", claims, citations });
    expect(claims).toHaveLength(2);
    expect(answer).toContain("SQLite is the source of truth");
    expect(answer).toContain("SQLite is not the source of truth");
  });

  it("builds stable citations, labels claim kinds, and rejects uncited rendering", async () => {
    const evidence = [materialized()];
    expect(buildCitations(evidence)).toEqual(buildCitations(evidence));
    const citations = buildCitations(evidence);
    const query = understandQuestion("Why should I use SQLite?");
    const claims = await generateClaimsFromEvidence(query, evidence, citations, { confidence: "strong" });
    expect(claims.find((claim) => claim.kind === "inference")).toMatchObject({ kind: "inference", evidencePointerIds: ["evp_1"], citationIds: [citations[0].id] });
    expect(renderAnswer({ confidence: "weak", claims, citations })).toContain("evidence I found is weak");
    expect(() => renderAnswer({ confidence: "strong", claims: [{ ...claims[0], citationIds: [] }], citations })).toThrow(ValidationError);
    expect(renderAnswer({ confidence: "no_evidence", claims: [], citations: [] })).toContain("enough transcript-backed evidence");
  });
});

describe("Ask AI pipeline", () => {
  it("calls retrieval before scoring, rejects unsupported LLM claims, and persists the final response hook", async () => {
    const order: string[] = [];
    let persisted = false;
    const response = await askAI({ question: "What is the source of truth?" }, {
      now,
      retrieveCandidates: async () => { order.push("retrieve"); return [candidate()]; },
      scoreEvidence: async (question, candidates) => { order.push("score"); return scoreEvidenceBundle({ claimText: question, useType: "direct_fact", candidates }); },
      llm: { generateClaims: async () => [{ kind: "fact", text: "Unsupported injected claim", evidencePointerIds: ["not-selected"] }] },
      persistAnswer: async () => { order.push("persist"); persisted = true; },
    });
    expect(order).toEqual(["retrieve", "score", "persist"]);
    expect(persisted).toBe(true);
    expect(response).toMatchObject({ evidenceConfidence: "no_evidence", claims: [], notEnoughEvidence: true });
  });

  it("returns a cited deterministic answer and propagates persistence failures", async () => {
    const deps = {
      now, retrieveCandidates: async () => [candidate()],
      createEvidencePointers: async () => [materialized()],
      persistAnswer: async () => undefined,
    };
    const response = await askAI({ question: "What is the source of truth?", includeSuggestedFollowups: true }, deps);
    expect(response.evidenceConfidence).toBe("strong");
    expect(response.answerMarkdown).toContain("[1](mv://evidence/evp_1)");
    expect(response.claims[0].evidencePointerIds).toEqual(["evp_1"]);
    await expect(askAI({ question: "Question" }, { ...deps, persistAnswer: async () => { throw new Error("write failed"); } })).rejects.toThrow("write failed");
  });
});

describe("Ask AI database integration", () => {
  let db: SqliteDatabase;
  let repos: ReturnType<typeof createRepositories>;
  beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); });
  afterEach(() => db.close());

  it("retrieves, scores, persists, reloads, and cascades structured Ask AI views", async () => {
    const imported = importTranscript(db, { filename: "ask.txt", rawText: "Alex: SQLite is the source of truth for the vault." });
    const transcript = db.prepare("SELECT source_id FROM transcripts WHERE id=?").get(imported.transcriptId) as { source_id: string };
    const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string };
    const memory = repos.memoryObjects.createMemoryObject(
      { type: "decision", generated_text: "SQLite is authoritative.", confidence: 0.95, created_by: "agent" },
      [{ span_id: span.id, role: "supports", evidence_score: 0.95 }],
    );
    const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.95 });
    await indexEvidencePointerForSearch(db, pointer.evidence_pointer_id);
    const response = await askAI({ question: "SQLite source of truth", includeSuggestedFollowups: true }, createDatabaseAskAIDependencies(db, { now }));
    expect(response.notEnoughEvidence).toBe(false);
    expect(getAskAIResponse(db, response.id)).toMatchObject({ id: response.id, scoreRunId: response.scoreRunId });
    expect(db.prepare("SELECT COUNT(*) count FROM ask_ai_run_evidence WHERE ask_ai_run_id=?").get(response.id)).toEqual({ count: 1 });
    const answer = db.prepare("SELECT evidence_bundle_id FROM ai_answers WHERE id=?").get(response.id) as { evidence_bundle_id: string };
    expect(db.prepare("SELECT COUNT(*) count FROM answer_claims WHERE answer_id=?").get(response.id)).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) count FROM citation_links WHERE answer_id=?").get(response.id)).toEqual({ count: 1 });
    db.prepare("DELETE FROM memory_objects WHERE id=?").run(memory.id);
    db.prepare("DELETE FROM ai_answers WHERE id=?").run(response.id);
    db.prepare("DELETE FROM evidence_bundles WHERE id=?").run(answer.evidence_bundle_id);
    db.prepare("DELETE FROM transcripts WHERE id=?").run(imported.transcriptId);
    expect(db.prepare("SELECT COUNT(*) count FROM ask_ai_run_evidence WHERE ask_ai_run_id=?").get(response.id)).toEqual({ count: 0 });
    expect(db.prepare("SELECT id FROM transcript_sources WHERE id=?").get(transcript.source_id)).toBeTruthy();
  });

  it("persists no-evidence refusals and ignores stale or filtered-out provenance", async () => {
    const imported = importTranscript(db, { filename: "stale.txt", rawText: "Alex: Evidence must resolve to raw text." });
    const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string };
    const memory = repos.memoryObjects.createMemoryObject(
      { type: "claim", generated_text: "Evidence resolves.", confidence: 0.9, created_by: "agent" },
      [{ span_id: span.id, role: "supports", evidence_score: 0.9 }],
    );
    const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.9 });
    await indexEvidencePointerForSearch(db, pointer.evidence_pointer_id);
    db.prepare("UPDATE source_pointers SET span_text_sha256='broken' WHERE pointer_uri=?").run(pointer.source_pointer_uri);
    const stale = await askAI({ question: "Evidence resolve raw text" }, createDatabaseAskAIDependencies(db, { now }));
    expect(stale).toMatchObject({ evidenceConfidence: "no_evidence", notEnoughEvidence: true, claims: [] });
    expect(db.prepare("SELECT answer_status FROM ai_answers WHERE id=?").get(stale.id)).toEqual({ answer_status: "refused_no_evidence" });
    const filtered = await askAI({ question: "Evidence resolve raw text", transcriptIds: ["missing"] }, createDatabaseAskAIDependencies(db, { now }));
    expect(filtered.evidenceConfidence).toBe("no_evidence");
  });
});
