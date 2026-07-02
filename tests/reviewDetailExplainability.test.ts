// The memory detail / Review-and-correct page must EXPLAIN why a needs_review memory is held:
//   - show the specific review reason (not just "not independent strong truth");
//   - show extraction support spans (raw quotes) even with NO citable evidence pointers, clearly labeled
//     as not-yet-citable, WITHOUT creating evidence pointers or promoting the memory;
//   - for conflict-held items, show the opposing active memory side-by-side (or a clear unresolved message).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, renderRoute, routeHref } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { createLlmMemoryExtractor, extractMemoryObjectsForTranscript, type MemoryExtractor } from "../src/memory/extraction/index.js";
import { indexTranscriptForRetrieval } from "../src/retrieval/index.js";
import { MockLlmProvider } from "../src/llm/testing.js";

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
const importLine = (rawText: string) => importTranscript(db, { filename: "detail.txt", rawText, sourceType: "test" }).transcriptId;

/** Extract one memory (title/body/type parameterized) and return its id. */
async function extractOne(line: string, type: string, title: string, body: string): Promise<string> {
  const transcriptId = importLine(line);
  const extractor = llmExtractorFor((id, text) => [{ type, title, body, evidenceSpanIds: [id], supportingQuote: text }]);
  await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
  return (db.prepare("SELECT id FROM memory_objects ORDER BY created_at DESC LIMIT 1").get() as { id: string }).id;
}

describe("needs_review detail shows the specific reason + extraction support spans (no citable evidence)", () => {
  it("tentative memory: detail shows the tentative reason, NOT the generic strong-truth line", async () => {
    const memoryId = await extractOne("Alex: Maybe we should use PostgreSQL instead.", "decision", "Switch to PostgreSQL", "Maybe we should use PostgreSQL instead.");
    const view = await createSqliteFrontendApi(db, { now }).getMemory(memoryId);
    expect(view?.reviewReason).toMatch(/tentative|hedged/i);
    const html = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.memory(memoryId));
    expect(html).toMatch(/not active yet/i);
    expect(html).toMatch(/tentative|hedged/i);
    expect(html).not.toContain("This memory is not independent strong truth");
  });

  it("shows extraction support spans (raw quote + open-span link) with a not-citable label and NO evidence pointers", async () => {
    const memoryId = await extractOne("Alex: Maybe we should use PostgreSQL instead.", "decision", "Switch to PostgreSQL", "Maybe we should use PostgreSQL instead.");
    const api = createSqliteFrontendApi(db, { now });
    const view = await api.getMemory(memoryId);
    // Policy A holds: NO citable evidence pointers were created for a needs_review memory...
    expect(view?.evidence).toHaveLength(0);
    expect((db.prepare("SELECT COUNT(*) c FROM evidence_pointers WHERE target_type='memory_object' AND target_id=?").get(memoryId) as { c: number }).c).toBe(0);
    // ...but the extraction support span is available for display, from memory_object_evidence (not pointers).
    expect(view?.supportSpans.length).toBeGreaterThan(0);
    expect(view?.supportSpans[0].quote).toContain("PostgreSQL");
    const html = await renderRoute(api, routeHref.memory(memoryId));
    expect(html).toContain("Extraction support spans");
    expect(html).toMatch(/not citable evidence until this memory is approved/i);
    expect(html).toContain("Open exact transcript span");
    // Displaying support spans NEVER created a pointer.
    expect((db.prepare("SELECT COUNT(*) c FROM evidence_pointers WHERE target_type='memory_object' AND target_id=?").get(memoryId) as { c: number }).c).toBe(0);
  });

  it("legacy item (no persisted reason) shows the recalibrate fallback, not the generic line", async () => {
    const memoryId = await extractOne("Alex: We decided to use SQLite as the source of truth.", "decision", "Use SQLite as the source of truth", "We decided to use SQLite as the source of truth.");
    // Force back to needs_review with empty metadata (old-build state).
    db.prepare("UPDATE memory_objects SET extraction_status='needs_review', status='needs_review', metadata_json='{}' WHERE id=?").run(memoryId);
    const html = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.memory(memoryId));
    expect(html).toMatch(/not active yet/i);
    expect(html).toMatch(/Recalibrate review items/i);
  });
});

