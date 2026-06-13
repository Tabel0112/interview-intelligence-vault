import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, ValidationError, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import {
  createAnswerClaim, createCitationLinksForAnswer, createEvidencePointer, createSourcePointerForSpan,
  formatCitationLabel, getEvidenceForTarget, linkAnswerClaimToEvidence, linkGraphEdgeToSpan, linkGraphNodeToSpan,
  linkMemoryObjectToSpan, makeEvidencePointerUri, makeSourcePointerUri, parseEvidencePointerUri, parseSourcePointerUri,
  renderCitationMarkdown, resolveClickback, resolveEvidencePointer, resolveSourcePointer, validateAnswerProvenance,
  validateTargetHasEvidence,
} from "../src/provenance/index.js";

let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;

const fixtureText = `Speaker A: I prefer using Obsidian as the frontend because the vault should stay readable.
Speaker B: But the database should be the source of truth, not Markdown files.
Speaker A: Weak evidence should not be treated as certainty.
Speaker B: If evidence conflicts, both sides should be shown.`;

beforeEach(() => {
  db = openDatabase(":memory:");
  repos = createRepositories(db);
});
afterEach(() => db.close());

function fixture() {
  const imported = importTranscript(db, { filename: "provenance.txt", rawText: fixtureText, sourceType: "test" });
  const spans = db.prepare("SELECT id,transcript_id,text FROM transcript_spans WHERE transcript_id=? ORDER BY span_index")
    .all(imported.transcriptId) as Array<{ id: string; transcript_id: string; text: string }>;
  return { imported, spans };
}

function answerFixture(spanId: string) {
  const bundle = repos.evidence.createEvidenceBundle({ purpose: "ask_ai", status: "mixed" });
  repos.evidence.addEvidenceItem(bundle.id, { span_id: spanId, final_score: 0.6, stance: "supports" });
  return repos.answers.createAnswer({ question_text: "What matters?", answer_text: "Database truth.", evidence_bundle_id: bundle.id, confidence: "medium", answer_status: "answered" });
}

describe("pointer formatting and source pointers", () => {
  it("formats, parses, validates, and resolves source pointers idempotently", () => {
    const { imported, spans } = fixture();
    const uri = makeSourcePointerUri({ transcriptId: imported.transcriptId, spanId: spans[0].id });
    expect(parseSourcePointerUri(uri)).toEqual({ transcriptId: imported.transcriptId, spanId: spans[0].id });
    expect(() => parseSourcePointerUri("mv://source/bad")).toThrow(ValidationError);
    const first = createSourcePointerForSpan(db, { transcriptId: imported.transcriptId, spanId: spans[0].id });
    const second = createSourcePointerForSpan(db, { transcriptId: imported.transcriptId, spanId: spans[0].id });
    expect(second).toEqual(first);
    const resolved = resolveSourcePointer(db, first.pointer_uri);
    expect(resolved.ok && resolved.spanText).toBe(spans[0].text);
    expect(resolveClickback(db, first.pointer_uri)).toMatchObject({ ok: true, kind: "source_span", spanId: spans[0].id, spanText: spans[0].text });
  });

  it("returns explicit broken-pointer and hash-mismatch results", () => {
    const { imported, spans } = fixture();
    expect(resolveSourcePointer(db, makeSourcePointerUri({ transcriptId: imported.transcriptId, spanId: "missing" }))).toMatchObject({ ok: false, reason: "not_found" });
    const pointer = createSourcePointerForSpan(db, { transcriptId: imported.transcriptId, spanId: spans[0].id });
    db.prepare("UPDATE source_pointers SET span_text_sha256='corrupt' WHERE pointer_uri=?").run(pointer.pointer_uri);
    expect(resolveSourcePointer(db, pointer.pointer_uri)).toMatchObject({ ok: false, reason: "hash_mismatch" });
  });
});

