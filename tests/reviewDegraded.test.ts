import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepositories, createTranscriptsRepo, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, mountObsidianUi, renderRoute, routeHref, type FrontendApi, type ObsidianNavigation } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";

let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;
let api: FrontendApi;
beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); api = createSqliteFrontendApi(db); });
afterEach(() => db.close());

const span = (t: string) => (db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? ORDER BY span_index LIMIT 1").get(t) as { id: string }).id;

// A needs_review memory backed only by transcript `t` (bridged to a pointer so it has live evidence).
function seedReviewMemory(file: string, raw: string, title: string) {
  const imported = importTranscript(db, { filename: file, rawText: raw });
  const memory = repos.memoryObjects.createMemoryObject(
    { type: "decision", title, generated_text: `${title}.`, status: "needs_review", confidence: 0.5, created_by: "agent" },
    [{ span_id: span(imported.transcriptId), role: "supports", evidence_score: 0.5 }]);
  linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span(imported.transcriptId), evidenceStrength: "weak", confidence: 0.4 });
  return { transcriptId: imported.transcriptId, memoryId: memory.id };
}
const memItem = async (memoryId: string) => (await api.listReviewItems()).find((i) => i.type === "memory_needs_review" && i.targetId === memoryId);

describe("Review actionability for degraded (evidence-less) memories", () => {
  it("1/2. after deleting its transcript, a C-only memory is a degraded, non-approvable review item", async () => {
    const c = seedReviewMemory("C.txt", "Pat: Maybe avoid SQLite.", "Avoid SQLite");
    expect((await memItem(c.memoryId))).toMatchObject({ hasLiveEvidence: true, canApprove: true, canReject: true });

    createTranscriptsRepo(db).deleteTranscript(c.transcriptId);

    const item = await memItem(c.memoryId);
    expect(item).toBeDefined(); // still visible in Review
    expect(item).toMatchObject({ hasLiveEvidence: false, canApprove: false, canReject: true });
    expect(item!.degradedReason).toContain("Evidence was removed");
    expect(db.prepare("SELECT COUNT(*) c FROM memory_object_evidence WHERE memory_id=?").get(c.memoryId)).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM evidence_pointers WHERE target_id=?").get(c.memoryId)).toEqual({ c: 0 });
  });

  it("3. approve on an evidence-less memory is blocked (cannot_approve) and does NOT change status to active", async () => {
    const c = seedReviewMemory("C.txt", "Pat: Maybe avoid SQLite.", "Avoid SQLite");
    createTranscriptsRepo(db).deleteTranscript(c.transcriptId);
    const result = await api.reviewMemoryObject(c.memoryId, "approve");
    expect(result.status).toBe("cannot_approve");
    expect(result.warning).toContain("Evidence was removed");
    const row = db.prepare("SELECT status, extraction_status, user_corrected FROM memory_objects WHERE id=?").get(c.memoryId) as { status: string; extraction_status: string | null; user_corrected: number };
    expect(row.status).not.toBe("active");
    expect(row.user_corrected).toBe(0); // not promoted, no correction applied
  });

  it("4. reject on an evidence-less memory succeeds and removes it from Review", async () => {
    const c = seedReviewMemory("C.txt", "Pat: Maybe avoid SQLite.", "Avoid SQLite");
    createTranscriptsRepo(db).deleteTranscript(c.transcriptId);
    expect(await api.reviewMemoryObject(c.memoryId, "reject")).toEqual({ status: "rejected" });
    expect((db.prepare("SELECT status FROM memory_objects WHERE id=?").get(c.memoryId) as { status: string }).status).toBe("rejected");
    expect(await memItem(c.memoryId)).toBeUndefined();
  });

  it("5/6. a needs_review memory WITH live evidence stays approvable and approve still works", async () => {
    const m = seedReviewMemory("A.txt", "Alex: We use SQLite as the source of truth.", "Use SQLite");
    expect(await memItem(m.memoryId)).toMatchObject({ hasLiveEvidence: true, canApprove: true });
    expect((await api.reviewMemoryObject(m.memoryId, "approve")).status).toBe("approved");
    expect((db.prepare("SELECT status, user_corrected FROM memory_objects WHERE id=?").get(m.memoryId) as { status: string; user_corrected: number })).toMatchObject({ status: "active", user_corrected: 1 });
  });

  it("delete-all leaves only degraded, non-approvable (but dismissible) review items", async () => {
    const a = seedReviewMemory("A.txt", "Alex: Use SQLite.", "Use SQLite");
    const b = seedReviewMemory("B.txt", "Sam: Avoid Redis.", "Avoid Redis");
    createTranscriptsRepo(db).deleteTranscript(a.transcriptId);
    createTranscriptsRepo(db).deleteTranscript(b.transcriptId);
    const memoryItems = (await api.listReviewItems()).filter((i) => i.type === "memory_needs_review");
    expect(memoryItems).toHaveLength(2);
    expect(memoryItems.every((i) => i.canApprove === false && i.canReject === true && !!i.degradedReason)).toBe(true);
  });
});

