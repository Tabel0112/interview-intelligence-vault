import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistAskAIResponse, understandQuestion, type AskAIResponse } from "../src/ask-ai/index.js";
import { createConflictRepository } from "../src/conflicts/index.js";
import { createRepositories, createTranscriptsRepo, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { buildObsidianGraph, generateMemoryNotes, generateObsidianVault } from "../src/obsidian/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";

const fixedNow = () => new Date("2026-06-12T12:00:00.000Z");

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const spanOf = (transcriptId: string) => (db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? ORDER BY span_index LIMIT 1").get(transcriptId) as { id: string }).id;
const graphNodeIds = () => buildObsidianGraph(db).graph.nodes.map((n) => n.id);

// A transcript + canonical memory bridged to a live evidence pointer (so the memory is a connected node).
function seedMemory(file: string, raw: string, title: string, body: string) {
  const repos = createRepositories(db);
  const imported = importTranscript(db, { filename: file, rawText: raw });
  const spanId = spanOf(imported.transcriptId);
  const memory = repos.memoryObjects.createMemoryObject({ type: "decision", title, generated_text: body, confidence: 0.95, created_by: "agent" }, [{ span_id: spanId, role: "supports", evidence_score: 0.95 }]);
  const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId, evidenceStrength: "strong", confidence: 0.9 });
  return { transcriptId: imported.transcriptId, spanId, memoryId: memory.id, evidencePointerId: pointer.evidence_pointer_id };
}

// A transcript whose memory backs a persisted Ask AI answer (so the answer has live evidence pointers).
function seedAnswer() {
  const seed = seedMemory("ans.txt", "Alex: We decided to use SQLite as the source of truth.", "Use SQLite", "We decided to use SQLite as the source of truth.");
  const ptr = seed.evidencePointerId;
  const response: AskAIResponse = {
    id: "ask_pd_1", question: "What is the source of truth?", answerMarkdown: `SQLite. [1](mv://evidence/${ptr})`,
    evidenceConfidence: "strong", notEnoughEvidence: false, createdAt: "2026-06-12T00:00:00.000Z",
    queryUnderstanding: understandQuestion("What is the source of truth?"), conflicts: [], suggestedFollowups: [],
    synthesis: { mode: "external_llm", provider: "openai", model: "gpt-x", usedFallback: false },
    evidence: [{ evidencePointerId: ptr, sourcePointerId: undefined, transcriptId: seed.transcriptId, spanId: seed.spanId, quotePreview: "SQLite", evidenceScore: 0.9, evidenceConfidence: "strong", scoringExplanation: "span", clickbackUri: `mv://evidence/${ptr}`, stance: "supports", sourceKind: "memory_object_with_pointers" }],
    claims: [{ id: "aiclaim_pd", kind: "fact", text: "SQLite is the source of truth.", supportStatus: "supported", evidencePointerIds: [ptr], citationIds: ["aic_pd"] }],
    citations: [{ id: "aic_pd", label: "[1]", evidencePointerId: ptr, sourcePointerId: undefined, transcriptId: seed.transcriptId, spanId: seed.spanId, quotePreview: "SQLite", clickbackUri: `mv://evidence/${ptr}` }],
  };
  persistAskAIResponse(db, response);
  return { transcriptId: seed.transcriptId, answerId: response.id };
}

