import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askAI, createDatabaseAskAIDependencies, persistAskAIResponse, understandQuestion, type AskAIResponse } from "../src/ask-ai/index.js";
import { createConflictRepository } from "../src/conflicts/index.js";
import { NotFoundError, createRepositories, createTranscriptsRepo, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, mountObsidianUi, renderRoute, routeHref, type ObsidianNavigation } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { generateObsidianVault } from "../src/obsidian/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";

const fixedNow = () => new Date("2026-06-12T12:00:00.000Z");

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

function spans(transcriptId: string) {
  return db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? ORDER BY span_index").all(transcriptId) as Array<{ id: string }>;
}
const memoryStatus = (id: string) => db.prepare("SELECT status FROM memory_objects WHERE id=?").get(id) as { status: string } | undefined;

// A transcript carrying the full derived chain: memory + memory_object_evidence (NULL transcript_id, the legacy
// createMemoryObject path), an evidence_pointer, evidence_items, ai_answer_citations, an ask_ai run + run-evidence.
function seedFullTranscript() {
  const repos = createRepositories(db);
  const imported = importTranscript(db, { filename: "Decision.txt", rawText: "Alex: We decided to use SQLite as the source of truth for the vault." });
  const span = spans(imported.transcriptId)[0];
  const memory = repos.memoryObjects.createMemoryObject(
    { type: "decision", generated_text: "SQLite is authoritative.", confidence: 0.95, created_by: "agent" },
    [{ span_id: span.id, role: "supports", evidence_score: 0.95 }],
  );
  const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceStrength: "strong", confidence: 0.9 });
  const ptr = pointer.evidence_pointer_id;
  const response: AskAIResponse = {
    id: "ask_del_1", question: "What is the source of truth?",
    answerMarkdown: `The source of truth is SQLite. [1](mv://evidence/${ptr})`,
    evidenceConfidence: "strong", notEnoughEvidence: false, createdAt: "2026-06-12T00:00:00.000Z",
    queryUnderstanding: understandQuestion("What is the source of truth?"), conflicts: [], suggestedFollowups: [],
    synthesis: { mode: "external_llm", provider: "openai", model: "gpt-x", usedFallback: false },
    evidence: [{
      evidencePointerId: ptr, sourcePointerId: pointer.source_pointer_uri, transcriptId: imported.transcriptId, spanId: span.id,
      quotePreview: "Alex: We decided to use SQLite as the source of truth for the vault.", evidenceScore: 0.9, evidenceConfidence: "strong",
      scoringExplanation: "single supporting span", clickbackUri: `mv://evidence/${ptr}`, stance: "supports", sourceKind: "memory_object_with_pointers",
    }],
    claims: [{ id: "aiclaim_del", kind: "fact", text: "The source of truth is SQLite.", supportStatus: "supported", evidencePointerIds: [ptr], citationIds: ["aic_del"] }],
    citations: [{ id: "aic_del", label: "[1]", evidencePointerId: ptr, sourcePointerId: pointer.source_pointer_uri, transcriptId: imported.transcriptId, spanId: span.id, quotePreview: "SQLite", clickbackUri: `mv://evidence/${ptr}` }],
  };
  persistAskAIResponse(db, response);
  // Guarantee a legacy ai_answer_citations row pointing at an evidence_item for this span (the
  // RESTRICT chain the delete must clear first). evidence_items were created in the answer's bundle.
  const item = db.prepare("SELECT id FROM evidence_items WHERE span_id=?").get(span.id) as { id: string };
  repos.answers.addCitation(response.id, item.id);
  return { transcriptId: imported.transcriptId, spanId: span.id, memoryId: memory.id, evidencePointerId: ptr, answerId: response.id };
}

