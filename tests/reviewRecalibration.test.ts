// High-score items must not sit in Review unexplained:
//  1. bridged evidence pointers carry a score-derived strength (never "unknown" -> WEAK badge/queue flood);
//  2. legacy "unknown" pointers are upgraded by recalibration;
//  3. stale pending memories are re-evaluated against CURRENT gates — promoted only when every trust gate
//     passes, and otherwise labeled with a specific persisted review reason.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, renderRoute, routeHref } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import {
  createLlmMemoryExtractor, extractMemoryObjectsForTranscript, recalibratePendingMemories, type MemoryExtractor,
} from "../src/memory/extraction/index.js";
import { MockLlmProvider } from "../src/llm/testing.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexTranscriptForRetrieval, strengthFromEvidenceScore } from "../src/retrieval/index.js";

const now = () => new Date("2026-07-02T12:00:00.000Z");
let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const objectsJson = (objects: unknown[]) => JSON.stringify({ objects });
function llmExtractorFor(build: (spanId: string, text: string) => unknown[]): MemoryExtractor {
  return createLlmMemoryExtractor(new MockLlmProvider({
    completion: (req) => {
      const m = req.prompt.match(/\[span_id=(\S+) speaker=[^\]]*\]\n([^\n]+)/);
      return { provider: "mock", model: "mock", text: objectsJson(build(m?.[1] ?? "unknown", m?.[2] ?? "")), finishReason: "stop" };
    },
  }));
}

function importLine(rawText: string): string {
  return importTranscript(db, { filename: "recal.txt", rawText, sourceType: "test" }).transcriptId;
}

/** Extract one grounded ACTIVE memory and bridge it (the normal live flow). */
async function seedActiveBridged(): Promise<{ transcriptId: string; memoryId: string }> {
  const transcriptId = importLine("Alex: We decided to use SQLite as the source of truth.");
  const extractor = llmExtractorFor((id, text) => [{ type: "decision", title: "Use SQLite as the source of truth", body: "We decided to use SQLite as the source of truth.", evidenceSpanIds: [id], supportingQuote: text }]);
  await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
  await indexTranscriptForRetrieval(db, transcriptId);
  const memory = db.prepare("SELECT id FROM memory_objects WHERE extraction_status='active'").get() as { id: string };
  return { transcriptId, memoryId: memory.id };
}

describe("bridged evidence strength is derived from the extraction score (no more unknown->WEAK)", () => {
  it("strengthFromEvidenceScore uses the canonical evidence-scoring bands", () => {
    expect(strengthFromEvidenceScore(0.9)).toBe("strong");
    expect(strengthFromEvidenceScore(0.78)).toBe("strong");
    expect(strengthFromEvidenceScore(0.6)).toBe("mixed");
    expect(strengthFromEvidenceScore(0.3)).toBe("weak");
  });

  it("a high-score auto-activated memory bridges STRONG pointers and creates NO weak-evidence review items", async () => {
    await seedActiveBridged();
    const pointers = db.prepare("SELECT evidence_strength s, confidence c FROM evidence_pointers WHERE target_type='memory_object'").all() as Array<{ s: string; c: number }>;
    expect(pointers.length).toBeGreaterThan(0);
    for (const pointer of pointers) {
      expect(pointer.c).toBeGreaterThan(0.78);
      expect(pointer.s).toBe("strong"); // was "unknown" -> rendered WEAK -> flooded Review
    }
    const api = createSqliteFrontendApi(db, { now });
    const review = await api.listReviewItems();
    expect(review.filter((item) => item.type === "weak_evidence")).toHaveLength(0);
    expect(review.filter((item) => item.type === "memory_needs_review")).toHaveLength(0);
    // The evidence detail page shows a consistent badge: STRONG next to the high score, not WEAK.
    const pointerRow = db.prepare("SELECT evidence_pointer_id id FROM evidence_pointers LIMIT 1").get() as { id: string };
    const html = await renderRoute(api, routeHref.evidence(pointerRow.id));
    expect(html).toMatch(/strong/i);
  });

  it("a genuinely weak (low-score) pointer still surfaces as a weak-evidence review item", async () => {
    const { memoryId } = await seedActiveBridged();
    // Different span (pointer ids are stable per target+span, so reuse the ORIGINAL span would be a no-op).
    const otherTranscript = importTranscript(db, { filename: "other.txt", rawText: "Sam: Some loosely related remark about storage.", sourceType: "test" }).transcriptId;
    const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(otherTranscript) as { id: string };
    linkMemoryObjectToSpan(db, { memoryObjectId: memoryId, transcriptId: otherTranscript, spanId: span.id, evidenceStrength: "weak", confidence: 0.3 });
    const review = await createSqliteFrontendApi(db, { now }).listReviewItems();
    expect(review.some((item) => item.type === "weak_evidence")).toBe(true); // weak stays visible — not suppressed
  });
});

