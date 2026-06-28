import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import {
  buildExtractionWindows, buildMemoryExtractionPrompt, DeterministicRuleExtractor, extractMemoryObjectsForTranscript,
  memoryFingerprint, normalizeMemoryText, scoreCandidateConfidence, storeMemoryObjectWithEvidence,
  validateMemoryCandidate, type ExtractedMemoryCandidate, type ExtractionWindow, type MemoryExtractor,
  type TranscriptSpanForExtraction, type ValidatedMemoryCandidate,
} from "../src/memory/extraction/index.js";

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const raw = `Alex: We decided the MVP will use SQLite as the source of truth.
Sam: Should citations be mandatory?
Alex: Action item: implement source span validation.
Sam: But repeated noisy objects could be a concern.
Alex: I recommend keeping inferred graph edges separate.
Sam: Topic: evidence scoring for Ask AI.
Alex: Quote: Weak evidence should not be treated as certainty.`;

function fixture() {
  const imported = importTranscript(db, { filename: "memory.txt", rawText: raw, sourceType: "test" });
  const spans = db.prepare(`SELECT s.transcript_id transcriptId,
    (SELECT tt.id FROM transcript_turns tt WHERE tt.transcript_id=s.transcript_id AND tt.start_char<=s.start_char AND tt.end_char>=s.end_char LIMIT 1) turnId,
    s.id spanId,s.speaker_label speaker,s.start_char startOffset,s.end_char endOffset,s.text,s.start_time_ms startTimeMs,s.end_time_ms endTimeMs
    FROM transcript_spans s WHERE s.transcript_id=? ORDER BY s.ordinal`).all(imported.transcriptId) as TranscriptSpanForExtraction[];
  return { imported, spans };
}

class StubExtractor implements MemoryExtractor {
  readonly kind = "test" as const;
  constructor(private readonly factory: (window: ExtractionWindow) => ExtractedMemoryCandidate[] | Promise<ExtractedMemoryCandidate[]>) {}
  async extract(window: ExtractionWindow) { return this.factory(window); }
}

describe("memory extraction utilities", () => {
  it("builds structured deterministic windows and prompts", () => {
    const { spans } = fixture();
    const windows = buildExtractionWindows(spans, 180, 1);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].text).toContain(`[span_id=${spans[0].spanId} speaker=Alex]`);
    expect(buildMemoryExtractionPrompt(windows[0])).toContain("Do not invent facts");
    expect(buildExtractionWindows(spans, 180, 1)).toEqual(windows);
  });

  it("clamps confidence and penalizes vague objects", () => {
    const { spans } = fixture();
    const vague = scoreCandidateConfidence({ type: "topic", title: "AI", body: "AI", evidenceSpanIds: [spans[0].spanId], confidence: 2 }, [spans[0]]);
    const specific = scoreCandidateConfidence({ type: "topic", title: "Evidence scoring for Ask AI", body: "Specific evidence scoring design", evidenceSpanIds: [spans[0].spanId], confidence: 1 }, [spans[0]]);
    expect(vague.finalConfidence).toBeLessThan(specific.finalConfidence);
    expect(specific.finalConfidence).toBeLessThanOrEqual(1);
  });

  it("validates quote exactness and evidence IDs", () => {
    const { imported, spans } = fixture();
    const window = buildExtractionWindows(spans)[0];
    const exact = validateMemoryCandidate({ type: "quote", title: "Weak evidence", body: "Weak evidence should not be treated as certainty.", evidenceSpanIds: [spans[6].spanId], confidence: 0.9 }, window);
    expect(exact.ok).toBe(true);
    expect(validateMemoryCandidate({ type: "quote", title: "Paraphrase", body: "Weak evidence is uncertain.", evidenceSpanIds: [spans[6].spanId], confidence: 0.9 }, window).ok).toBe(false);
    expect(validateMemoryCandidate({ type: "quote", title: "Missing", body: "Text", evidenceSpanIds: ["missing"], confidence: 0.9 }, window).ok).toBe(false);
    const other = importTranscript(db, { filename: "other.txt", rawText: "Other: unrelated source" });
    const crossSpan = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(other.transcriptId) as { id: string };
    expect(validateMemoryCandidate({ type: "topic", title: "Cross transcript", body: "Cross transcript", evidenceSpanIds: [crossSpan.id], confidence: 0.8 }, { ...window, transcriptId: imported.transcriptId }).ok).toBe(false);
  });
});