describe("Review rendering for degraded memories", () => {
  it("7/8. an evidence-less review card renders no active Approve, plus Reject and a missing-evidence warning", async () => {
    const c = seedReviewMemory("C.txt", "Pat: Maybe avoid SQLite.", "Avoid SQLite");
    createTranscriptsRepo(db).deleteTranscript(c.transcriptId);
    const html = await renderRoute(api, routeHref.reviewQueue());
    // The degraded card has the warning + a Reject/Dismiss button, but NO approve submit button.
    expect(html).toContain("Evidence was removed");
    expect(html).toContain('value="reject"');
    expect(html).not.toContain('value="approve"');
  });

  it("normal review card still renders Approve and Reject", async () => {
    const m = seedReviewMemory("A.txt", "Alex: Use SQLite.", "Use SQLite");
    const html = await renderRoute(api, routeHref.reviewQueue());
    expect(html).toContain('value="approve"');
    expect(html).toContain('value="reject"');
  });

  it("9. the memory detail page uses the same controls/warning for a degraded memory", async () => {
    const c = seedReviewMemory("C.txt", "Pat: Maybe avoid SQLite.", "Avoid SQLite");
    createTranscriptsRepo(db).deleteTranscript(c.transcriptId);
    const html = await renderRoute(api, routeHref.memory(c.memoryId));
    expect(html).toContain("Evidence was removed");
    expect(html).toContain('value="reject"');
    expect(html).not.toContain('value="approve"');
  });

  it("9b. the memory detail page still shows Approve for a memory with live evidence", async () => {
    const m = seedReviewMemory("A.txt", "Alex: Use SQLite.", "Use SQLite");
    const html = await renderRoute(api, routeHref.memory(m.memoryId));
    expect(html).toContain('value="approve"');
    expect(html).toContain('value="reject"');
  });
});

// The submit handler must read the clicked submit button's value (the Dismiss button is the reject button).
// A minimal form-shaped host (no jsdom): the dispatched submit event carries a `submitter`, and a FormData
// stub honoring the submitter mirrors `new FormData(form, submitter)`.
class FormHost extends EventTarget {
  innerHTML = "";
  dataset: { action?: string } = {};
  fields: Record<string, string> = {};
  parentElement = { querySelector: () => ({ textContent: "", innerHTML: "", hidden: true }) };
  closest() { return null; }
}
class SubmitterFormData {
  constructor(private form: FormHost, private submitter?: { value?: string } | null) {}
  get(name: string) { return name === "decision" ? (this.submitter?.value ?? null) : (this.form.fields[name] ?? null); }
  getAll() { return []; }
}
const navStub = (): ObsidianNavigation => ({
  openDashboard: vi.fn(async () => undefined), openUpload: vi.fn(async () => undefined), openTranscripts: vi.fn(async () => undefined), openTranscript: vi.fn(async () => undefined),
  openAskAI: vi.fn(async () => undefined), openAnswer: vi.fn(async () => undefined), openEvidence: vi.fn(async () => undefined),
  openMemoryObject: vi.fn(async () => undefined), openGraph: vi.fn(async () => undefined), openSearch: vi.fn(async () => undefined), openReviewQueue: vi.fn(async () => undefined),
});

async function clickDecision(memoryId: string, decision: "approve" | "reject") {
  const spy = vi.spyOn(api, "reviewMemoryObject");
  const prev = globalThis.FormData;
  (globalThis as unknown as { FormData: unknown }).FormData = SubmitterFormData;
  try {
    const host = new FormHost();
    await mountObsidianUi(host as unknown as HTMLElement, api, navStub(), routeHref.reviewQueue());
    host.dataset.action = "review";
    host.fields = { memoryId };
    const event = new Event("submit");
    Object.defineProperty(event, "submitter", { value: { value: decision } });
    host.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    (globalThis as unknown as { FormData: unknown }).FormData = prev;
  }
  return spy;
}

describe("Review Dismiss button submits reject (FormData submitter)", () => {
  it("2/3/4/5/6. Dismiss on a degraded memory calls reviewMemoryObject(id, 'reject'), rejecting + removing it", async () => {
    const c = seedReviewMemory("C.txt", "Pat: Maybe avoid SQLite.", "Avoid SQLite");
    createTranscriptsRepo(db).deleteTranscript(c.transcriptId);
    const spy = await clickDecision(c.memoryId, "reject"); // the Dismiss button's value is "reject"
    expect(spy).toHaveBeenCalledWith(c.memoryId, "reject");
    expect((db.prepare("SELECT status FROM memory_objects WHERE id=?").get(c.memoryId) as { status: string }).status).toBe("rejected");
    expect(await memItem(c.memoryId)).toBeUndefined(); // gone from Review
    const html = await renderRoute(api, routeHref.reviewQueue());
    expect(html).not.toContain(c.memoryId);
  });

  it("7. normal Reject still routes to reject (decision read from the submitter, not defaulted to approve)", async () => {
    const m = seedReviewMemory("A.txt", "Alex: Use SQLite.", "Use SQLite");
    const spy = await clickDecision(m.memoryId, "reject");
    expect(spy).toHaveBeenCalledWith(m.memoryId, "reject");
    expect((db.prepare("SELECT status FROM memory_objects WHERE id=?").get(m.memoryId) as { status: string }).status).toBe("rejected");
  });
});