describe("recalibratePendingMemories: legacy pointer upgrade", () => {
  it("upgrades old 'unknown'-strength bridged pointers from their extraction evidence score", async () => {
    const { transcriptId, memoryId } = await seedActiveBridged();
    // Simulate a pointer bridged by the OLD code: strength defaulted to "unknown", score carried in confidence.
    db.prepare("UPDATE evidence_pointers SET evidence_strength='unknown' WHERE target_type='memory_object'").run();
    const before = await createSqliteFrontendApi(db, { now }).listReviewItems();
    expect(before.some((item) => item.type === "weak_evidence")).toBe(true); // the reported bug: high-score item in Review
    const result = recalibratePendingMemories(db, { now });
    expect(result.pointersUpgraded).toBeGreaterThan(0);
    const strengths = db.prepare("SELECT DISTINCT evidence_strength s FROM evidence_pointers WHERE target_type='memory_object' AND target_id=?").all(memoryId) as Array<{ s: string }>;
    expect(strengths).toEqual([{ s: "strong" }]);
    const after = await createSqliteFrontendApi(db, { now }).listReviewItems();
    expect(after.some((item) => item.type === "weak_evidence")).toBe(false);
    void transcriptId;
  });
});

describe("recalibratePendingMemories: stale pending memories re-evaluated against current gates", () => {
  /** Store a grounded-LLM memory, then force it back to needs_review with no reason (old-build state). */
  async function seedStalePending(line: string, title: string, body: string): Promise<string> {
    const transcriptId = importLine(line);
    const extractor = llmExtractorFor((id, text) => [{ type: "decision", title, body, evidenceSpanIds: [id], supportingQuote: text }]);
    await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    const memory = db.prepare("SELECT id FROM memory_objects ORDER BY created_at DESC LIMIT 1").get() as { id: string };
    db.prepare("UPDATE memory_objects SET extraction_status='needs_review', status='needs_review', metadata_json='{}' WHERE id=?").run(memory.id);
    return memory.id;
  }

  it("promotes a stale item that passes ALL current gates, bridges it, and empties Review", async () => {
    const memoryId = await seedStalePending("Alex: We decided to use SQLite as the source of truth.", "Use SQLite as the source of truth", "We decided to use SQLite as the source of truth.");
    const api = createSqliteFrontendApi(db, { now });
    // Before: stale item sits in Review with the explicit legacy explanation (not a bare status).
    const before = await api.listReviewItems();
    const stale = before.find((item) => item.type === "memory_needs_review");
    expect(stale?.detail).toMatch(/Recalibrate review items/i);
    const result = await api.recalibrateReviewItems();
    expect(result.promoted).toBe(1);
    expect((db.prepare("SELECT extraction_status s FROM memory_objects WHERE id=?").get(memoryId) as { s: string }).s).toBe("active");
    // Promotion bridged evidence pointers with derived strength; Review is now empty.
    expect((db.prepare("SELECT COUNT(*) c FROM evidence_pointers WHERE target_type='memory_object' AND target_id=?").get(memoryId) as { c: number }).c).toBeGreaterThan(0);
    expect(await api.listReviewItems()).toHaveLength(0);
  });

  it("does NOT promote a tentative stale item; persists + displays the specific reason", async () => {
    const memoryId = await seedStalePending("Alex: Maybe we should use PostgreSQL instead.", "Switch to PostgreSQL", "Maybe we should use PostgreSQL instead.");
    const api = createSqliteFrontendApi(db, { now });
    const result = await api.recalibrateReviewItems();
    expect(result.promoted).toBe(0);
    expect(result.stillPending).toBe(1);
    expect((db.prepare("SELECT extraction_status s FROM memory_objects WHERE id=?").get(memoryId) as { s: string }).s).toBe("needs_review");
    const item = (await api.listReviewItems()).find((entry) => entry.type === "memory_needs_review");
    expect(item?.detail).toMatch(/tentative|hedged/i); // Review now says WHY
  });

  it("does NOT promote a stale item whose body is not supported by its span; reason says so", async () => {
    const memoryId = await seedStalePending("Alex: Generated Markdown is disposable.", "SQLite is the source of truth", "SQLite is the source of truth.");
    // (grounding at extraction anchored the quote, but the BODY is unsupported by the span)
    const result = await createSqliteFrontendApi(db, { now }).recalibrateReviewItems();
    expect(result.promoted).toBe(0);
    const reason = db.prepare("SELECT json_extract(metadata_json,'$.review_reason') r FROM memory_objects WHERE id=?").get(memoryId) as { r: string };
    expect(reason.r).toMatch(/not strongly supported/i);
  });

  it("does NOT promote a stale item that conflicts with an active memory (both sides preserved)", async () => {
    await seedActiveBridged(); // active: "We decided to use SQLite as the source of truth."
    // Direct opposition but dissimilar wording (< near-duplicate threshold), so the CONFLICT gate is the
    // one that holds it — a heavily-similar negation would be held by the duplicate gate instead.
    const memoryId = await seedStalePending("Sam: We decided not to use SQLite as the main data store for this project.", "Do not rely on SQLite for storage", "We decided not to use SQLite as the main data store for this project.");
    const result = await createSqliteFrontendApi(db, { now }).recalibrateReviewItems();
    expect(result.promoted).toBe(0);
    const reason = db.prepare("SELECT json_extract(metadata_json,'$.review_reason') r FROM memory_objects WHERE id=?").get(memoryId) as { r: string };
    expect(reason.r).toMatch(/conflicts with an existing active memory/i);
    expect((db.prepare("SELECT COUNT(*) c FROM memory_objects WHERE extraction_status='active'").get() as { c: number }).c).toBe(1); // original untouched
  });

  it("never promotes a possible-duplicate suggestion (existing duplicate policy holds)", async () => {
    await seedActiveBridged();
    // Extracting a near-identical statement is caught by the PIPELINE's duplicate policy (duplicate_of_id
    // linked to the canonical, needs_review). Recalibration must leave duplicate suggestions alone entirely.
    const memoryId = await seedStalePending("Sam: We decided to use SQLite as the source of truth going forward.", "Use SQLite as the source of truth", "We decided to use SQLite as the source of truth going forward.");
    const row = db.prepare("SELECT duplicate_of_id dup, extraction_status s FROM memory_objects WHERE id=?").get(memoryId) as { dup: string | null; s: string };
    expect(row.dup).not.toBeNull(); // held by the existing duplicate policy at extraction time
    const result = await createSqliteFrontendApi(db, { now }).recalibrateReviewItems();
    expect(result.promoted).toBe(0);
    expect((db.prepare("SELECT extraction_status s FROM memory_objects WHERE id=?").get(memoryId) as { s: string }).s).toBe("needs_review"); // untouched
  });

  it("does NOT promote an item with no live evidence spans; reason explains and approval stays blocked", async () => {
    const memoryId = await seedStalePending("Alex: We decided to use SQLite as the source of truth.", "Use SQLite as the source of truth", "We decided to use SQLite as the source of truth.");
    db.prepare("DELETE FROM memory_object_evidence WHERE memory_id=?").run(memoryId);
    const result = await createSqliteFrontendApi(db, { now }).recalibrateReviewItems();
    expect(result.promoted).toBe(0);
    const reason = db.prepare("SELECT json_extract(metadata_json,'$.review_reason') r FROM memory_objects WHERE id=?").get(memoryId) as { r: string };
    expect(reason.r).toMatch(/no live transcript evidence/i);
  });

  it("never touches human-decided items (user_corrected=1)", async () => {
    const memoryId = await seedStalePending("Alex: We decided to use SQLite as the source of truth.", "Use SQLite as the source of truth", "We decided to use SQLite as the source of truth.");
    db.prepare("UPDATE memory_objects SET user_corrected=1 WHERE id=?").run(memoryId);
    const result = await createSqliteFrontendApi(db, { now }).recalibrateReviewItems();
    expect(result.promoted).toBe(0);
    expect(result.stillPending).toBe(0); // not even re-labeled — human decisions are authoritative
    expect((db.prepare("SELECT extraction_status s, metadata_json m FROM memory_objects WHERE id=?").get(memoryId) as { s: string; m: string }).s).toBe("needs_review");
  });

  it("does NOT promote items from a non-grounded (dev/test) extractor; reason points to re-extraction", async () => {
    const memoryId = await seedStalePending("Alex: We decided to use SQLite as the source of truth.", "Use SQLite as the source of truth", "We decided to use SQLite as the source of truth.");
    db.prepare("UPDATE extraction_runs SET extractor_kind='test'").run();
    const result = await createSqliteFrontendApi(db, { now }).recalibrateReviewItems();
    expect(result.promoted).toBe(0);
    const reason = db.prepare("SELECT json_extract(metadata_json,'$.review_reason') r FROM memory_objects WHERE id=?").get(memoryId) as { r: string };
    expect(reason.r).toMatch(/non-grounded/i);
  });

  it("is idempotent: a second run promotes nothing new and changes nothing", async () => {
    await seedStalePending("Alex: We decided to use SQLite as the source of truth.", "Use SQLite as the source of truth", "We decided to use SQLite as the source of truth.");
    const api = createSqliteFrontendApi(db, { now });
    const first = await api.recalibrateReviewItems();
    expect(first.promoted).toBe(1);
    const second = await api.recalibrateReviewItems();
    expect(second).toMatchObject({ promoted: 0, stillPending: 0, pointersUpgraded: 0 });
  });
});
