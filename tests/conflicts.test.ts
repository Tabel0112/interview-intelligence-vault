import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  augmentAskAIResponseWithConflicts, classifyConflictCandidate, createConflictGraphEdge, createConflictRepository,
  generateConflictCandidates, renderConflictMarkdown, type ConflictCandidate,
} from "../src/conflicts/index.js";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { askAI, createDatabaseAskAIDependencies, understandQuestion, type AskAIResponse } from "../src/ask-ai/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";

const fixedNow = () => new Date("2026-06-12T12:00:00.000Z");
const baseCandidate = (overrides: Partial<ConflictCandidate> = {}): ConflictCandidate => ({
  leftTargetId: "left", leftTargetType: "memory_object", leftText: "Manual review should be used for processing.",
  leftEvidenceIds: ["left-evidence"], rightTargetId: "right", rightTargetType: "memory_object",
  rightText: "Manual review should not be used for processing.", rightEvidenceIds: ["right-evidence"],
  sharedTopics: ["processing"], ...overrides,
});

describe("deterministic conflict detection", () => {
  it("classifies direct, tension, temporal, conditional, and weak conflicts transparently", () => {
    expect(classifyConflictCandidate(baseCandidate())).toMatchObject({ kind: "direct_contradiction", confidence: expect.any(Number) });
    expect(classifyConflictCandidate(baseCandidate({
      leftText: "Processing should be fully automatic for speed.",
      rightText: "Processing should keep manual review for accuracy.",
    }))).toMatchObject({ kind: "tension" });
    expect(classifyConflictCandidate(baseCandidate({
      leftTimestamp: "2025-01-01T00:00:00.000Z", rightTimestamp: "2026-01-01T00:00:00.000Z",
    }), { preferTemporalUpdate: true })).toMatchObject({ kind: "temporal_update", newerTargetId: "right", olderTargetId: "left" });
    expect(classifyConflictCandidate(baseCandidate({
      leftText: "Use automatic processing for high-confidence facts.",
      rightText: "Use manual review for uncertain facts.",
    }))).toMatchObject({ kind: "conditional_difference" });
    const weak = classifyConflictCandidate(baseCandidate(), { validatedEvidenceIds: [] });
    expect(weak.kind).toBe("weak_or_ambiguous");
    expect(weak.confidence).toBeLessThan(0.4);
  });

  it("generates candidates only for statements with deterministic shared context", () => {
    const candidates = generateConflictCandidates([
      { targetId: "a", targetType: "memory_object", text: "Use automatic processing", evidenceIds: ["a"], topics: ["processing"] },
      { targetId: "b", targetType: "memory_object", text: "Use manual processing", evidenceIds: ["b"], topics: ["processing"] },
      { targetId: "c", targetType: "memory_object", text: "The office is blue", evidenceIds: ["c"], topics: ["office"] },
    ]);
    expect(candidates).toHaveLength(1);
  });
});

