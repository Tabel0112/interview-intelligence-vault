import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import {
  getCanonicalMemoryObject, isReviewableMemoryObject, isStrongMemoryObject, isUsableAsEvidence,
  type CanonicalMemoryObject, type RawMemoryObjectForCanonical,
} from "../src/memory/canonical.js";
import { memoryFingerprint, normalizeMemoryText, storeMemoryObjectWithEvidence, type TranscriptSpanForExtraction, type ValidatedMemoryCandidate } from "../src/memory/extraction/index.js";

let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;
beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); });
afterEach(() => db.close());

function fixture() {
  const imported = importTranscript(db, { filename: "canonical.txt", rawText: "Alex: Action item: add canonical memory tests." });
  const span = db.prepare(`SELECT s.transcript_id transcriptId,
    (SELECT id FROM transcript_turns WHERE transcript_id=s.transcript_id LIMIT 1) turnId,
    s.id spanId,s.speaker_label speaker,s.start_char startOffset,s.end_char endOffset,s.text,s.start_time_ms startTimeMs,s.end_time_ms endTimeMs
    FROM transcript_spans s WHERE s.transcript_id=?`).get(imported.transcriptId) as TranscriptSpanForExtraction;
  return { imported, span };
}

function store(status: "active" | "weak" | "needs_review" = "active", duplicateOfId: string | null = null) {
  const { imported, span } = fixture();
  const normalizedText = normalizeMemoryText("Add canonical tests", "Add canonical memory tests.");
  const candidate: ValidatedMemoryCandidate = {
    type: "action_item", title: "Add canonical tests", body: "Add canonical memory tests.", evidenceSpanIds: [span.spanId],
    confidence: status === "active" ? 0.95 : 0.3, transcriptId: imported.transcriptId, normalizedText,
    fingerprint: memoryFingerprint("action_item", normalizedText), confidenceLabel: status === "active" ? "high" : "low",
    status, finalConfidence: status === "active" ? 0.9 : 0.3, evidenceSpans: [span],
  };
  const runId = `xrun_test_${(db.prepare("SELECT COUNT(*) count FROM extraction_runs").get() as { count: number }).count}`;
  db.prepare(`INSERT INTO extraction_runs(id,transcript_id,started_at,status,extractor_kind,prompt_version,config_json)
    VALUES (?,?,?,'running','test','v','{}')`).run(runId, imported.transcriptId, new Date().toISOString());
  return storeMemoryObjectWithEvidence(db, runId, "v", candidate, duplicateOfId);
}

describe("canonical memory mapping", () => {
  it("maps legacy-compatible and extracted fields to one canonical source of truth", () => {
    const extracted = store("weak");
    const canonical = repos.memoryObjects.getCanonicalMemoryObject(extracted.id)!;
    expect(canonical).toMatchObject({ type: "action_item", status: "weak", confidenceLabel: "low", body: "Add canonical memory tests." });
    expect(canonical.evidenceSpanIds).toHaveLength(1);

    const { span } = fixture();
    const legacy = repos.memoryObjects.createMemoryObject({ type: "task", title: "Legacy task", generated_text: "Legacy body", confidence: 0.9, created_by: "agent" }, [{ span_id: span.spanId, role: "source", evidence_score: 0.9 }]);
    expect(repos.memoryObjects.getCanonicalMemoryObject(legacy.id)).toMatchObject({ type: "task", status: "active", confidenceLabel: "high" });
  });

  it("repository canonical listing filters by canonical extraction fields", () => {
    store("weak");
    expect(repos.memoryObjects.listCanonicalMemoryObjects({ type: "action_item", status: "weak" })).toHaveLength(1);
    expect(repos.memoryObjects.listCanonicalMemoryObjects({ type: "task" })).toHaveLength(0);
  });
});

describe("canonical trust decisions", () => {
  it("does not treat weak or needs-review objects as strong truth", () => {
    for (const status of ["weak", "needs_review"] as const) {
      const memory = repos.memoryObjects.getCanonicalMemoryObject(store(status).id)!;
      expect(isStrongMemoryObject(memory)).toBe(false);
      expect(isReviewableMemoryObject(memory)).toBe(true);
      expect(isUsableAsEvidence(memory)).toBe(false);
      expect(isUsableAsEvidence(memory, { includeWeak: true })).toBe(true);
      expect(() => repos.memoryObjects.updateMemoryObjectStatus(memory.id, "active")).toThrow();
    }
  });

  it("does not use rejected, superseded, evidence-free, or duplicate-linked objects independently", () => {
    const strong = repos.memoryObjects.getCanonicalMemoryObject(store("active").id)!;
    expect(isStrongMemoryObject(strong)).toBe(true);
    for (const status of ["rejected", "superseded"] as const) {
      const memory: CanonicalMemoryObject = { ...strong, status };
      expect(isStrongMemoryObject(memory)).toBe(false);
      expect(isUsableAsEvidence(memory)).toBe(false);
    }
    expect(isStrongMemoryObject({ ...strong, evidenceSpanIds: [] })).toBe(false);
    const duplicate = { ...strong, duplicateOfId: "mem_original" };
    expect(isStrongMemoryObject(duplicate)).toBe(false);
    expect(isUsableAsEvidence(duplicate)).toBe(false);
    expect(isUsableAsEvidence(duplicate, { includeDuplicates: true })).toBe(true);
  });

  it("legacy active status cannot override canonical extraction weak status", () => {
    const raw: RawMemoryObjectForCanonical = {
      id: "mem_x", type: "task", status: "active", confidence: 0.95, title: "Task", generated_text: "Body",
      extraction_type: "action_item", extraction_status: "weak", confidence_label: "high",
    };
    const canonical = getCanonicalMemoryObject(raw, ["span_x"]);
    expect(canonical).toMatchObject({ type: "action_item", status: "weak" });
    expect(isStrongMemoryObject(canonical)).toBe(false);
  });

  it("user-corrected active objects remain strong with evidence and corrections synchronize canonical status", () => {
    const object = store("active");
    repos.corrections.applyMemoryObjectCorrection(object.id, { correction_type: "edit", new_value: { confidence: 0.4 } });
    expect(isStrongMemoryObject(repos.memoryObjects.getCanonicalMemoryObject(object.id)!)).toBe(true);
    repos.corrections.applyMemoryObjectCorrection(object.id, { correction_type: "reject", new_value: { status: "rejected" } });
    expect(repos.memoryObjects.getCanonicalMemoryObject(object.id)).toMatchObject({ status: "rejected", userCorrected: true });
  });

  it("removing the last evidence downgrades canonical active status", () => {
    const object = store("active");
    db.prepare("DELETE FROM memory_object_evidence WHERE memory_id=?").run(object.id);
    const canonical = repos.memoryObjects.getCanonicalMemoryObject(object.id)!;
    expect(canonical).toMatchObject({ status: "needs_review", evidenceSpanIds: [] });
    expect(isStrongMemoryObject(canonical)).toBe(false);
  });
});
