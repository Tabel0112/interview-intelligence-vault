// The Review Queue card is a clean decision UI: it shows the extracted memory body, a specific reason,
// the source support span (labeled not-citable), a decision helper, clear Approve/Reject labels, both
// sides of a conflict, and hides debug metadata under a disclosure — without weakening trust logic.
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
const llmExtractorFor = (build: (spanId: string, text: string) => unknown[]): MemoryExtractor =>
  createLlmMemoryExtractor(new MockLlmProvider({
    completion: (req) => {
      const m = req.prompt.match(/\[span_id=(\S+) speaker=[^\]]*\]\n([^\n]+)/);
      return { provider: "mock", model: "mock", text: objectsJson(build(m?.[1] ?? "unknown", m?.[2] ?? "")), finishReason: "stop" };
    },
  }));
const importLine = (rawText: string) => importTranscript(db, { filename: "card.txt", rawText, sourceType: "test" }).transcriptId;

async function extractPending(line: string, type: string, title: string, body: string): Promise<string> {
  const transcriptId = importLine(line);
  await extractMemoryObjectsForTranscript(db, { transcriptId, extractor: llmExtractorFor((id, text) => [{ type, title, body, evidenceSpanIds: [id], supportingQuote: text }]) });
  return (db.prepare("SELECT id FROM memory_objects ORDER BY created_at DESC LIMIT 1").get() as { id: string }).id;
}
const reviewHtml = () => renderRoute(createSqliteFrontendApi(db, { now }), routeHref.reviewQueue());

describe("Review card shows the decision content, not a debug dump", () => {
  it("tentative item: body, specific reason, source span (not citable), decision helper, clear buttons", async () => {
    await extractPending("Alex: Maybe we should use PostgreSQL instead.", "decision", "Switch to PostgreSQL", "Maybe we should use PostgreSQL instead.");
    const html = await reviewHtml();
    // Extracted memory body is shown in full, not only the title.
    expect(html).toContain("Extracted memory");
    expect(html).toContain("Maybe we should use PostgreSQL instead.");
    // Specific reason (tentative), under a clear heading.
    expect(html).toContain("Why this needs review");
    expect(html).toMatch(/tentative|hedged/i);
    // Source support span, labeled not-citable, with an open-span clickback.
    expect(html).toContain("Source span used for extraction");
    expect(html).toContain("Not citable until approved");
    expect(html).toContain("Open exact transcript span");
    // Decision helper + renamed buttons.
    expect(html).toMatch(/Approve<\/strong> if this should become active memory/);
    expect(html).toContain("Approve as active memory");
    expect(html).toContain("Reject / do not use");
  });

  it("hides raw debug metadata from the card face (moved under a Details disclosure)", async () => {
    const memoryId = await extractPending("Alex: Maybe we should use PostgreSQL instead.", "decision", "Switch to PostgreSQL", "Maybe we should use PostgreSQL instead.");
    const html = await reviewHtml();
    // The card no longer prints "medium severity · open · memory_needs_review · memory_object:mem_..." on its face.
    const detailsStart = html.indexOf("<details");
    const cardFace = detailsStart >= 0 ? html.slice(0, detailsStart) : html;
    expect(cardFace).not.toContain("severity");
    expect(cardFace).not.toContain(`memory_object:${memoryId}`);
    expect(cardFace).not.toContain("memory_needs_review");
    // ...but it is still available under the disclosure for power users.
    expect(html).toContain("<details");
    expect(html).toContain("severity");
    expect(html).toContain(`memory_object:${memoryId}`);
  });

  it("friendly badge label 'Needs review' instead of the raw enum on the card face", async () => {
    await extractPending("Alex: Maybe we should use PostgreSQL instead.", "decision", "Switch to PostgreSQL", "Maybe we should use PostgreSQL instead.");
    const html = await reviewHtml();
    expect(html).toContain(">Needs review<");
  });
});

