import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import {
  createExtractionRun, dedupeCanonicalMemories, extractMemoryObjectsForTranscript, loadSpansForTranscript,
  memoryFingerprint, normalizeMemoryText, storeMemoryObjectWithEvidence,
  type ExtractedMemoryCandidate, type ExtractionMemoryObjectType, type ExtractionWindow, type MemoryExtractor, type ValidatedMemoryCandidate,
} from "../src/memory/index.js";
import { buildObsidianGraph } from "../src/obsidian/graphBuilder.js";
import { createConflictRepository, type ConflictCandidate } from "../src/conflicts/index.js";
import { resolveEvidencePointer } from "../src/provenance/index.js";
import { indexTranscriptForRetrieval } from "../src/retrieval/index.js";

let db: SqliteDatabase;
let n = 0;
beforeEach(() => { db = openDatabase(":memory:"); n = 0; });
afterEach(() => db.close());

// Controllable extractor; kind "deterministic" so its candidates are NOT capped to needs_review.
class FixedExtractor implements MemoryExtractor {
  readonly kind = "deterministic" as const;
  readonly model = null;
  constructor(private readonly build: (w: ExtractionWindow) => ExtractedMemoryCandidate[]) {}
  async extract(w: ExtractionWindow) { return this.build(w); }
}

// Import a transcript (unique raw text) + extract one candidate from its first span + bridge to pointers.
async function importExtract(rawText: string, candidate: (spanId: string) => ExtractedMemoryCandidate) {
  const imported = importTranscript(db, { filename: `t${++n}.txt`, rawText });
  await extractMemoryObjectsForTranscript(db, { transcriptId: imported.transcriptId, extractor: new FixedExtractor((w) => [candidate(w.spans[0].spanId)]) });
  await indexTranscriptForRetrieval(db, imported.transcriptId);
  return imported;
}
const decision = (title: string, body: string) => (spanId: string): ExtractedMemoryCandidate => ({ type: "decision", title, body, evidenceSpanIds: [spanId], confidence: 0.95 });

const activeMemories = (type = "decision") => db.prepare(`SELECT id,title,duplicate_of_id,status,extraction_status,user_corrected FROM memory_objects
  WHERE COALESCE(extraction_type,type)=? AND duplicate_of_id IS NULL AND status NOT IN ('superseded','rejected') AND (extraction_status IS NULL OR extraction_status NOT IN ('superseded','rejected'))`)
  .all(type) as Array<{ id: string; title: string; duplicate_of_id: string | null; status: string; extraction_status: string | null; user_corrected: number }>;
const pointerTranscripts = (memoryId: string) => (db.prepare("SELECT DISTINCT transcript_id FROM evidence_pointers WHERE target_type='memory_object' AND target_id=?").all(memoryId) as Array<{ transcript_id: string }>).map((r) => r.transcript_id);

// Seed N pre-existing ACTIVE exact-duplicate memories (same type + normalized text, different spans/transcripts),
// bypassing the pipeline's consolidation — i.e. the kind of duplicates that exist before the repair pass runs.
function seedExactDuplicates(count: number, type: ExtractionMemoryObjectType = "decision") {
  const ids: string[] = [], transcriptIds: string[] = [];
  const normalizedText = normalizeMemoryText("Use SQLite", "We decided to use SQLite as the source of truth.");
  const fingerprint = memoryFingerprint(type, normalizedText);
  for (let i = 0; i < count; i++) {
    const imported = importTranscript(db, { filename: `seed${i}-${++n}.txt`, rawText: `Speaker${i}: We decided to use SQLite as the source of truth. variant ${i}` });
    const spans = loadSpansForTranscript(db, imported.transcriptId);
    const runId = createExtractionRun(db, { transcriptId: imported.transcriptId, extractorKind: "test", promptVersion: "v" });
    const candidate: ValidatedMemoryCandidate = {
      type, title: "Use SQLite", body: "We decided to use SQLite as the source of truth.", evidenceSpanIds: [spans[0].spanId],
      confidence: 0.95, transcriptId: imported.transcriptId, normalizedText, fingerprint, confidenceLabel: "high",
      status: "active", finalConfidence: 0.95, evidenceSpans: [spans[0]],
    };
    ids.push(storeMemoryObjectWithEvidence(db, runId, "v", candidate).id);
    indexTranscriptForRetrieval(db, imported.transcriptId);
    transcriptIds.push(imported.transcriptId);
  }
  return { ids, transcriptIds };
}