// One transcript with two opposing memories and an active conflict whose evidence links are live.
function seedConflict() {
  const repos = createRepositories(db);
  const imported = importTranscript(db, { filename: "c.txt", rawText: "Alex: Manual review should be used.\nAlex: Manual review should not be used." });
  const spans = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? ORDER BY span_index").all(imported.transcriptId) as Array<{ id: string }>;
  const left = repos.memoryObjects.createMemoryObject({ type: "preference", generated_text: "Manual review should be used.", confidence: 0.9, created_by: "agent" }, [{ span_id: spans[0].id, role: "supports", evidence_score: 0.9 }]);
  const right = repos.memoryObjects.createMemoryObject({ type: "preference", generated_text: "Manual review should not be used.", confidence: 0.9, created_by: "agent" }, [{ span_id: spans[1].id, role: "supports", evidence_score: 0.9 }]);
  const leftPtr = linkMemoryObjectToSpan(db, { memoryObjectId: left.id, transcriptId: imported.transcriptId, spanId: spans[0].id, evidenceStrength: "strong", confidence: 0.9 });
  const rightPtr = linkMemoryObjectToSpan(db, { memoryObjectId: right.id, transcriptId: imported.transcriptId, spanId: spans[1].id, evidenceStrength: "strong", confidence: 0.9 });
  const conflict = createConflictRepository(db, { now: fixedNow }).createConflictAssessment({ candidate: {
    leftTargetId: left.id, leftTargetType: "memory_object", leftText: left.generated_text, leftEvidenceIds: [leftPtr.evidence_pointer_id],
    rightTargetId: right.id, rightTargetType: "memory_object", rightText: right.generated_text, rightEvidenceIds: [rightPtr.evidence_pointer_id], sharedTopics: ["processing"],
  } });
  return { transcriptId: imported.transcriptId, conflictId: conflict.id, leftMemoryId: left.id, rightMemoryId: right.id };
}

describe("post-delete backend evidence cleanup", () => {
  it("1. leaves no source_pointers or evidence_pointers for the deleted transcript's spans", () => {
    const seed = seedMemory("a.txt", "Alex: We decided to use SQLite.", "Use SQLite", "We decided to use SQLite.");
    createTranscriptsRepo(db).deleteTranscript(seed.transcriptId);
    expect(db.prepare("SELECT COUNT(*) c FROM source_pointers WHERE transcript_id=?").get(seed.transcriptId)).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM evidence_pointers WHERE transcript_id=?").get(seed.transcriptId)).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM memory_object_evidence WHERE span_id=?").get(seed.spanId)).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM conflict_evidence_links").get()).toEqual({ c: 0 });
  });

  it("10. deleting a nonexistent transcript rolls back cleanly (no row changes)", () => {
    seedMemory("a.txt", "Alex: Keep me.", "Keep", "Keep me.");
    const before = db.prepare("SELECT COUNT(*) c FROM transcripts").get();
    expect(() => createTranscriptsRepo(db).deleteTranscript("tr_missing")).toThrow();
    expect(db.prepare("SELECT COUNT(*) c FROM transcripts").get()).toEqual(before);
  });
});