describe("memory extraction pipeline", () => {
  it("extracts all MVP types with evidence and preserves raw transcript truth", async () => {
    const { imported, spans } = fixture();
    const before = (db.prepare("SELECT raw_text FROM transcripts WHERE id=?").get(imported.transcriptId) as { raw_text: string }).raw_text;
    const candidates: ExtractedMemoryCandidate[] = [
      { type: "topic", title: "Evidence scoring for Ask AI", body: "Evidence scoring is a central topic.", evidenceSpanIds: [spans[5].spanId], confidence: 0.9 },
      { type: "quote", title: "Weak evidence quote", body: "Weak evidence should not be treated as certainty.", evidenceSpanIds: [spans[6].spanId], confidence: 0.95 },
      { type: "question", title: "Are citations mandatory?", body: "Should citations be mandatory?", evidenceSpanIds: [spans[1].spanId], confidence: 0.9 },
      { type: "decision", title: "Use SQLite as source of truth", body: "The MVP will use SQLite as the source of truth.", evidenceSpanIds: [spans[0].spanId], confidence: 0.99 },
      { type: "action_item", title: "Implement source span validation", body: "Implement source span validation.", evidenceSpanIds: [spans[2].spanId], confidence: 0.95 },
      { type: "objection", title: "Repeated objects could be noisy", body: "Repeated noisy objects could be a concern.", evidenceSpanIds: [spans[3].spanId], confidence: 0.85 },
      { type: "advice_idea", title: "Separate inferred graph edges", body: "Keep inferred graph edges separate.", evidenceSpanIds: [spans[4].spanId], confidence: 0.85 },
    ];
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId: imported.transcriptId, extractor: new StubExtractor(() => candidates) });
    expect(result).toMatchObject({ objectsInserted: 7, rejectedCandidates: 0 });
    const objects = db.prepare("SELECT * FROM memory_objects WHERE extraction_run_id=? ORDER BY extraction_type").all(result.extractionRunId) as Array<{ id: string; extraction_type: string; extraction_status: string }>;
    expect(new Set(objects.map((object) => object.extraction_type))).toEqual(new Set(["topic", "quote", "question", "decision", "action_item", "objection", "advice_idea"]));
    objects.forEach((object) => expect(db.prepare("SELECT COUNT(*) count FROM memory_object_evidence WHERE memory_id=?").get(object.id)).toEqual({ count: 1 }));
    expect((db.prepare("SELECT raw_text FROM transcripts WHERE id=?").get(imported.transcriptId) as { raw_text: string }).raw_text).toBe(before);
  });

  it("stores weak and uncertain decisions as reviewable, never active", async () => {
    const { imported, spans } = fixture();
    const extractor = new StubExtractor(() => [
      { type: "decision", title: "Possibly use another store", body: "Maybe use another store.", evidenceSpanIds: [spans[0].spanId], confidence: 0.05 },
      { type: "topic", title: "Uncertain retrieval design", body: "A weakly supported retrieval topic.", evidenceSpanIds: [spans[1].spanId], confidence: 0.05 },
    ]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId: imported.transcriptId, extractor });
    const statuses = db.prepare("SELECT extraction_type,extraction_status FROM memory_objects WHERE extraction_run_id=? ORDER BY extraction_type").all(result.extractionRunId);
    expect(statuses).toEqual([{ extraction_type: "decision", extraction_status: "needs_review" }, { extraction_type: "topic", extraction_status: "weak" }]);
    expect(result.weakObjectsInserted).toBe(2);
  });

  it("rejects unsupported candidates and invalid/paraphrased quotes", async () => {
    const { imported, spans } = fixture();
    const extractor = new StubExtractor(() => [
      { type: "topic", title: "No evidence", body: "No evidence", evidenceSpanIds: [], confidence: 0.9 },
      { type: "quote", title: "Bad quote", body: "Paraphrased quote", evidenceSpanIds: [spans[6].spanId], confidence: 0.9 },
      { type: "decision", title: "Missing span", body: "Missing span", evidenceSpanIds: ["missing"], confidence: 0.9 },
    ]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId: imported.transcriptId, extractor });
    expect(result).toMatchObject({ objectsInserted: 0, rejectedCandidates: 3 });
    expect(db.prepare("SELECT COUNT(*) count FROM memory_objects WHERE extraction_run_id=?").get(result.extractionRunId)).toEqual({ count: 0 });
  });

  it("is idempotent across reruns and overlapping windows", async () => {
    const { imported } = fixture();
    const extractor = new DeterministicRuleExtractor();
    const first = await extractMemoryObjectsForTranscript(db, { transcriptId: imported.transcriptId, extractor, maxWindowChars: 120, overlapSpans: 1 });
    const ids = (db.prepare("SELECT id FROM memory_objects WHERE extraction_type IS NOT NULL ORDER BY id").all() as Array<{ id: string }>).map(({ id }) => id);
    const second = await extractMemoryObjectsForTranscript(db, { transcriptId: imported.transcriptId, extractor, maxWindowChars: 120, overlapSpans: 1 });
    expect(second.duplicatesSkipped).toBeGreaterThan(0);
    expect((db.prepare("SELECT id FROM memory_objects WHERE extraction_type IS NOT NULL ORDER BY id").all() as Array<{ id: string }>).map(({ id }) => id)).toEqual(ids);
    expect(first.objectsInserted).toBeGreaterThan(0);
  });

  it("preserves user-corrected duplicate objects", async () => {
    const { imported, spans } = fixture();
    const candidate = { type: "decision" as const, title: "Use SQLite", body: "Use SQLite as source of truth.", evidenceSpanIds: [spans[0].spanId], confidence: 0.95 };
    await extractMemoryObjectsForTranscript(db, { transcriptId: imported.transcriptId, extractor: new StubExtractor(() => [candidate]) });
    const object = db.prepare("SELECT id FROM memory_objects WHERE extraction_type='decision'").get() as { id: string };
    createRepositories(db).corrections.applyMemoryObjectCorrection(object.id, { correction_type: "edit", new_value: { generated_text: "User corrected text" } });
    await extractMemoryObjectsForTranscript(db, { transcriptId: imported.transcriptId, extractor: new StubExtractor(() => [candidate]) });
    expect(db.prepare("SELECT generated_text,user_corrected FROM memory_objects WHERE id=?").get(object.id)).toEqual({ generated_text: "User corrected text", user_corrected: 1 });
  });

  it("auto-merges exact-duplicate ideas onto one canonical with consolidated evidence", async () => {
    const { imported, spans } = fixture();
    const make = (spanId: string): ExtractedMemoryCandidate => ({ type: "topic", title: "Source-backed memory", body: "Source-backed memory is important.", evidenceSpanIds: [spanId], confidence: 0.99 });
    await extractMemoryObjectsForTranscript(db, { transcriptId: imported.transcriptId, extractor: new StubExtractor(() => [make(spans[0].spanId)]) });
    await extractMemoryObjectsForTranscript(db, { transcriptId: imported.transcriptId, extractor: new StubExtractor(() => [make(spans[1].spanId)]) });
    // EXACT duplicate (same type + normalized text) -> ONE canonical, evidence consolidated, no duplicate row.
    const objects = db.prepare("SELECT id,duplicate_of_id FROM memory_objects WHERE extraction_type='topic'").all() as Array<{ id: string; duplicate_of_id: string | null }>;
    expect(objects).toHaveLength(1);
    expect(objects[0].duplicate_of_id).toBeNull();
    const spanLinks = (db.prepare("SELECT DISTINCT span_id FROM memory_object_evidence WHERE memory_id=?").all(objects[0].id) as Array<{ span_id: string }>).map((s) => s.span_id).sort();
    expect(spanLinks).toEqual([spans[0].spanId, spans[1].spanId].sort());
  });

  it("database blocks direct active extraction inserts before evidence exists", () => {
    expect(() => db.prepare(`INSERT INTO memory_objects(
      id,type,title,generated_text,status,confidence,created_by,created_at,updated_at,metadata_json,extraction_type,extraction_status
    ) VALUES ('mem_direct','topic','Direct','Direct','active',0.9,'agent','now','now','{}','topic','active')`).run()).toThrow();
  });

  it("rolls back memory storage when evidence insertion fails", () => {
    const { imported, spans } = fixture();
    const normalizedText = normalizeMemoryText("Broken", "Broken evidence");
    const candidate: ValidatedMemoryCandidate = {
      type: "topic", title: "Broken", body: "Broken evidence", evidenceSpanIds: ["missing"], confidence: 0.9,
      transcriptId: imported.transcriptId, normalizedText, fingerprint: memoryFingerprint("topic", normalizedText),
      confidenceLabel: "high", status: "active", finalConfidence: 0.9,
      evidenceSpans: [{ ...spans[0], spanId: "missing" }],
    };
    const runId = "xrun_manual";
    db.prepare(`INSERT INTO extraction_runs(id,transcript_id,started_at,status,extractor_kind,prompt_version,config_json) VALUES (?,?,?,'running','test','v','{}')`).run(runId, imported.transcriptId, new Date().toISOString());
    expect(() => storeMemoryObjectWithEvidence(db, runId, "v", candidate)).toThrow();
    expect(db.prepare("SELECT COUNT(*) count FROM memory_objects WHERE extraction_run_id=?").get(runId)).toEqual({ count: 0 });
  });

  it("records a failed run when every extractor window fails", async () => {
    const { imported } = fixture();
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId: imported.transcriptId, extractor: new StubExtractor(() => { throw new Error("extractor unavailable"); }) });
    expect(result.errors[0]).toContain("extractor unavailable");
    expect(db.prepare("SELECT status,error_message FROM extraction_runs WHERE id=?").get(result.extractionRunId)).toMatchObject({ status: "failed" });
  });
});