describe("conflict persistence and integration", () => {
  let db: SqliteDatabase;
  let repos: ReturnType<typeof createRepositories>;
  beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); });
  afterEach(() => db.close());

  function fixture(preferTemporalUpdate = false) {
    const imported = importTranscript(db, {
      filename: "conflicts.txt",
      rawText: "Alex: Manual review should be used for processing.\nAlex: Manual review should not be used for processing.",
    });
    const spans = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? ORDER BY span_index").all(imported.transcriptId) as Array<{ id: string }>;
    const left = repos.memoryObjects.createMemoryObject(
      { type: "preference", generated_text: "Manual review should be used for processing.", confidence: 0.9, created_by: "agent" },
      [{ span_id: spans[0].id, role: "supports", evidence_score: 0.9 }],
    );
    const right = repos.memoryObjects.createMemoryObject(
      { type: "preference", generated_text: "Manual review should not be used for processing.", confidence: 0.9, created_by: "agent" },
      [{ span_id: spans[1].id, role: "supports", evidence_score: 0.9 }],
    );
    const leftPointer = linkMemoryObjectToSpan(db, { memoryObjectId: left.id, transcriptId: imported.transcriptId, spanId: spans[0].id, evidenceStrength: "strong", confidence: 0.9 });
    const rightPointer = linkMemoryObjectToSpan(db, { memoryObjectId: right.id, transcriptId: imported.transcriptId, spanId: spans[1].id, evidenceStrength: "strong", confidence: 0.9 });
    const candidate: ConflictCandidate = {
      leftTargetId: left.id, leftTargetType: "memory_object", leftText: left.generated_text, leftEvidenceIds: [leftPointer.evidence_pointer_id],
      leftTimestamp: "2025-01-01T00:00:00.000Z", rightTargetId: right.id, rightTargetType: "memory_object", rightText: right.generated_text,
      rightEvidenceIds: [rightPointer.evidence_pointer_id], rightTimestamp: "2026-01-01T00:00:00.000Z", sharedTopics: ["processing"], preferTemporalUpdate,
    };
    return { candidate, left, right, leftPointer, rightPointer };
  }

  it("creates an idempotent active assessment, graph edge, and pure Markdown view", () => {
    const { candidate, leftPointer } = fixture();
    const conflicts = createConflictRepository(db, { now: fixedNow });
    const conflict = conflicts.createConflictAssessment({ candidate });
    expect(conflict).toMatchObject({ kind: "direct_contradiction", status: "active", createdAt: fixedNow().toISOString() });
    expect(conflicts.createConflictAssessment({ candidate }).id).toBe(conflict.id);
    expect(conflicts.createConflictAssessment({ candidate: {
      ...candidate,
      leftTargetId: candidate.rightTargetId, leftTargetType: candidate.rightTargetType, leftText: candidate.rightText, leftEvidenceIds: candidate.rightEvidenceIds,
      rightTargetId: candidate.leftTargetId, rightTargetType: candidate.leftTargetType, rightText: candidate.leftText, rightEvidenceIds: candidate.leftEvidenceIds,
    } }).id).toBe(conflict.id);
    expect(conflicts.listConflictsForTarget("memory_object", candidate.leftTargetId)).toHaveLength(1);
    expect(conflicts.listConflictsForEvidence(leftPointer.evidence_pointer_id)).toHaveLength(1);
    const edge = createConflictGraphEdge(db, conflict);
    expect(edge).toMatchObject({ edge_type: "contradicts", source_type: "source_backed" });
    expect(renderConflictMarkdown(conflict)).toContain("## Conflict / Tension");
    db.prepare("DELETE FROM evidence_pointers WHERE evidence_pointer_id=?").run(leftPointer.evidence_pointer_id);
    expect(repos.graph.getGraphEdge(edge.id)?.status).toBe("needs_review");
  });

  it.each([
    ["direct_contradiction", "contradicts", "contradicts"],
    ["tension", "tensions_with", "related_to"],
    ["temporal_update", "updates", "updates"],
    ["conditional_difference", "conditionally_differs_from", "qualifies"],
  ] as const)("maps %s to a source-backed logical graph edge", (kind, logicalType, physicalType) => {
    const { candidate } = fixture(kind === "temporal_update");
    const base = classifyConflictCandidate(candidate);
    const conflict = createConflictRepository(db, { now: fixedNow }).createConflictAssessment({
      candidate,
      classification: {
        ...base, kind, confidence: 0.8,
        newerTargetId: kind === "temporal_update" ? candidate.rightTargetId : null,
        olderTargetId: kind === "temporal_update" ? candidate.leftTargetId : null,
      },
    });
    const edge = createConflictGraphEdge(db, conflict, { now: fixedNow });
    expect(edge.edge_type).toBe(physicalType);
    expect(db.prepare("SELECT logical_edge_type FROM conflict_graph_edges WHERE conflict_assessment_id=?").get(conflict.id))
      .toEqual({ logical_edge_type: logicalType });
  });

  it("downgrades deleted evidence and never promotes unsupported assessments", () => {
    const { candidate, leftPointer } = fixture();
    const conflicts = createConflictRepository(db, { now: fixedNow });
    const conflict = conflicts.createConflictAssessment({ candidate });
    db.prepare("DELETE FROM evidence_pointers WHERE evidence_pointer_id=?").run(leftPointer.evidence_pointer_id);
    expect(conflicts.getConflictAssessment(conflict.id)?.status).toBe("needs_review");
    expect(() => conflicts.updateConflictStatus(conflict.id, "active")).toThrow();
  });

  it("records append-only corrections and supersedes older generated memory without touching raw text", () => {
    const { candidate, left, right } = fixture(true);
    const conflicts = createConflictRepository(db, { now: fixedNow });
    const conflict = conflicts.createConflictAssessment({ candidate });
    expect(conflict.kind).toBe("temporal_update");
    const resolved = conflicts.applyCorrection(conflict.id, { action: "mark_newer_supersedes_older", note: "Newer preference confirmed." });
    expect(resolved).toMatchObject({ status: "resolved", winningTargetId: right.id });
    expect(repos.memoryObjects.getMemoryObject(left.id)?.status).toBe("superseded");
    const correction = db.prepare("SELECT id FROM conflict_corrections WHERE conflict_assessment_id=?").get(conflict.id) as { id: string };
    expect(() => db.prepare("DELETE FROM conflict_corrections WHERE id=?").run(correction.id)).toThrow();
  });

  it("adds both sides to Ask AI context and downgrades confidence", () => {
    const { candidate } = fixture();
    const conflict = createConflictRepository(db, { now: fixedNow }).createConflictAssessment({ candidate });
    const response: AskAIResponse = {
      id: "ask", question: "Should review be used?", answerMarkdown: "Base answer.", evidenceConfidence: "strong",
      claims: [], citations: [], evidence: [], suggestedFollowups: [], notEnoughEvidence: false, createdAt: fixedNow().toISOString(),
      queryUnderstanding: understandQuestion("Should review be used?"), conflicts: [],
    };
    const augmented = augmentAskAIResponseWithConflicts(response, [conflict]);
    expect(augmented.evidenceConfidence).toBe("conflicting");
    expect(augmented.answerMarkdown).toContain(candidate.leftEvidenceIds[0]);
    expect(augmented.answerMarkdown).toContain(candidate.rightEvidenceIds[0]);
  });

  it("persists both conflict sides in the Ask AI evidence bundle and claims", async () => {
    const { candidate, leftPointer, rightPointer } = fixture();
    const conflict = createConflictRepository(db, { now: fixedNow }).createConflictAssessment({ candidate });
    await indexEvidencePointerForSearch(db, leftPointer.evidence_pointer_id);
    await indexEvidencePointerForSearch(db, rightPointer.evidence_pointer_id);
    const response = await askAI({ question: "manual review processing" }, createDatabaseAskAIDependencies(db, { now: fixedNow }));
    expect(response).toMatchObject({ evidenceConfidence: "conflicting", conflicts: [{ id: conflict.id }] });
    expect(response.evidence.map((item) => item.evidencePointerId)).toEqual(expect.arrayContaining(candidate.leftEvidenceIds.concat(candidate.rightEvidenceIds)));
    expect(response.claims).toHaveLength(2);
    expect(db.prepare("SELECT COUNT(*) count FROM ask_ai_run_conflicts WHERE ask_ai_run_id=?").get(response.id)).toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) count FROM ask_ai_run_evidence WHERE ask_ai_run_id=?").get(response.id)).toEqual({ count: 2 });
  });

  it("revalidates broken provenance and caps a weak newer side below active confidence", () => {
    const { candidate, leftPointer, rightPointer } = fixture(true);
    db.prepare("UPDATE evidence_pointers SET evidence_strength='weak',confidence=0.2,final_score=0.2 WHERE evidence_pointer_id=?").run(rightPointer.evidence_pointer_id);
    const conflicts = createConflictRepository(db, { now: fixedNow });
    const weakUpdate = conflicts.createConflictAssessment({ candidate });
    expect(weakUpdate).toMatchObject({ kind: "temporal_update", status: "needs_review" });
    expect(weakUpdate.confidence).toBeLessThan(0.6);

    db.prepare("DELETE FROM conflict_assessments WHERE id=?").run(weakUpdate.id);
    db.prepare("UPDATE evidence_pointers SET evidence_strength='strong',confidence=0.9,final_score=NULL WHERE evidence_pointer_id=?").run(rightPointer.evidence_pointer_id);
    const active = conflicts.createConflictAssessment({ candidate: { ...candidate, preferTemporalUpdate: false } });
    db.prepare("UPDATE source_pointers SET span_text_sha256='broken' WHERE pointer_uri=?").run(leftPointer.source_pointer_uri);
    expect(conflicts.listActiveConflicts()).toHaveLength(0);
    expect(conflicts.getConflictAssessment(active.id)?.status).toBe("needs_review");
  });

  it("does not promote review-only canonical memory through conflict scoring", () => {
    const { candidate, right } = fixture();
    repos.memoryObjects.updateMemoryObjectStatus(right.id, "needs_review");
    const conflict = createConflictRepository(db, { now: fixedNow }).createConflictAssessment({ candidate });
    expect(conflict.status).toBe("needs_review");
    expect(conflict.confidence).toBeLessThan(0.6);
  });

  it.each([
    ["mark_left_correct", "resolved", "direct_contradiction"],
    ["mark_right_correct", "resolved", "direct_contradiction"],
    ["mark_both_contextual", "active", "conditional_difference"],
    ["keep_both_as_tension", "active", "tension"],
    ["dismiss_not_conflict", "dismissed", "direct_contradiction"],
  ] as const)("records correction action %s", (action, status, kind) => {
    const { candidate } = fixture();
    const conflicts = createConflictRepository(db, { now: fixedNow });
    const conflict = conflicts.createConflictAssessment({ candidate });
    expect(conflicts.applyCorrection(conflict.id, { action, note: "User reviewed." })).toMatchObject({ status, kind });
    expect(db.prepare("SELECT COUNT(*) count FROM conflict_corrections WHERE conflict_assessment_id=?").get(conflict.id)).toEqual({ count: 1 });
  });
});