describe("post-delete generated graph cleanup", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "tmv-pd-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("2. produces no generated evidence notes for the deleted transcript after sync", async () => {
    const seed = seedMemory("a.txt", "Alex: We decided to use SQLite.", "Use SQLite", "We decided to use SQLite.");
    createTranscriptsRepo(db).deleteTranscript(seed.transcriptId);
    const result = await generateObsidianVault(db, { outputRoot: root, cleanBeforeWrite: true, now: fixedNow });
    expect(result.files.some((f) => f.logicalType === "evidence_note")).toBe(false);
    expect(result.files.some((f) => f.entityId === seed.evidencePointerId)).toBe(false);
  });

  it("3. deleting all transcripts leaves only system/graph notes after sync", async () => {
    const a = seedMemory("a.txt", "Alex: A decision.", "A", "A decision.");
    const b = seedMemory("b.txt", "Sam: B decision.", "B", "B decision.");
    await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    createTranscriptsRepo(db).deleteTranscript(a.transcriptId);
    createTranscriptsRepo(db).deleteTranscript(b.transcriptId);
    const result = await generateObsidianVault(db, { outputRoot: root, cleanBeforeWrite: true, now: fixedNow });
    const knowledge = result.files.filter((f) => ["transcript_note", "evidence_note", "memory_note", "answer_note", "conflict_note"].includes(f.logicalType));
    expect(knowledge).toHaveLength(0);
    expect(buildObsidianGraph(db).graph.nodes).toHaveLength(0);
  });

  it("4. a memory supported only by the deleted transcript is downgraded and is not a graph node/note", async () => {
    const seed = seedMemory("a.txt", "Alex: We decided to use SQLite.", "Use SQLite", "We decided to use SQLite.");
    expect(graphNodeIds()).toContain(`memory:${seed.memoryId}`); // present before delete
    createTranscriptsRepo(db).deleteTranscript(seed.transcriptId);
    // Memory row survives but downgraded.
    expect((db.prepare("SELECT status FROM memory_objects WHERE id=?").get(seed.memoryId) as { status: string }).status).toBe("needs_review");
    // ...and is NOT a normal graph node nor a generated note.
    expect(graphNodeIds()).not.toContain(`memory:${seed.memoryId}`);
    const result = await generateObsidianVault(db, { outputRoot: root, cleanBeforeWrite: true, now: fixedNow });
    expect(result.files.some((f) => f.logicalType === "memory_note" && f.entityId === seed.memoryId)).toBe(false);
  });

  it("5. a memory backed by a surviving transcript stays active and connected in the graph", () => {
    const repos = createRepositories(db);
    const doomed = importTranscript(db, { filename: "d.txt", rawText: "Alex: We decided to use SQLite." });
    const keep = importTranscript(db, { filename: "k.txt", rawText: "Sam: We decided to use SQLite too." });
    const doomedSpan = spanOf(doomed.transcriptId), keepSpan = spanOf(keep.transcriptId);
    const memory = repos.memoryObjects.createMemoryObject({ type: "decision", title: "Use SQLite", generated_text: "Use SQLite.", confidence: 0.95, created_by: "agent" },
      [{ span_id: doomedSpan, role: "supports", evidence_score: 0.95 }, { span_id: keepSpan, role: "supports", evidence_score: 0.95 }]);
    linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: keep.transcriptId, spanId: keepSpan, evidenceStrength: "strong", confidence: 0.9 });
    createTranscriptsRepo(db).deleteTranscript(doomed.transcriptId);
    expect((db.prepare("SELECT status FROM memory_objects WHERE id=?").get(memory.id) as { status: string }).status).toBe("active");
    const graph = buildObsidianGraph(db).graph;
    expect(graph.nodes.some((n) => n.id === `memory:${memory.id}`)).toBe(true);
    // 9. Local chain Transcript -> Evidence -> Memory still connected through the surviving span.
    const edge = (predicate: (e: { source: string; target: string; type: string }) => boolean) => graph.edges.some(predicate);
    expect(edge((e) => e.source === `memory:${memory.id}` && e.target.startsWith("evidence:") && e.type === "derived_from")).toBe(true);
    expect(edge((e) => e.source.startsWith("evidence:") && e.target === `span:${keepSpan}` && e.type === "derived_from")).toBe(true);
    expect(edge((e) => e.source === `span:${keepSpan}` && e.target === `transcript:${keep.transcriptId}` && e.type === "belongs_to")).toBe(true);
  });

  it("6. an answer whose evidence was deleted survives as history but is not a graph node/note", async () => {
    const { transcriptId, answerId } = seedAnswer();
    expect(graphNodeIds()).toContain(`answer:${answerId}`); // connected before delete
    createTranscriptsRepo(db).deleteTranscript(transcriptId);
    expect(db.prepare("SELECT 1 FROM ai_answers WHERE id=?").get(answerId)).toBeDefined(); // history survives
    expect(graphNodeIds()).not.toContain(`answer:${answerId}`); // no floating node / broken link
    const result = await generateObsidianVault(db, { outputRoot: root, cleanBeforeWrite: true, now: fixedNow });
    expect(result.files.some((f) => f.logicalType === "answer_note" && f.entityId === answerId)).toBe(false);
  });

  it("7. a conflict whose evidence was deleted downgrades/survives but is not a graph node/note", async () => {
    const { transcriptId, conflictId } = seedConflict();
    expect(graphNodeIds()).toContain(`conflict:${conflictId}`); // connected before delete
    createTranscriptsRepo(db).deleteTranscript(transcriptId);
    expect(db.prepare("SELECT 1 FROM conflict_assessments WHERE id=?").get(conflictId)).toBeDefined(); // survives
    expect(graphNodeIds()).not.toContain(`conflict:${conflictId}`); // no floating node / broken link
    const result = await generateObsidianVault(db, { outputRoot: root, cleanBeforeWrite: true, now: fixedNow });
    expect(result.files.some((f) => f.logicalType === "conflict_note" && f.entityId === conflictId)).toBe(false);
  });

  it("a memory with memory_object_evidence but no evidence pointer is not a graph node/note, but stays in Review/detail", async () => {
    const repos = createRepositories(db);
    const imported = importTranscript(db, { filename: "u.txt", rawText: "Alex: We discussed maybe using SQLite." });
    const span = spanOf(imported.transcriptId);
    // Legacy-only memory: has memory_object_evidence, never bridged to an evidence_pointer.
    const memory = repos.memoryObjects.createMemoryObject({ type: "decision", title: "Maybe SQLite", generated_text: "Maybe use SQLite.", status: "needs_review", confidence: 0.5, created_by: "agent" }, [{ span_id: span, role: "supports", evidence_score: 0.5 }]);
    expect(db.prepare("SELECT COUNT(*) c FROM memory_object_evidence WHERE memory_id=?").get(memory.id)).toEqual({ c: 1 });
    expect(db.prepare("SELECT COUNT(*) c FROM evidence_pointers WHERE target_id=?").get(memory.id)).toEqual({ c: 0 });

    // Not a normal graph node, not a generated note (no graph-linkable edge -> would be a disconnected island).
    expect(graphNodeIds()).not.toContain(`memory:${memory.id}`);
    expect(generateMemoryNotes(db).some((f) => f.entityId === memory.id)).toBe(false);
    // ...but it is NOT deleted: it surfaces in Review and in the memory detail view.
    const api = createSqliteFrontendApi(db);
    expect((await api.listReviewItems()).some((item) => item.targetId === memory.id)).toBe(true);
    expect(await api.getMemory(memory.id)).not.toBeNull();
  });

  it("after delete + sync there are no disconnected memory/answer/conflict islands", async () => {
    // A surviving transcript with a bridged memory + persisted answer, plus a second transcript that gets deleted.
    seedAnswer();
    const doomed = seedMemory("doom.txt", "Sam: We decided to drop Redis.", "Drop Redis", "We decided to drop Redis.");
    createTranscriptsRepo(db).deleteTranscript(doomed.transcriptId);
    const graph = buildObsidianGraph(db).graph;
    const incident = new Set(graph.edges.flatMap((e) => [e.source, e.target]));
    const islandTypes = new Set(["memory", "decision", "answer", "claim", "conflict"]);
    const islands = graph.nodes.filter((n) => islandTypes.has(n.type) && !incident.has(n.id));
    expect(islands).toEqual([]); // every memory/answer/conflict node is connected by at least one edge
  });

  it("8. manifest cleanup removes the deleted transcript's stale files and preserves user files", async () => {
    const seed = seedMemory("a.txt", "Alex: We decided to use SQLite.", "Use SQLite", "We decided to use SQLite.");
    const first = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    const transcriptNote = first.files.find((f) => f.entityId === seed.transcriptId && f.logicalType === "transcript_note")!;
    expect(existsSync(join(root, transcriptNote.relativePath))).toBe(true);
    await writeFile(join(root, "My User Note.md"), "keep", "utf8");
    createTranscriptsRepo(db).deleteTranscript(seed.transcriptId);
    await generateObsidianVault(db, { outputRoot: root, cleanBeforeWrite: true, now: fixedNow });
    expect(existsSync(join(root, transcriptNote.relativePath))).toBe(false); // stale generated file pruned
    expect(await readFile(join(root, "My User Note.md"), "utf8")).toBe("keep"); // user file preserved
  });
});
