import { mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askAI, createDatabaseAskAIDependencies } from "../src/ask-ai/index.js";
import { createConflictRepository, type ConflictCandidate } from "../src/conflicts/index.js";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import {
  buildDecisionGraph, buildObsidianGraph, buildPeopleGraph, buildSourceEvidenceGraph, buildTopicGraph,
  createEvidenceClickbackUri, createSourceClickbackUri, generateObsidianVault, resolveObsidianClickbackTarget,
  safeName, type ObsidianGraph,
} from "../src/obsidian/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";

const fixedNow = () => new Date("2026-06-12T12:00:00.000Z");
const file = (root: string, path: string) => readFile(join(root, path), "utf8");

describe("Obsidian-style generated views", () => {
  let db: SqliteDatabase;
  let root: string;
  beforeEach(async () => { db = openDatabase(":memory:"); root = await mkdtemp(join(tmpdir(), "obsidian-views-")); });
  afterEach(async () => { db.close(); await rm(root, { recursive: true, force: true }); });

  async function fixture() {
    const imported = importTranscript(db, { filename: "Meeting: A?.txt", rawText: "Alex: Use SQLite as the source of truth.\nAlex: Do not use SQLite as the source of truth." });
    const spans = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? ORDER BY ordinal").all(imported.transcriptId) as Array<{ id: string }>;
    const repos = createRepositories(db);
    const left = repos.memoryObjects.createMemoryObject({ type: "decision", title: "SQLite truth", generated_text: "Use SQLite as the source of truth.", confidence: 0.95, created_by: "agent" }, [{ span_id: spans[0].id, role: "supports", evidence_score: 0.95 }]);
    const right = repos.memoryObjects.createMemoryObject({ type: "preference", title: "Avoid SQLite", generated_text: "Do not use SQLite as the source of truth.", confidence: 0.9, created_by: "agent" }, [{ span_id: spans[1].id, role: "supports", evidence_score: 0.9 }]);
    const weak = repos.memoryObjects.createMemoryObject({ type: "preference", title: "Tentative preference", generated_text: "Maybe prefer a different database.", confidence: 0.5, created_by: "agent" }, [{ span_id: spans[1].id, role: "qualifies", evidence_score: 0.3 }]);
    const leftPointer = linkMemoryObjectToSpan(db, { memoryObjectId: left.id, transcriptId: imported.transcriptId, spanId: spans[0].id, evidenceStrength: "strong", confidence: 0.95 });
    const rightPointer = linkMemoryObjectToSpan(db, { memoryObjectId: right.id, transcriptId: imported.transcriptId, spanId: spans[1].id, evidenceStrength: "strong", confidence: 0.9 });
    const weakPointer = linkMemoryObjectToSpan(db, { memoryObjectId: weak.id, transcriptId: imported.transcriptId, spanId: spans[1].id, evidenceStrength: "weak", confidence: 0.3 });
    const candidate: ConflictCandidate = {
      leftTargetId: left.id, leftTargetType: "memory_object", leftText: left.generated_text, leftEvidenceIds: [leftPointer.evidence_pointer_id],
      rightTargetId: right.id, rightTargetType: "memory_object", rightText: right.generated_text, rightEvidenceIds: [rightPointer.evidence_pointer_id],
      sharedTopics: ["SQLite"],
    };
    const conflict = createConflictRepository(db, { now: fixedNow }).createConflictAssessment({ candidate });
    repos.graph.createGraphNode({ node_type: "entity", ref_id: "alex", label: "Alex" });
    repos.graph.createGraphNode({ node_type: "topic", ref_id: "sqlite", label: "SQLite" });
    await indexEvidencePointerForSearch(db, leftPointer.evidence_pointer_id);
    await indexEvidencePointerForSearch(db, rightPointer.evidence_pointer_id);
    const answer = await askAI({ question: "SQLite source of truth" }, createDatabaseAskAIDependencies(db, { now: fixedNow }));
    return { imported, spans, left, right, weak, leftPointer, rightPointer, weakPointer, conflict, answer };
  }

  it("generates source-marked notes, citations, backlinks, safe folders, answers, and both conflict sides", async () => {
    const data = await fixture();
    const result = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    expect(result.errors).toEqual([]);
    expect(await file(root, "00 Home.md")).toContain("database is the source of truth");
    const transcript = result.files.find((item) => item.entityType === "transcript")!;
    const transcriptText = await file(root, transcript.relativePath);
    expect(transcript.relativePath).not.toContain(":");
    expect(transcriptText).toContain(`<span id="${data.spans[0].id}"></span>`);
    expect(transcriptText).toContain("Immutable raw source text");
    const memory = result.files.find((item) => item.entityId === data.left.id && item.logicalType === "memory_note")!;
    expect(await file(root, memory.relativePath)).toContain(`mv://evidence/${data.leftPointer.evidence_pointer_id}`);
    const weak = result.files.find((item) => item.entityId === data.weak.id && item.logicalType === "memory_note")!;
    expect(await file(root, weak.relativePath)).toContain("Weak or review-only evidence");
    const evidence = result.files.find((item) => item.entityId === data.leftPointer.evidence_pointer_id)!;
    expect(await file(root, evidence.relativePath)).toContain(`#${data.spans[0].id}`);
    const answer = result.files.find((item) => item.entityId === data.answer.id)!;
    expect(await file(root, answer.relativePath)).toContain("Claim-Level Citations");
    const conflict = result.files.find((item) => item.entityId === data.conflict.id)!;
    expect(await file(root, conflict.relativePath)).toMatch(/Left Side[\s\S]*Right Side/);
    expect(safeName("a:b?c")).toBe("a b c");
  });

  it("builds complete and filtered stable graphs with traceable provenance chains", async () => {
    const data = await fixture();
    const first = buildObsidianGraph(db), second = buildObsidianGraph(db);
    expect(second).toEqual(first);
    expect(first.graph.nodes.map((node) => node.type)).toEqual(expect.arrayContaining(["transcript", "span", "evidence", "memory", "decision", "answer", "claim", "conflict", "person", "topic"]));
    expect(first.graph.edges.filter((edge) => edge.type === "derived_from" || edge.type === "cites").every((edge) => edge.evidencePointerId || !edge.source.startsWith("memory:"))).toBe(true);
    const source = buildSourceEvidenceGraph(first.graph);
    expect(source.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: `transcript:${data.imported.transcriptId}`, target: `span:${data.spans[0].id}` }),
      expect.objectContaining({ source: `span:${data.spans[0].id}`, target: `evidence:${data.leftPointer.evidence_pointer_id}` }),
      expect.objectContaining({ source: `evidence:${data.leftPointer.evidence_pointer_id}`, target: `memory:${data.left.id}` }),
    ]));
    expect(buildTopicGraph(first.graph).nodes.some((node) => node.type === "topic")).toBe(true);
    expect(buildPeopleGraph(first.graph).nodes.some((node) => node.type === "person")).toBe(true);
    expect(buildDecisionGraph(first.graph).nodes.some((node) => node.type === "decision")).toBe(true);
    const result = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    const graph = JSON.parse(await file(root, "Graphs/graph-data.json")) as { generatedFrom: string; nodes: ObsidianGraph["nodes"] };
    expect(graph.generatedFrom).toBe("sqlite");
    expect(graph.nodes.map((node) => node.id)).toEqual(first.graph.nodes.map((node) => node.id));
    expect(result.graphNodeCount).toBe(first.graph.nodes.length);
  });

  it("resolves exact clickbacks and renders broken-pointer warnings", async () => {
    const data = await fixture();
    const unlinked = importTranscript(db, { filename: "unlinked.txt", rawText: "Alex: This span has no source pointer." });
    expect(resolveObsidianClickbackTarget(db, createSourceClickbackUri({ transcriptId: data.imported.transcriptId, spanId: data.spans[0].id }))).toMatchObject({ transcriptId: data.imported.transcriptId, spanId: data.spans[0].id, anchorId: data.spans[0].id });
    expect(resolveObsidianClickbackTarget(db, createEvidenceClickbackUri(data.leftPointer.evidence_pointer_id))).toMatchObject({ spanId: data.spans[0].id });
    db.prepare("UPDATE source_pointers SET span_text_sha256='broken' WHERE pointer_uri=?").run(data.leftPointer.source_pointer_uri);
    expect(resolveObsidianClickbackTarget(db, data.leftPointer.source_pointer_uri)).toEqual({ error: "hash_mismatch" });
    const result = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining(`Broken evidence pointer ${data.leftPointer.evidence_pointer_id}`)]));
    const evidenceNote = result.files.find((item) => item.entityId === data.leftPointer.evidence_pointer_id && item.logicalType === "evidence_note")!;
    expect(await file(root, evidenceNote.relativePath)).toContain("Broken evidence pointer");
    const unlinkedNote = result.files.find((item) => item.entityId === unlinked.transcriptId && item.logicalType === "transcript_note")!;
    expect(await file(root, unlinkedNote.relativePath)).toContain("No validated source pointer for this span");
  });

  it("is deterministic, ignores Markdown edits, and safely restores deleted generated views", async () => {
    const data = await fixture();
    const rawBefore = (db.prepare("SELECT raw_text FROM transcripts WHERE id=?").get(data.imported.transcriptId) as { raw_text: string }).raw_text;
    const first = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    const memory = first.files.find((item) => item.entityId === data.left.id && item.logicalType === "memory_note")!;
    await writeFile(join(root, memory.relativePath), "User edit that must not become truth.", "utf8");
    const second = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.files.map((item) => [item.relativePath, item.contentHash])).toEqual(first.files.map((item) => [item.relativePath, item.contentHash]));
    expect(await file(root, memory.relativePath)).not.toContain("User edit");
    await unlink(join(root, memory.relativePath));
    await writeFile(join(root, "My User Note.md"), "Must be preserved.", "utf8");
    await generateObsidianVault(db, { outputRoot: root, cleanBeforeWrite: true, now: fixedNow });
    expect(await file(root, memory.relativePath)).toContain(data.left.generated_text);
    expect(await file(root, "My User Note.md")).toBe("Must be preserved.");
    expect((db.prepare("SELECT raw_text FROM transcripts WHERE id=?").get(data.imported.transcriptId) as { raw_text: string }).raw_text).toBe(rawBefore);
    expect(db.prepare("SELECT COUNT(*) count FROM obsidian_view_runs").get()).toEqual({ count: 3 });
  });

  it("generates a stable empty vault without treating views as truth", async () => {
    const first = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    const second = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    expect(first.contentHash).toBe(second.contentHash);
    expect(await file(root, "00 Home.md")).toContain("Transcripts: 0");
    expect(JSON.parse(await file(root, "Graphs/graph-data.json"))).toMatchObject({ nodes: [], edges: [] });
    for (const directory of ["Transcripts", "Memories/Facts", "People", "Topics", "Decisions", "Evidence", "Answers", "Conflicts", "Graphs", "_system"]) {
      expect((await stat(join(root, directory))).isDirectory()).toBe(true);
    }
    expect(db.prepare("SELECT COUNT(*) count FROM memory_objects").get()).toEqual({ count: 0 });
  });
});