describe("deleteTranscript backend (transactional hard delete)", () => {
  it("removes the full derived chain (evidence items, legacy citations, run-evidence) with no FK errors", () => {
    const seed = seedFullTranscript();
    const repo = createTranscriptsRepo(db);

    // Pre-conditions: the derived rows exist and the answer/run reference this transcript.
    expect(db.prepare("SELECT COUNT(*) c FROM evidence_items WHERE span_id=?").get(seed.spanId)).toEqual({ c: 1 });
    expect((db.prepare("SELECT COUNT(*) c FROM ai_answer_citations").get() as { c: number }).c).toBeGreaterThan(0);
    expect(db.prepare("SELECT COUNT(*) c FROM ask_ai_run_evidence WHERE transcript_id=?").get(seed.transcriptId)).toEqual({ c: 1 });

    const summary = repo.deleteTranscript(seed.transcriptId);

    expect(summary).toMatchObject({ deletedTranscriptId: seed.transcriptId, spansDeleted: 1, evidenceItemsDeleted: 1, memoryEvidenceLinksDeleted: 1, answersAffected: 1 });
    expect(summary.evidencePointersDeleted).toBeGreaterThanOrEqual(1);
    // Transcript, spans, and span-scoped derived rows are gone.
    expect(db.prepare("SELECT 1 FROM transcripts WHERE id=?").get(seed.transcriptId)).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) c FROM transcript_spans WHERE transcript_id=?").get(seed.transcriptId)).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM evidence_items WHERE span_id=?").get(seed.spanId)).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM ai_answer_citations").get()).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM evidence_pointers WHERE transcript_id=?").get(seed.transcriptId)).toEqual({ c: 0 });
    expect(db.prepare("SELECT COUNT(*) c FROM ask_ai_run_evidence WHERE transcript_id=?").get(seed.transcriptId)).toEqual({ c: 0 });
    // The answer and run survive (degraded — they simply lost their run-evidence linkage). They are not deleted.
    expect(db.prepare("SELECT 1 FROM ai_answers WHERE id=?").get(seed.answerId)).toMatchObject({ 1: 1 });
    expect(db.prepare("SELECT 1 FROM ask_ai_runs WHERE id=?").get(seed.answerId)).toMatchObject({ 1: 1 });
  });

  it("downgrades a transcript-only memory to needs_review instead of deleting it (NULL transcript_id link clears cleanly)", () => {
    const seed = seedFullTranscript();
    // memory_object_evidence created via createMemoryObject has a NULL transcript_id (legacy path).
    expect(db.prepare("SELECT transcript_id FROM memory_object_evidence WHERE memory_id=?").get(seed.memoryId)).toEqual({ transcript_id: null });
    expect(memoryStatus(seed.memoryId)?.status).toBe("active");

    const summary = createTranscriptsRepo(db).deleteTranscript(seed.transcriptId);

    expect(summary.memoriesDowngraded).toBe(1);
    const memory = memoryStatus(seed.memoryId);
    expect(memory).toBeDefined(); // the memory object itself is NOT hard-deleted
    expect(memory?.status).toBe("needs_review");
    // It is now evidence-less (its only evidence came from the deleted transcript).
    expect(db.prepare("SELECT COUNT(*) c FROM memory_object_evidence WHERE memory_id=?").get(seed.memoryId)).toEqual({ c: 0 });
  });

  it("keeps a memory active when it still has evidence from another transcript", () => {
    const repos = createRepositories(db);
    const a = importTranscript(db, { filename: "A.txt", rawText: "Alex: SQLite is the source of truth." });
    const b = importTranscript(db, { filename: "B.txt", rawText: "Sam: SQLite is the source of truth too." });
    const spanA = spans(a.transcriptId)[0];
    const spanB = spans(b.transcriptId)[0];
    const memory = repos.memoryObjects.createMemoryObject(
      { type: "decision", generated_text: "SQLite is authoritative.", confidence: 0.95, created_by: "agent" },
      [{ span_id: spanA.id, role: "supports", evidence_score: 0.95 }, { span_id: spanB.id, role: "supports", evidence_score: 0.9 }],
    );

    const summary = createTranscriptsRepo(db).deleteTranscript(a.transcriptId);

    expect(summary.memoriesDowngraded).toBe(0);
    expect(memoryStatus(memory.id)?.status).toBe("active");
    // Only the deleted transcript's evidence link is gone; transcript B's link remains.
    expect(db.prepare("SELECT COUNT(*) c FROM memory_object_evidence WHERE memory_id=?").get(memory.id)).toEqual({ c: 1 });
  });

  it("downgrades (does not delete) a conflict that cited evidence from the deleted transcript", () => {
    const repos = createRepositories(db);
    const imported = importTranscript(db, {
      filename: "conflict.txt",
      rawText: "Alex: Manual review should be used for processing.\nAlex: Manual review should not be used for processing.",
    });
    const [s0, s1] = spans(imported.transcriptId);
    const left = repos.memoryObjects.createMemoryObject({ type: "preference", generated_text: "Manual review should be used for processing.", confidence: 0.9, created_by: "agent" }, [{ span_id: s0.id, role: "supports", evidence_score: 0.9 }]);
    const right = repos.memoryObjects.createMemoryObject({ type: "preference", generated_text: "Manual review should not be used for processing.", confidence: 0.9, created_by: "agent" }, [{ span_id: s1.id, role: "supports", evidence_score: 0.9 }]);
    const leftPtr = linkMemoryObjectToSpan(db, { memoryObjectId: left.id, transcriptId: imported.transcriptId, spanId: s0.id, evidenceStrength: "strong", confidence: 0.9 });
    const rightPtr = linkMemoryObjectToSpan(db, { memoryObjectId: right.id, transcriptId: imported.transcriptId, spanId: s1.id, evidenceStrength: "strong", confidence: 0.9 });
    const conflicts = createConflictRepository(db, { now: fixedNow });
    const conflict = conflicts.createConflictAssessment({ candidate: {
      leftTargetId: left.id, leftTargetType: "memory_object", leftText: left.generated_text, leftEvidenceIds: [leftPtr.evidence_pointer_id],
      rightTargetId: right.id, rightTargetType: "memory_object", rightText: right.generated_text, rightEvidenceIds: [rightPtr.evidence_pointer_id],
      sharedTopics: ["processing"],
    } });
    expect(conflict.status).toBe("active");

    const summary = createTranscriptsRepo(db).deleteTranscript(imported.transcriptId);

    expect(summary.conflictsAffected).toBeGreaterThanOrEqual(1);
    // The assessment is preserved (both sides kept) but downgraded — never silently deleted.
    expect(conflicts.getConflictAssessment(conflict.id)?.status).toBe("needs_review");
  });

  it("throws NotFoundError for an unknown id and changes nothing", () => {
    const seed = seedFullTranscript();
    const before = db.prepare("SELECT COUNT(*) c FROM transcripts").get();
    expect(() => createTranscriptsRepo(db).deleteTranscript("tr_does_not_exist")).toThrow(NotFoundError);
    expect(db.prepare("SELECT COUNT(*) c FROM transcripts").get()).toEqual(before);
    expect(db.prepare("SELECT 1 FROM transcripts WHERE id=?").get(seed.transcriptId)).toBeDefined();
  });

  it("never alters another transcript's raw text or content hash", () => {
    const seed = seedFullTranscript();
    const other = importTranscript(db, { filename: "Other.txt", rawText: "Sam: A separate, untouched transcript." });
    const otherSpan = spans(other.transcriptId)[0];
    const before = {
      hash: (db.prepare("SELECT content_hash FROM transcripts WHERE id=?").get(other.transcriptId) as { content_hash: string }).content_hash,
      text: (db.prepare("SELECT text FROM transcript_spans WHERE id=?").get(otherSpan.id) as { text: string }).text,
    };

    createTranscriptsRepo(db).deleteTranscript(seed.transcriptId);

    expect(db.prepare("SELECT content_hash FROM transcripts WHERE id=?").get(other.transcriptId)).toEqual({ content_hash: before.hash });
    expect(db.prepare("SELECT text FROM transcript_spans WHERE id=?").get(otherSpan.id)).toEqual({ text: before.text });
  });
});