describe("Canonical memory dedup — exact auto-merge", () => {
  it("merges exact-duplicate claims from 3 transcripts into ONE canonical with evidence from all", async () => {
    const claim = decision("Use SQLite", "We decided to use SQLite as the source of truth.");
    const a = await importExtract("Alex: We decided to use SQLite as the source of truth.", claim);
    const b = await importExtract("Sam: We decided to use SQLite as the source of truth. Indeed.", claim);
    const c = await importExtract("Jo: We decided to use SQLite as the source of truth. Agreed.", claim);
    const active = activeMemories();
    expect(active).toHaveLength(1); // ONE canonical, not three
    expect((db.prepare("SELECT COUNT(*) c FROM memory_objects WHERE COALESCE(extraction_type,type)='decision'").get() as { c: number }).c).toBe(1); // no duplicate rows at all
    expect(pointerTranscripts(active[0].id).sort()).toEqual([a.transcriptId, b.transcriptId, c.transcriptId].sort()); // evidence from all 3 sources
  });

  it("re-running extraction is idempotent (no new memories, no duplicate evidence links)", async () => {
    const claim = decision("Use SQLite", "We decided to use SQLite as the source of truth.");
    const a = await importExtract("Alex: We decided to use SQLite as the source of truth.", claim);
    const memBefore = db.prepare("SELECT COUNT(*) c FROM memory_objects").get();
    const evBefore = db.prepare("SELECT COUNT(*) c FROM memory_object_evidence").get();
    await extractMemoryObjectsForTranscript(db, { transcriptId: a.transcriptId, extractor: new FixedExtractor((w) => [claim(w.spans[0].spanId)]) });
    expect(db.prepare("SELECT COUNT(*) c FROM memory_objects").get()).toEqual(memBefore);
    expect(db.prepare("SELECT COUNT(*) c FROM memory_object_evidence").get()).toEqual(evBefore);
  });
});

describe("Canonical memory dedup — near-duplicate review, not merge", () => {
  it("routes a near-duplicate (one word different) to a needs_review possible-duplicate suggestion, not a merge", async () => {
    const a = await importExtract("Alex: We decided to use SQLite as the source of truth.", decision("Use SQLite", "We decided to use SQLite as the source of truth."));
    await importExtract("Sam: We decided to use SQLite as the main source of truth.", decision("Use SQLite", "We decided to use SQLite as the main source of truth."));
    const canonical = activeMemories()[0];
    const near = db.prepare("SELECT id,duplicate_of_id,extraction_status FROM memory_objects WHERE duplicate_of_id IS NOT NULL").get() as { id: string; duplicate_of_id: string; extraction_status: string };
    expect(near.duplicate_of_id).toBe(canonical.id);   // linked as a possible duplicate
    expect(near.extraction_status).toBe("needs_review"); // surfaced for review, never an active independent node
    expect(pointerTranscripts(canonical.id)).toEqual([a.transcriptId]); // NOT merged — canonical evidence unchanged
  });
});

