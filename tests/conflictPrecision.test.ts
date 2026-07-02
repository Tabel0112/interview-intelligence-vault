// Conflict-classification precision: a negation must deny a predicate the OTHER side actually asserts.
// Shared topic/location tokens + an unrelated negation must NOT produce a direct contradiction, while
// real oppositions (same predicate, opposite polarity/value) must keep detecting.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyConflictCandidate, type ConflictCandidate } from "../src/conflicts/index.js";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import {
  createLlmMemoryExtractor, extractMemoryObjectsForTranscript, findConflictingActiveMemory, type MemoryExtractor,
} from "../src/memory/extraction/index.js";
import { MockLlmProvider } from "../src/llm/testing.js";
import { indexTranscriptForRetrieval } from "../src/retrieval/index.js";

const pair = (leftText: string, rightText: string, overrides: Partial<ConflictCandidate> = {}): ConflictCandidate => ({
  leftTargetId: "left", leftTargetType: "memory_object", leftText, leftEvidenceIds: ["left-evidence"],
  rightTargetId: "right", rightTargetType: "memory_object", rightText, rightEvidenceIds: ["right-evidence"],
  ...overrides,
});

describe("false positives rejected: negation about an UNRELATED predicate is not a contradiction", () => {
  it("the reported case: API-key privacy rule vs generated-notes-are-disposable is NOT a conflict", () => {
    const result = classifyConflictCandidate(pair(
      "The app should never display real API keys in Settings or generated notes.",
      "Raw transcripts should be immutable. Generated notes are only a disposable Obsidian view layer.",
    ));
    expect(result.kind).toBe("weak_or_ambiguous"); // shares "generated notes" but denies a different predicate
    expect(result.componentScores.polarityOpposition).toBe(0);
  });

  it("immutability rule vs unrelated negated display rule is NOT a conflict", () => {
    expect(classifyConflictCandidate(pair(
      "Raw transcripts should be immutable.",
      "API keys should not be shown in Settings.",
    )).kind).toBe("weak_or_ambiguous");
  });

  it("disposable-notes vs notes-must-not-contain-secrets is NOT a conflict (compatible policies)", () => {
    expect(classifyConflictCandidate(pair(
      "Generated notes are a disposable view layer.",
      "Generated notes should not contain secrets.",
    )).kind).toBe("weak_or_ambiguous");
  });
});