describe("deleteTranscript + generated Markdown self-prune", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "tmv-del-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("removes the deleted transcript's generated notes on the next sync while preserving survivors and user files", async () => {
    const repos = createRepositories(db);
    // Two transcripts: one will be deleted, one must survive in the generated graph.
    const doomed = importTranscript(db, { filename: "Doomed.txt", rawText: "Alex: Use SQLite as the source of truth." });
    const keep = importTranscript(db, { filename: "Keep.txt", rawText: "Sam: Keep this transcript and its notes." });
    const doomedSpan = spans(doomed.transcriptId)[0];
    const keepSpan = spans(keep.transcriptId)[0];
    const doomedMem = repos.memoryObjects.createMemoryObject({ type: "decision", title: "SQLite truth", generated_text: "Use SQLite as the source of truth.", confidence: 0.95, created_by: "agent" }, [{ span_id: doomedSpan.id, role: "supports", evidence_score: 0.95 }]);
    const keepMem = repos.memoryObjects.createMemoryObject({ type: "decision", title: "Keep me", generated_text: "Keep this transcript.", confidence: 0.95, created_by: "agent" }, [{ span_id: keepSpan.id, role: "supports", evidence_score: 0.95 }]);
    const doomedPtr = linkMemoryObjectToSpan(db, { memoryObjectId: doomedMem.id, transcriptId: doomed.transcriptId, spanId: doomedSpan.id, evidenceStrength: "strong", confidence: 0.95 });
    linkMemoryObjectToSpan(db, { memoryObjectId: keepMem.id, transcriptId: keep.transcriptId, spanId: keepSpan.id, evidenceStrength: "strong", confidence: 0.95 });
    await indexEvidencePointerForSearch(db, doomedPtr.evidence_pointer_id);

    // First sync: both transcripts' notes are written.
    const first = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    const doomedNote = first.files.find((f) => f.entityId === doomed.transcriptId && f.logicalType === "transcript_note")!;
    const keepNote = first.files.find((f) => f.entityId === keep.transcriptId && f.logicalType === "transcript_note")!;
    expect(existsSync(join(root, doomedNote.relativePath))).toBe(true);
    expect(existsSync(join(root, keepNote.relativePath))).toBe(true);
    await writeFile(join(root, "My User Note.md"), "keep me", "utf8");

    // Delete the transcript, then re-sync (the delete function itself never touches Markdown).
    createTranscriptsRepo(db).deleteTranscript(doomed.transcriptId);
    const second = await generateObsidianVault(db, { outputRoot: root, cleanBeforeWrite: true, now: fixedNow });

    // The deleted transcript's note is no longer generated and is pruned from disk via the prior manifest.
    expect(second.files.some((f) => f.entityId === doomed.transcriptId)).toBe(false);
    expect(existsSync(join(root, doomedNote.relativePath))).toBe(false);
    // Surviving transcript's note and the untracked user file remain.
    expect(second.files.some((f) => f.entityId === keep.transcriptId && f.logicalType === "transcript_note")).toBe(true);
    expect(existsSync(join(root, keepNote.relativePath))).toBe(true);
    expect(await readFile(join(root, "My User Note.md"), "utf8")).toBe("keep me");
  });
});