describe("evidence pointers and integrations", () => {
  it("creates source pointers automatically with stable role-sensitive IDs", () => {
    const { imported, spans } = fixture();
    const base = { targetType: "answer" as const, targetId: answerFixture(spans[0].id).id, transcriptId: imported.transcriptId, spanId: spans[0].id, evidenceStrength: "strong" as const, confidence: 0.9 };
    const support = createEvidencePointer(db, { ...base, evidenceRole: "support" });
    const repeated = createEvidencePointer(db, { ...base, evidenceRole: "support" });
    const opposition = createEvidencePointer(db, { ...base, evidenceRole: "opposition" });
    expect(repeated.evidence_pointer_id).toBe(support.evidence_pointer_id);
    expect(opposition.evidence_pointer_id).not.toBe(support.evidence_pointer_id);
    expect(parseEvidencePointerUri(makeEvidencePointerUri(support.evidence_pointer_id))).toEqual({ evidencePointerId: support.evidence_pointer_id });
    expect(db.prepare("SELECT COUNT(*) count FROM source_pointers").get()).toEqual({ count: 1 });
    expect(resolveEvidencePointer(db, support.pointer_uri)).toMatchObject({ ok: true, spanText: spans[0].text });
    expect(resolveClickback(db, support.pointer_uri)).toMatchObject({ ok: true, kind: "evidence", evidencePointerId: support.evidence_pointer_id, spanText: spans[0].text });
  });

  it("rejects invalid role, strength, confidence, and scores", () => {
    const { imported, spans } = fixture();
    const answer = answerFixture(spans[0].id);
    const base = { targetType: "answer" as const, targetId: answer.id, transcriptId: imported.transcriptId, spanId: spans[0].id, evidenceRole: "support" as const, evidenceStrength: "strong" as const, confidence: 0.8 };
    expect(() => createEvidencePointer(db, { ...base, confidence: -0.1 })).toThrow(ValidationError);
    expect(() => createEvidencePointer(db, { ...base, evidenceRole: "invalid" as never })).toThrow(ValidationError);
    expect(() => createEvidencePointer(db, { ...base, evidenceStrength: "invalid" as never })).toThrow(ValidationError);
    expect(() => createEvidencePointer(db, { ...base, finalScore: 1.1 })).toThrow(ValidationError);
  });

  it("links memory objects and graph objects to exact spans", () => {
    const { imported, spans } = fixture();
    const memory = repos.memoryObjects.createMemoryObject({ type: "claim", generated_text: "Review me", status: "needs_review", confidence: 0.5, created_by: "agent", metadata: { reason: "missing_evidence" } }, []);
    expect(() => repos.memoryObjects.updateMemoryObjectStatus(memory.id, "active")).toThrow();
    linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: spans[0].id });
    repos.memoryObjects.updateMemoryObjectStatus(memory.id, "active");
    expect(validateTargetHasEvidence(db, { targetType: "memory_object", targetId: memory.id }).ok).toBe(true);

    const a = repos.graph.createGraphNode({ node_type: "topic", ref_id: "a", label: "A" });
    const b = repos.graph.createGraphNode({ node_type: "topic", ref_id: "b", label: "B" });
    const edge = repos.graph.createGraphEdge({ from_node_id: a.id, to_node_id: b.id, edge_type: "related_to", source_type: "inferred", confidence: 0.5 });
    expect(linkGraphNodeToSpan(db, { graphNodeId: a.id, transcriptId: imported.transcriptId, spanId: spans[1].id }).target_type).toBe("graph_node");
    expect(linkGraphEdgeToSpan(db, { graphEdgeId: edge.id, transcriptId: imported.transcriptId, spanId: spans[2].id, evidenceRole: "conditional", evidenceStrength: "mixed", confidence: 0.7 }).target_type).toBe("graph_edge");
  });

  it("uses separate evidence pointers for multiple spans and truncates previews", () => {
    const raw = `Speaker A: ${"Long evidence ".repeat(300)}`;
    const imported = importTranscript(db, { filename: "long.txt", rawText: raw });
    const spans = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? ORDER BY span_index").all(imported.transcriptId) as Array<{ id: string }>;
    const memory = repos.memoryObjects.createMemoryObject({ type: "claim", generated_text: "Long", status: "needs_review", confidence: 0.4, created_by: "agent", metadata: { reason: "missing_evidence" } }, []);
    const pointers = spans.slice(0, 2).map((span) => linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id }));
    expect(new Set(pointers.map((pointer) => pointer.evidence_pointer_id)).size).toBe(2);
    expect(pointers[0].quote_preview.length).toBeLessThanOrEqual(240);
    expect(pointers[0].quote_preview.endsWith("...")).toBe(true);
  });
});