describe("Conflict card shows both sides in the card", () => {
  async function seedConflict(): Promise<{ pendingId: string; activeId: string }> {
    const activeT = importLine("Alex: We decided to use SQLite as the source of truth.");
    await extractMemoryObjectsForTranscript(db, { transcriptId: activeT, extractor: llmExtractorFor((id, text) => [{ type: "decision", title: "Use SQLite as the source of truth", body: "We decided to use SQLite as the source of truth.", evidenceSpanIds: [id], supportingQuote: text }]) });
    await indexTranscriptForRetrieval(db, activeT);
    const activeId = (db.prepare("SELECT id FROM memory_objects WHERE extraction_status='active'").get() as { id: string }).id;
    const pendingId = await extractPending("Sam: We decided not to use SQLite as the main data store for this project.", "decision", "Do not rely on SQLite for storage", "We decided not to use SQLite as the main data store for this project.");
    return { pendingId, activeId };
  }

  it("shows the pending side and the active side (title/body + link) directly on the card", async () => {
    const { activeId } = await seedConflict();
    const html = await reviewHtml();
    expect(html).toContain("Conflict — both sides preserved");
    expect(html).toContain("This memory");
    expect(html).toContain("Conflicts with active memory");
    expect(html).toContain("We decided not to use SQLite as the main data store for this project."); // pending body
    expect(html).toContain("Use SQLite as the source of truth"); // active side title/body
    expect(html).toContain(routeHref.memory(activeId)); // link to the active memory — no click-through needed to know the conflict
  });
});

describe("safety and non-regression", () => {
  it("active memory detail page is unchanged (no review-card sections, shows citable evidence + clickback)", async () => {
    const transcriptId = importLine("Alex: We decided to use SQLite as the source of truth.");
    await extractMemoryObjectsForTranscript(db, { transcriptId, extractor: llmExtractorFor((id, text) => [{ type: "decision", title: "Use SQLite as the source of truth", body: "We decided to use SQLite as the source of truth.", evidenceSpanIds: [id], supportingQuote: text }]) });
    await indexTranscriptForRetrieval(db, transcriptId);
    const activeId = (db.prepare("SELECT id FROM memory_objects WHERE extraction_status='active'").get() as { id: string }).id;
    const html = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.memory(activeId));
    expect(html).not.toContain("Why this needs review");
    expect(html).not.toContain("Source span used for extraction");
    expect(html).not.toContain("Not active yet");
    expect(html).toContain("Open exact transcript span"); // real citable evidence clickback still there
  });

  it("approve/reject remain unchanged: needs_review -> active with citable evidence created only on approve", async () => {
    const memoryId = await extractPending("Alex: We decided to use SQLite as the source of truth.", "decision", "Use SQLite as the source of truth", "We decided to use SQLite as the source of truth.");
    db.prepare("UPDATE memory_objects SET extraction_status='needs_review', status='needs_review' WHERE id=?").run(memoryId);
    const api = createSqliteFrontendApi(db, { now });
    await reviewHtml(); // render the redesigned card (reads support spans)
    expect((db.prepare("SELECT COUNT(*) c FROM evidence_pointers WHERE target_id=?").get(memoryId) as { c: number }).c).toBe(0); // rendering created no pointer
    expect((await api.reviewMemoryObject(memoryId, "approve")).status).toBe("approved");
    expect((db.prepare("SELECT extraction_status s FROM memory_objects WHERE id=?").get(memoryId) as { s: string }).s).toBe("active");
    expect((db.prepare("SELECT COUNT(*) c FROM evidence_pointers WHERE target_id=?").get(memoryId) as { c: number }).c).toBeGreaterThan(0);
  });

  it("renders no raw API key / secret on the review queue", async () => {
    await extractPending("Alex: Maybe we should note the sk-not-a-real-key idea.", "decision", "Note idea", "Maybe we should note the idea.");
    const html = await reviewHtml();
    expect(html).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(html.toLowerCase()).not.toContain("apikey");
  });
});