describe("Canonical memory dedup — safety", () => {
  it("never merges a negated/contradictory claim (different fingerprint)", async () => {
    const a = await importExtract("Alex: We decided to use SQLite.", decision("Use SQLite", "We decided to use SQLite."));
    await importExtract("Sam: We decided not to use SQLite.", decision("Avoid SQLite", "We decided not to use SQLite."));
    const positive = db.prepare("SELECT id FROM memory_objects WHERE title='Use SQLite'").get() as { id: string };
    expect(pointerTranscripts(positive.id)).toEqual([a.transcriptId]); // negation never consolidated into the positive claim
    expect((db.prepare("SELECT COUNT(*) c FROM memory_objects WHERE COALESCE(extraction_type,type)='decision'").get() as { c: number }).c).toBeGreaterThanOrEqual(2);
  });

  it("never merges identical wording across different types/categories", async () => {
    const text = "We decided to use SQLite as the source of truth.";
    await importExtract(`Alex: ${text}`, (sid) => ({ type: "decision", title: "Use SQLite", body: text, evidenceSpanIds: [sid], confidence: 0.95 }));
    await importExtract(`Sam: ${text} Right.`, (sid) => ({ type: "topic", title: "Use SQLite", body: text, evidenceSpanIds: [sid], confidence: 0.95 }));
    expect(activeMemories("decision")).toHaveLength(1);
    expect(activeMemories("topic")).toHaveLength(1); // a separate canonical per type
  });
});

describe("Canonical memory dedup — repair pass", () => {
  it("consolidates pre-existing duplicates onto one canonical, keeps provenance valid, leaves raw transcripts untouched, and is idempotent", () => {
    const { transcriptIds } = seedExactDuplicates(3);
    const rawBefore = db.prepare("SELECT id, raw_text, raw_sha256 FROM transcripts ORDER BY id").all();
    expect(activeMemories()).toHaveLength(3); // pre-existing duplicates

    const r1 = dedupeCanonicalMemories(db);
    expect(r1.canonicalGroups).toBe(1);
    expect(r1.duplicatesSuperseded).toBe(2);
    expect(r1.evidenceLinksConsolidated).toBeGreaterThanOrEqual(2);

    const active = activeMemories();
    expect(active).toHaveLength(1); // ONE canonical
    expect(pointerTranscripts(active[0].id).sort()).toEqual([...transcriptIds].sort()); // evidence consolidated from all sources
    for (const p of db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type='memory_object' AND target_id=?").all(active[0].id) as Array<{ evidence_pointer_id: string }>) {
      expect(resolveEvidencePointer(db, p.evidence_pointer_id).ok).toBe(true); // provenance pointers still resolve
    }
    expect(db.prepare("SELECT COUNT(*) c FROM memory_objects WHERE duplicate_of_id IS NOT NULL AND status='superseded'").get()).toEqual({ c: 2 });
    expect(db.prepare("SELECT id, raw_text, raw_sha256 FROM transcripts ORDER BY id").all()).toEqual(rawBefore); // raw transcripts unchanged

    expect(dedupeCanonicalMemories(db)).toEqual({ canonicalGroups: 0, duplicatesSuperseded: 0, evidenceLinksConsolidated: 0 }); // idempotent
  });

  it("user-corrected memory wins canonical selection and is never silently superseded", () => {
    const { ids } = seedExactDuplicates(2);
    db.prepare("UPDATE memory_objects SET user_corrected=1 WHERE id=?").run(ids[1]); // mark the 2nd user-corrected
    dedupeCanonicalMemories(db);
    expect(db.prepare("SELECT status,duplicate_of_id FROM memory_objects WHERE id=?").get(ids[1])).toMatchObject({ status: "active", duplicate_of_id: null }); // protected canonical
    expect(db.prepare("SELECT status,duplicate_of_id FROM memory_objects WHERE id=?").get(ids[0])).toMatchObject({ status: "superseded", duplicate_of_id: ids[1] });
  });
});

