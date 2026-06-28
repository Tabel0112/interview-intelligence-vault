import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askAI, createDatabaseAskAIDependencies } from "../src/ask-ai/index.js";
import { createConflictRepository, type ConflictCandidate } from "../src/conflicts/index.js";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { generateObsidianVault, questionLabel, type GeneratedFile } from "../src/obsidian/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";

const fixedNow = () => new Date("2026-06-28T12:00:00.000Z");
let db: SqliteDatabase;
let root: string;
beforeEach(async () => { db = openDatabase(":memory:"); root = await mkdtemp(join(tmpdir(), "tmv-graph-")); });
afterEach(async () => { db.close(); await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const repos = createRepositories(db);
  const imported = importTranscript(db, { filename: "Meeting.txt", rawText: "Alex: We decided to use SQLite as the source of truth.\nSam: Avoid SQLite entirely." });
  const spans = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? ORDER BY ordinal").all(imported.transcriptId) as Array<{ id: string }>;
  const decision = repos.memoryObjects.createMemoryObject({ type: "decision", title: "SQLite source of truth", generated_text: "We decided to use SQLite as the source of truth.", confidence: 0.95, created_by: "agent" }, [{ span_id: spans[0].id, role: "supports", evidence_score: 0.95 }]);
  const dPtr = linkMemoryObjectToSpan(db, { memoryObjectId: decision.id, transcriptId: imported.transcriptId, spanId: spans[0].id, evidenceStrength: "strong", confidence: 0.95 });
  const opp = repos.memoryObjects.createMemoryObject({ type: "decision", title: "Avoid SQLite", generated_text: "Avoid SQLite entirely.", confidence: 0.9, created_by: "agent" }, [{ span_id: spans[1].id, role: "supports", evidence_score: 0.9 }]);
  const oppPtr = linkMemoryObjectToSpan(db, { memoryObjectId: opp.id, transcriptId: imported.transcriptId, spanId: spans[1].id, evidenceStrength: "strong", confidence: 0.9 });
  repos.graph.createGraphNode({ node_type: "entity", ref_id: "alex", label: "Alex" });
  repos.graph.createGraphNode({ node_type: "topic", ref_id: "sqlite", label: "SQLite" });
  await indexEvidencePointerForSearch(db, dPtr.evidence_pointer_id);
  await indexEvidencePointerForSearch(db, oppPtr.evidence_pointer_id);
  const answer = await askAI({ question: "What is the source of truth?" }, createDatabaseAskAIDependencies(db, { now: fixedNow }));
  const candidate: ConflictCandidate = {
    leftTargetId: decision.id, leftTargetType: "memory_object", leftText: "use", leftEvidenceIds: [dPtr.evidence_pointer_id],
    rightTargetId: opp.id, rightTargetType: "memory_object", rightText: "avoid", rightEvidenceIds: [oppPtr.evidence_pointer_id], sharedTopics: ["SQLite"],
  };
  const conflict = createConflictRepository(db, { now: fixedNow }).createConflictAssessment({ candidate });
  const result = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
  return { imported, spans, decision, dPtr, opp, answer, conflict, result };
}

const read = (path: string) => readFile(join(root, path), "utf8");
const find = (files: GeneratedFile[], entityId: string, logicalType: string) => files.find((f) => f.entityId === entityId && f.logicalType === logicalType)!;
const byPath = (files: GeneratedFile[], path: string) => files.find((f) => f.relativePath === path)!;

describe("Graph presentation — system notes are de-hubbed", () => {
  it("00 Home, generation-log, graph-guide, and graph index notes carry no wikilinks and are tagged #tmv/system", async () => {
    const { result } = await fixture();
    const systemPaths = ["00 Home.md", "_system/generation-log.md", "_system/graph-guide.md",
      ...result.files.filter((f) => f.logicalType === "graph_markdown").map((f) => f.relativePath)];
    expect(systemPaths.length).toBeGreaterThan(3); // includes the 4 graph index notes
    for (const path of systemPaths) {
      const content = await read(path);
      expect(content, `${path} should be tagged system`).toContain("#tmv/system");
      expect(content, `${path} must not create graph hubs`).not.toContain("[[");
    }
  });

  it("the graph guide explains source-of-truth and recommends tag filters, with no links", async () => {
    await fixture();
    const guide = await read("_system/graph-guide.md");
    expect(guide).toContain("SQLite is the source of truth");
    expect(guide).toContain("tag:#tmv/memory");
    expect(guide).toContain("-tag:#tmv/system");
    expect(guide).not.toContain("[[");
  });
});

describe("Graph presentation — meaningful provenance links preserved", () => {
  it("connects transcript <-> evidence <-> memory and answer/conflict via wikilinks", async () => {
    const { result, imported, decision, dPtr, answer } = await fixture();
    const transcript = await read(find(result.files, imported.transcriptId, "transcript_note").relativePath);
    expect(transcript).toContain("[[Evidence/"); // transcript -> its evidence

    const evidence = await read(find(result.files, dPtr.evidence_pointer_id, "evidence_note").relativePath);
    expect(evidence).toContain("[[Transcripts/");        // evidence -> source transcript span
    expect(evidence).toContain("[[Memories/Decisions/"); // evidence -> its target (canonical decision memory note)

    const memory = await read(find(result.files, decision.id, "memory_note").relativePath);
    expect(memory).toContain("[[Evidence/"); // memory -> supporting evidence

    const answerNote = await read(find(result.files, answer.id, "answer_note").relativePath);
    expect(answerNote).toContain("[[Evidence/"); // answer -> evidence via claim citations

    const conflict = await read(find(result.files, String(result.files.find((f) => f.logicalType === "conflict_note")!.entityId), "conflict_note").relativePath);
    expect(conflict).toMatch(/Left Side[\s\S]*Right Side/);
    expect(conflict).toContain("[[Memories/"); // conflict -> both memory sides
  });
});

describe("Graph presentation — tags for graph filtering", () => {
  it("every entity note carries its #tmv/* tag", async () => {
    const { result, imported, decision, dPtr, answer } = await fixture();
    const tagOf = (file: GeneratedFile) => read(file.relativePath);
    expect(await tagOf(find(result.files, imported.transcriptId, "transcript_note"))).toContain("#tmv/transcript");
    expect(await tagOf(find(result.files, dPtr.evidence_pointer_id, "evidence_note"))).toContain("#tmv/evidence");
    expect(await tagOf(find(result.files, decision.id, "memory_note"))).toContain("#tmv/memory");
    expect(await tagOf(find(result.files, answer.id, "answer_note"))).toContain("#tmv/answer");
    expect(await tagOf(find(result.files, String(result.files.find((f) => f.logicalType === "conflict_note")!.entityId), "conflict_note"))).toContain("#tmv/conflict");
    expect(await tagOf(find(result.files, "alex", "person_note"))).toContain("#tmv/person");
    expect(await tagOf(find(result.files, "sqlite", "topic_note"))).toContain("#tmv/topic");
  });
});

describe("Graph presentation — shorter labels, full ids preserved", () => {
  it("shortens the answer label by stripping the interrogative stem; full id stays in frontmatter", async () => {
    const { result, answer } = await fixture();
    const note = find(result.files, answer.id, "answer_note");
    expect(questionLabel("What is the source of truth?")).toBe("source of truth?"); // stem stripped (safeName drops the ? in the filename)
    expect(note.relativePath).toContain("source of truth");
    expect(note.relativePath).not.toContain("What is");
    expect(await read(note.relativePath)).toContain(`mv_entity_id: ${JSON.stringify(answer.id)}`); // full id preserved
    expect(byPath(result.files, "00 Home.md")).toBeTruthy(); // home still generated
  });
});