describe("conflict review detail shows the opposing active memory", () => {
  /** Seed an ACTIVE bridged memory, then a directly-opposing pending memory that the conflict gate holds. */
  async function seedConflictPair(): Promise<{ pendingId: string; activeId: string }> {
    const activeTranscript = importLine("Alex: We decided to use SQLite as the source of truth.");
    await extractMemoryObjectsForTranscript(db, { transcriptId: activeTranscript, extractor: llmExtractorFor((id, text) => [{ type: "decision", title: "Use SQLite as the source of truth", body: "We decided to use SQLite as the source of truth.", evidenceSpanIds: [id], supportingQuote: text }]) });
    await indexTranscriptForRetrieval(db, activeTranscript);
    const activeId = (db.prepare("SELECT id FROM memory_objects WHERE extraction_status='active'").get() as { id: string }).id;
    const pendingId = await extractOne("Sam: We decided not to use SQLite as the main data store for this project.", "decision", "Do not rely on SQLite for storage", "We decided not to use SQLite as the main data store for this project.");
    return { pendingId, activeId };
  }

  it("resolves the conflicting active side and renders both memories with source quotes + links", async () => {
    const { pendingId, activeId } = await seedConflictPair();
    const api = createSqliteFrontendApi(db, { now });
    const view = await api.getMemory(pendingId);
    expect(view?.reviewReason).toMatch(/conflicts with an existing active memory/i);
    expect(view?.conflictReview).toBeDefined();
    expect(view?.conflictReview?.active?.memoryId).toBe(activeId);
    expect(view?.conflictReview?.conflictType).toBeTruthy();
    // No conflict record was created just to display the comparison (read-only resolution).
    expect((db.prepare("SELECT COUNT(*) c FROM conflict_assessments").get() as { c: number }).c).toBe(0);

    const html = await renderRoute(api, routeHref.memory(pendingId));
    expect(html).toContain("Conflict — both sides preserved");
    expect(html).toContain("pending memory");
    expect(html).toContain("active memory");
    expect(html).toContain("Do not rely on SQLite for storage"); // pending body
    expect(html).toContain("Use SQLite as the source of truth");  // active body
    expect(html).toContain(routeHref.memory(activeId));           // link to the active memory
    expect(html).toMatch(/Conflict type:/);
    // The page never shows ONLY the bare list message.
    expect(html).not.toMatch(/^Conflicts with an existing active memory\.$/);
  });

  it("falls back to a clear unresolved message when the active side cannot be resolved", async () => {
    const { pendingId, activeId } = await seedConflictPair();
    // Remove the active memory's opposition text so the classifier can no longer match it, while the
    // pending memory's persisted review reason still says it conflicts (stale-reason case).
    db.prepare("UPDATE memory_objects SET generated_text='An unrelated note about scheduling.', title='Scheduling note' WHERE id=?").run(activeId);
    const api = createSqliteFrontendApi(db, { now });
    const view = await api.getMemory(pendingId);
    expect(view?.conflictReview).toBeDefined();
    expect(view?.conflictReview?.active).toBeNull();
    const html = await renderRoute(api, routeHref.memory(pendingId));
    expect(html).toMatch(/Conflicting active memory could not be resolved/i);
    expect(html).toContain(routeHref.review("conflict"));
  });
});

describe("Policy A + approve/reject workflow are unchanged and safe", () => {
  it("active memory with linked evidence pointers renders normally (no support-span/conflict sections, no needs-review reason)", async () => {
    const transcriptId = importLine("Alex: We decided to use SQLite as the source of truth.");
    await extractMemoryObjectsForTranscript(db, { transcriptId, extractor: llmExtractorFor((id, text) => [{ type: "decision", title: "Use SQLite as the source of truth", body: "We decided to use SQLite as the source of truth.", evidenceSpanIds: [id], supportingQuote: text }]) });
    await indexTranscriptForRetrieval(db, transcriptId);
    const activeId = (db.prepare("SELECT id FROM memory_objects WHERE extraction_status='active'").get() as { id: string }).id;
    const api = createSqliteFrontendApi(db, { now });
    const view = await api.getMemory(activeId);
    expect(view?.trustState).toBe("strong");
    expect(view?.evidence.length).toBeGreaterThan(0);
    expect(view?.reviewReason).toBeUndefined();
    expect(view?.conflictReview).toBeUndefined();
    const html = await renderRoute(api, routeHref.memory(activeId));
    expect(html).not.toContain("Extraction support spans");
    expect(html).not.toContain("Needs review:");
    expect(html).toContain("Open exact transcript span"); // real citable evidence clickback
  });

  it("approve promotes a needs_review memory to active + citable evidence; support-span display did not pre-create it", async () => {
    const memoryId = await extractOne("Alex: We decided to use SQLite as the source of truth.", "decision", "Use SQLite as the source of truth", "We decided to use SQLite as the source of truth.");
    db.prepare("UPDATE memory_objects SET extraction_status='needs_review', status='needs_review' WHERE id=?").run(memoryId);
    const api = createSqliteFrontendApi(db, { now });
    await api.getMemory(memoryId); // render/read the detail (support spans) first
    expect((db.prepare("SELECT COUNT(*) c FROM evidence_pointers WHERE target_id=?").get(memoryId) as { c: number }).c).toBe(0); // reading did NOT create pointers
    const decision = await api.reviewMemoryObject(memoryId, "approve");
    expect(decision.status).toBe("approved");
    expect((db.prepare("SELECT extraction_status s FROM memory_objects WHERE id=?").get(memoryId) as { s: string }).s).toBe("active");
    expect((db.prepare("SELECT COUNT(*) c FROM evidence_pointers WHERE target_id=?").get(memoryId) as { c: number }).c).toBeGreaterThan(0); // now citable
  });

  it("renders no raw API key / secret on the memory detail page", async () => {
    const memoryId = await extractOne("Alex: Maybe we should store the sk-not-a-real-key note.", "decision", "Store note", "Maybe we should store the note.");
    const html = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.memory(memoryId));
    expect(html).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(html.toLowerCase()).not.toContain("apikey");
  });
});