describe("Canonical memory dedup — graph + conflict preservation", () => {
  it("native graph shows one canonical memory node linked to all evidence; superseded duplicates hidden; wikilinks resolve", () => {
    seedExactDuplicates(3);
    dedupeCanonicalMemories(db);
    const { graph } = buildObsidianGraph(db);
    const memoryNodes = graph.nodes.filter((node) => node.type === "decision" || node.type === "memory");
    expect(memoryNodes).toHaveLength(1); // one canonical node, not three
    const canonical = memoryNodes[0];
    expect(canonical.notePath).toBeTruthy(); // has a generated note path (wikilink target)
    const evidenceNodeIds = new Set(graph.nodes.filter((node) => node.type === "evidence").map((node) => node.id));
    const linkedEvidence = graph.edges.filter((edge) => (edge.source === canonical.id && evidenceNodeIds.has(edge.target)) || (edge.target === canonical.id && evidenceNodeIds.has(edge.source)));
    expect(linkedEvidence.length).toBeGreaterThanOrEqual(3); // canonical links to evidence from all 3 sources
    // no graph node points at a superseded memory id
    const supersededIds = (db.prepare("SELECT id FROM memory_objects WHERE status='superseded'").all() as Array<{ id: string }>).map((r) => `memory:${r.id}`);
    expect(graph.nodes.some((node) => supersededIds.includes(node.id))).toBe(false);
  });

  it("does not hide or alter conflicts when merging an exact-duplicate group", () => {
    // An exact-duplicate group (2 members, will merge) plus a contradictory claim it conflicts with.
    const m1ids = seedExactDuplicates(2).ids;
    const avoid = importTranscript(db, { filename: `avoid-${++n}.txt`, rawText: "Sam: We decided NOT to use SQLite at all." });
    const avoidSpans = loadSpansForTranscript(db, avoid.transcriptId);
    const runId = createExtractionRun(db, { transcriptId: avoid.transcriptId, extractorKind: "test", promptVersion: "v" });
    const avoidNorm = normalizeMemoryText("Avoid SQLite", "We decided not to use SQLite at all.");
    const m2 = storeMemoryObjectWithEvidence(db, runId, "v", {
      type: "decision", title: "Avoid SQLite", body: "We decided not to use SQLite at all.", evidenceSpanIds: [avoidSpans[0].spanId],
      confidence: 0.95, transcriptId: avoid.transcriptId, normalizedText: avoidNorm, fingerprint: memoryFingerprint("decision", avoidNorm),
      confidenceLabel: "high", status: "active", finalConfidence: 0.95, evidenceSpans: [avoidSpans[0]],
    }).id;
    indexTranscriptForRetrieval(db, avoid.transcriptId);
    const ptr = (id: string) => (db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_id=? LIMIT 1").get(id) as { evidence_pointer_id: string }).evidence_pointer_id;
    const candidate: ConflictCandidate = {
      leftTargetId: m1ids[0], leftTargetType: "memory_object", leftText: "use SQLite", leftEvidenceIds: [ptr(m1ids[0])],
      rightTargetId: m2, rightTargetType: "memory_object", rightText: "avoid SQLite", rightEvidenceIds: [ptr(m2)], sharedTopics: ["SQLite"],
    };
    createConflictRepository(db).createConflictAssessment({ candidate });

    const conflictsBefore = db.prepare("SELECT id,status,kind,left_target_id,right_target_id FROM conflict_assessments ORDER BY id").all();
    const linksBefore = db.prepare("SELECT id,conflict_assessment_id,side,evidence_pointer_id FROM conflict_evidence_links ORDER BY id").all();
    expect(conflictsBefore.length).toBeGreaterThan(0); // the setup actually created a conflict (non-vacuous)

    dedupeCanonicalMemories(db); // merges the exact-duplicate group; must NOT touch conflict data

    expect(db.prepare("SELECT id,status,kind,left_target_id,right_target_id FROM conflict_assessments ORDER BY id").all()).toEqual(conflictsBefore); // conflict rows unchanged
    expect(db.prepare("SELECT id,conflict_assessment_id,side,evidence_pointer_id FROM conflict_evidence_links ORDER BY id").all()).toEqual(linksBefore); // both sides' evidence preserved
  });
});