describe("real conflicts preserved: negation denying the SAME asserted predicate/value", () => {
  it("displayed vs never displayed (same object + location) IS a direct contradiction", () => {
    const result = classifyConflictCandidate(pair(
      "API keys should be displayed in Settings.",
      "API keys should never be displayed in Settings.",
    ));
    expect(result.kind).toBe("direct_contradiction");
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("Friday deadline vs 'Monday, not Friday' correction IS a conflict (contradiction or temporal update)", () => {
    const plain = classifyConflictCandidate(pair(
      "The final PR deadline is Friday at 5 PM.",
      "The final PR deadline is Monday at 10 AM, not Friday.",
    ));
    expect(plain.kind).toBe("direct_contradiction");
    const temporalized = classifyConflictCandidate(pair(
      "The final PR deadline is Friday at 5 PM.",
      "The final PR deadline is Monday at 10 AM, not Friday.",
      { leftTimestamp: "2026-01-01T00:00:00.000Z", rightTimestamp: "2026-02-01T00:00:00.000Z" },
    ), { preferTemporalUpdate: true });
    expect(temporalized.kind).toBe("temporal_update");
    expect(temporalized.newerTargetId).toBe("right");
  });

  it("Hermes live vs Hermes not invoked live IS a direct contradiction", () => {
    expect(classifyConflictCandidate(pair(
      "Hermes is live in the Ask AI path.",
      "Hermes is not invoked in the live Ask AI path.",
    )).kind).toBe("direct_contradiction");
  });

  it("'should be used' vs 'should not be used' (canonical fixture) still contradicts", () => {
    expect(classifyConflictCandidate(pair(
      "Manual review should be used for processing.",
      "Manual review should not be used for processing.",
    )).kind).toBe("direct_contradiction");
  });
});

describe("end-to-end: activation gate + recalibration no longer hold the false-positive pair", () => {
  const now = () => new Date("2026-07-02T12:00:00.000Z");
  let db: SqliteDatabase;
  beforeEach(() => { db = openDatabase(":memory:"); });
  afterEach(() => db.close());

  const objectsJson = (objects: unknown[]) => JSON.stringify({ objects });
  const llmExtractorFor = (build: (spanId: string, text: string) => unknown[]): MemoryExtractor =>
    createLlmMemoryExtractor(new MockLlmProvider({
      completion: (req) => {
        const m = req.prompt.match(/\[span_id=(\S+) speaker=[^\]]*\]\n([^\n]+)/);
        return { provider: "mock", model: "mock", text: objectsJson(build(m?.[1] ?? "unknown", m?.[2] ?? "")), finishReason: "stop" };
      },
    }));

  async function seedActiveDisposableNotes(): Promise<void> {
    const transcriptId = importTranscript(db, { filename: "notes.txt", rawText: "Alex: Raw transcripts should be immutable. Generated notes are only a disposable Obsidian view layer.", sourceType: "test" }).transcriptId;
    await extractMemoryObjectsForTranscript(db, {
      transcriptId,
      extractor: llmExtractorFor((id, text) => [{ type: "objection", title: "Raw Transcripts and Generated Notes", body: "Raw transcripts should be immutable. Generated notes are only a disposable Obsidian view layer.", evidenceSpanIds: [id], supportingQuote: text }]),
    });
    await indexTranscriptForRetrieval(db, transcriptId);
  }

  it("findConflictingActiveMemory returns null for the compatible API-key privacy statement", async () => {
    await seedActiveDisposableNotes();
    expect((db.prepare("SELECT COUNT(*) c FROM memory_objects WHERE extraction_status='active'").get() as { c: number }).c).toBe(1);
    const match = findConflictingActiveMemory(db, {
      title: "API key visibility",
      body: "The app should never display real API keys in Settings or generated notes.",
      evidenceSpans: [],
    });
    expect(match).toBeNull();
  });

  it("the API-key memory now auto-activates alongside the notes memory (no false conflict hold)", async () => {
    await seedActiveDisposableNotes();
    const transcriptId = importTranscript(db, { filename: "keys.txt", rawText: "Sam: The app should never display real API keys in Settings or generated notes.", sourceType: "test" }).transcriptId;
    await extractMemoryObjectsForTranscript(db, {
      transcriptId,
      extractor: llmExtractorFor((id, text) => [{ type: "decision", title: "API key visibility", body: "The app should never display real API keys in Settings or generated notes.", evidenceSpanIds: [id], supportingQuote: text }]),
    });
    const statuses = db.prepare("SELECT extraction_status s, COUNT(*) c FROM memory_objects GROUP BY 1").all() as Array<{ s: string; c: number }>;
    expect(Object.fromEntries(statuses.map((row) => [row.s, row.c]))).toEqual({ active: 2 });
    // And live detection persists NO conflict record for the compatible pair.
    expect((db.prepare("SELECT COUNT(*) c FROM conflict_assessments").get() as { c: number }).c).toBe(0);
  });

  it("recalibration promotes an item previously stuck by the false conflict (all other gates pass)", async () => {
    await seedActiveDisposableNotes();
    const transcriptId = importTranscript(db, { filename: "keys.txt", rawText: "Sam: The app should never display real API keys in Settings or generated notes.", sourceType: "test" }).transcriptId;
    await extractMemoryObjectsForTranscript(db, {
      transcriptId,
      extractor: llmExtractorFor((id, text) => [{ type: "decision", title: "API key visibility", body: "The app should never display real API keys in Settings or generated notes.", evidenceSpanIds: [id], supportingQuote: text }]),
    });
    const memoryId = (db.prepare("SELECT id FROM memory_objects ORDER BY created_at DESC LIMIT 1").get() as { id: string }).id;
    // Simulate the OLD false-positive hold: needs_review with the conflict reason persisted.
    db.prepare("UPDATE memory_objects SET extraction_status='needs_review', status='needs_review', metadata_json=? WHERE id=?")
      .run(JSON.stringify({ review_reason: "Conflicts with an existing active memory — both sides are preserved for review." }), memoryId);
    const api = createSqliteFrontendApi(db, { now });
    const result = await api.recalibrateReviewItems();
    expect(result.promoted).toBe(1); // the tightened classifier no longer blocks it
    expect((db.prepare("SELECT extraction_status s FROM memory_objects WHERE id=?").get(memoryId) as { s: string }).s).toBe("active");
    expect(await api.listReviewItems()).toHaveLength(0);
  });

  it("a REAL opposition is still held by the gate and still resolvable for the Review detail", async () => {
    const transcriptId = importTranscript(db, { filename: "policy.txt", rawText: "Alex: API keys should be displayed in Settings for debugging.", sourceType: "test" }).transcriptId;
    await extractMemoryObjectsForTranscript(db, {
      transcriptId,
      extractor: llmExtractorFor((id, text) => [{ type: "decision", title: "Show API keys for debugging", body: "API keys should be displayed in Settings for debugging.", evidenceSpanIds: [id], supportingQuote: text }]),
    });
    await indexTranscriptForRetrieval(db, transcriptId);
    const opposing = importTranscript(db, { filename: "policy2.txt", rawText: "Sam: API keys should never be displayed in Settings.", sourceType: "test" }).transcriptId;
    await extractMemoryObjectsForTranscript(db, {
      transcriptId: opposing,
      extractor: llmExtractorFor((id, text) => [{ type: "decision", title: "Never show API keys", body: "API keys should never be displayed in Settings.", evidenceSpanIds: [id], supportingQuote: text }]),
    });
    const pending = db.prepare("SELECT id, extraction_status s FROM memory_objects ORDER BY created_at DESC LIMIT 1").get() as { id: string; s: string };
    expect(pending.s).toBe("needs_review"); // real conflict still blocks auto-activation
    const view = await createSqliteFrontendApi(db, { now }).getMemory(pending.id);
    expect(view?.reviewReason).toMatch(/conflicts with an existing active memory/i);
    expect(view?.conflictReview?.active?.title).toBe("Show API keys for debugging"); // both sides shown
  });
});