describe("deleteTranscript frontend wiring", () => {
  it("renders a confirmation-gated Danger zone on the transcript route", async () => {
    const imported = importTranscript(db, { filename: "Detail.txt", rawText: "Alex: A transcript detail page." });
    const html = await renderRoute(createSqliteFrontendApi(db), routeHref.transcript(imported.transcriptId));
    expect(html).toContain('data-action="delete-transcript"');
    expect(html).toContain("Transcript text cannot be edited");
    expect(html).toContain("This action cannot be undone");
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*required/);
    expect(html).toContain(imported.transcriptId);
  });

  it("frontend api deleteTranscript returns the deletion summary", async () => {
    const imported = importTranscript(db, { filename: "Api.txt", rawText: "Alex: Delete me through the API." });
    const result = await createSqliteFrontendApi(db).deleteTranscript(imported.transcriptId);
    expect(result.status).toBe("deleted");
    expect(result.summary).toMatchObject({ deletedTranscriptId: imported.transcriptId, spansDeleted: 1 });
    expect(db.prepare("SELECT 1 FROM transcripts WHERE id=?").get(imported.transcriptId)).toBeUndefined();
  });

  it("app submit handler deletes, notifies, and navigates to the dashboard", async () => {
    const imported = importTranscript(db, { filename: "Handler.txt", rawText: "Alex: Delete via the app handler." });
    const api = createSqliteFrontendApi(db);
    const navigation = {
      openDashboard: vi.fn(async () => undefined), openUpload: vi.fn(async () => undefined), openTranscript: vi.fn(async () => undefined),
      openAskAI: vi.fn(async () => undefined), openAnswer: vi.fn(async () => undefined), openEvidence: vi.fn(async () => undefined),
      openMemoryObject: vi.fn(async () => undefined), openGraph: vi.fn(async () => undefined), openSearch: vi.fn(async () => undefined), openReviewQueue: vi.fn(async () => undefined),
    } satisfies ObsidianNavigation;
    const notices: string[] = [];

    // A minimal form-shaped host (no jsdom). The dispatched "submit" event's target is the host itself,
    // which app.ts reads as the form; a FormData stub exposes the form's fields.
    const resultEl = { textContent: "", innerHTML: "" };
    const loadingEl = { hidden: true };
    class FormHost extends EventTarget {
      innerHTML = "";
      dataset: { action?: string } = {};
      fields: Record<string, string> = {};
      parentElement = { querySelector: (sel: string) => (sel.includes("data-form-result") ? resultEl : loadingEl) };
      closest() { return null; }
    }
    class FakeFormData {
      constructor(private form: FormHost) {}
      get(name: string) { return this.form.fields[name] ?? null; }
      getAll(name: string) { const v = this.form.fields[name]; return v == null ? [] : [v]; }
    }
    const prevFormData = globalThis.FormData;
    (globalThis as unknown as { FormData: unknown }).FormData = FakeFormData;
    try {
      const host = new FormHost();
      await mountObsidianUi(host as unknown as HTMLElement, api, navigation, routeHref.upload(), undefined, (m) => notices.push(m));
      host.dataset.action = "delete-transcript";
      host.fields = { transcriptId: imported.transcriptId, confirm: "on" };
      host.dispatchEvent(new Event("submit"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      (globalThis as unknown as { FormData: unknown }).FormData = prevFormData;
    }

    expect(db.prepare("SELECT 1 FROM transcripts WHERE id=?").get(imported.transcriptId)).toBeUndefined();
    expect(navigation.openDashboard).toHaveBeenCalledOnce();
    expect(notices.some((m) => m.includes("Transcript deleted"))).toBe(true);
    expect(notices.some((m) => m.includes("Sync generated graph notes"))).toBe(true);
  });
});