describe("answer claims, citations, validation, and cascades", () => {
  it("updates answer claim support states and reports conflicts and weak evidence", () => {
    const { imported, spans } = fixture();
    const answer = answerFixture(spans[0].id);
    const supported = createAnswerClaim(db, { answerId: answer.id, claimText: "DB is truth", claimOrder: 0 });
    linkAnswerClaimToEvidence(db, { answerClaimId: supported.answer_claim_id, transcriptId: imported.transcriptId, spanId: spans[0].id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.9 });
    expect(db.prepare("SELECT support_status FROM answer_claims WHERE answer_claim_id=?").get(supported.answer_claim_id)).toEqual({ support_status: "supported" });
    linkAnswerClaimToEvidence(db, { answerClaimId: supported.answer_claim_id, transcriptId: imported.transcriptId, spanId: spans[1].id, evidenceRole: "opposition", evidenceStrength: "strong", confidence: 0.8 });
    expect(db.prepare("SELECT support_status FROM answer_claims WHERE answer_claim_id=?").get(supported.answer_claim_id)).toEqual({ support_status: "conflicted" });

    const weak = createAnswerClaim(db, { answerId: answer.id, claimText: "Weak claim", claimOrder: 1 });
    linkAnswerClaimToEvidence(db, { answerClaimId: weak.answer_claim_id, transcriptId: imported.transcriptId, spanId: spans[2].id, evidenceRole: "support", evidenceStrength: "weak", confidence: 0.4 });
    const validation = validateAnswerProvenance(db, answer.id);
    expect(validation).toMatchObject({ ok: true, conflictingClaims: [supported.answer_claim_id], weakClaims: [weak.answer_claim_id] });
    const opposition = getEvidenceForTarget(db, { targetType: "answer_claim", targetId: supported.answer_claim_id }).find((item) => item.evidence_role === "opposition")!;
    db.prepare("DELETE FROM evidence_pointers WHERE evidence_pointer_id=?").run(opposition.evidence_pointer_id);
    expect(db.prepare("SELECT support_status FROM answer_claims WHERE answer_claim_id=?").get(supported.answer_claim_id)).toEqual({ support_status: "supported" });
  });

  it("creates deterministic view-level citation labels without changing evidence IDs", () => {
    const { imported, spans } = fixture();
    const answer = answerFixture(spans[0].id);
    const claim = createAnswerClaim(db, { answerId: answer.id, claimText: "Claim", claimOrder: 0 });
    const first = linkAnswerClaimToEvidence(db, { answerClaimId: claim.answer_claim_id, transcriptId: imported.transcriptId, spanId: spans[0].id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.9, scores: { finalScore: 0.9 } });
    const second = linkAnswerClaimToEvidence(db, { answerClaimId: claim.answer_claim_id, transcriptId: imported.transcriptId, spanId: spans[1].id, evidenceRole: "opposition", evidenceStrength: "mixed", confidence: 0.7, scores: { finalScore: 0.7 } });
    const links = createCitationLinksForAnswer(db, { answerId: answer.id });
    expect(links.map((link) => link.citation_label)).toEqual(["[1]", "[2]"]);
    expect(formatCitationLabel(1)).toBe("[1]");
    expect(renderCitationMarkdown(db, first.evidence_pointer_id, "[1]")).toBe(`[1](mv://evidence/${first.evidence_pointer_id})`);
    expect(createCitationLinksForAnswer(db, { answerId: answer.id }).map((link) => link.evidence_pointer_id)).toEqual([first.evidence_pointer_id, second.evidence_pointer_id]);
  });

  it("reports broken evidence pointers attached directly to an answer", () => {
    const { imported, spans } = fixture();
    const answer = answerFixture(spans[0].id);
    const evidence = createEvidencePointer(db, { targetType: "answer", targetId: answer.id, transcriptId: imported.transcriptId, spanId: spans[0].id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.9 });
    db.prepare("UPDATE source_pointers SET span_text_sha256='corrupt' WHERE pointer_uri=?").run(evidence.source_pointer_uri);
    expect(validateAnswerProvenance(db, answer.id)).toMatchObject({ ok: false, brokenPointers: [evidence.evidence_pointer_id] });
  });

  it("reports unsupported claims and cascades pointers when a transcript is deleted", () => {
    const { imported, spans } = fixture();
    const answer = answerFixture(spans[0].id);
    const bundleId = answer.evidence_bundle_id;
    const claim = createAnswerClaim(db, { answerId: answer.id, claimText: "Unsupported", claimOrder: 0 });
    expect(validateAnswerProvenance(db, answer.id)).toMatchObject({ ok: false, claimsWithoutEvidence: [claim.answer_claim_id] });
    const memory = repos.memoryObjects.createMemoryObject({ type: "claim", generated_text: "Pointer target", status: "needs_review", confidence: 0.3, created_by: "agent", metadata: { reason: "missing_evidence" } }, []);
    linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: spans[1].id });
    repos.memoryObjects.updateMemoryObjectStatus(memory.id, "active");
    expect(db.prepare("SELECT COUNT(*) count FROM evidence_pointers").get()).toEqual({ count: 1 });
    db.prepare("DELETE FROM ai_answers WHERE id=?").run(answer.id);
    db.prepare("DELETE FROM evidence_bundles WHERE id=?").run(bundleId);
    db.prepare("DELETE FROM transcripts WHERE id=?").run(imported.transcriptId);
    expect(db.prepare("SELECT COUNT(*) count FROM source_pointers").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT COUNT(*) count FROM evidence_pointers").get()).toEqual({ count: 0 });
    expect(db.prepare("SELECT status FROM memory_objects WHERE id=?").get(memory.id)).toEqual({ status: "needs_review" });
  });

  it("does not depend on generated Markdown paths", () => {
    const { imported, spans } = fixture();
    const pointer = createSourcePointerForSpan(db, { transcriptId: imported.transcriptId, spanId: spans[0].id });
    expect(resolveSourcePointer(db, pointer.pointer_uri)).toMatchObject({ ok: true, spanText: spans[0].text });
  });

  it("resolves answer, claim, graph node, and graph edge clickback with evidence", () => {
    const { imported, spans } = fixture();
    const answer = answerFixture(spans[0].id);
    createEvidencePointer(db, { targetType: "answer", targetId: answer.id, transcriptId: imported.transcriptId, spanId: spans[0].id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.9 });
    const memory = repos.memoryObjects.createMemoryObject({ type: "claim", generated_text: "Claim", status: "needs_review", confidence: 0.4, created_by: "agent", metadata: { reason: "missing_evidence" } }, []);
    createEvidencePointer(db, { targetType: "claim", targetId: memory.id, transcriptId: imported.transcriptId, spanId: spans[1].id, evidenceRole: "support", evidenceStrength: "mixed", confidence: 0.7 });
    const nodeA = repos.graph.createGraphNode({ node_type: "topic", ref_id: "click-a", label: "A" });
    const nodeB = repos.graph.createGraphNode({ node_type: "topic", ref_id: "click-b", label: "B" });
    const edge = repos.graph.createGraphEdge({ from_node_id: nodeA.id, to_node_id: nodeB.id, edge_type: "related_to", source_type: "inferred", confidence: 0.4 });
    linkGraphNodeToSpan(db, { graphNodeId: nodeA.id, transcriptId: imported.transcriptId, spanId: spans[2].id });
    linkGraphEdgeToSpan(db, { graphEdgeId: edge.id, transcriptId: imported.transcriptId, spanId: spans[3].id, evidenceRole: "neutral", evidenceStrength: "unknown", confidence: 0.5 });
    expect(resolveClickback(db, `mv://answer/${answer.id}`)).toMatchObject({ ok: true, kind: "answer" });
    expect(resolveClickback(db, `mv://claim/${memory.id}`)).toMatchObject({ ok: true, kind: "claim" });
    expect(resolveClickback(db, `mv://graph/node/${nodeA.id}`)).toMatchObject({ ok: true, kind: "graph_node" });
    expect(resolveClickback(db, `mv://graph/edge/${edge.id}`)).toMatchObject({ ok: true, kind: "graph_edge" });
  });
});
