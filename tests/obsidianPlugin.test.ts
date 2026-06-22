import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { askAI, createDatabaseAskAIDependencies } from "../src/ask-ai/index.js";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, isInternalNavigationTarget, mountObsidianUi, navigateInternal, renderRoute, routeHref, type ObsidianNavigation } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { createObsidianNavigation } from "../src/obsidian/ObsidianNavigation.js";
import { OBSIDIAN_COMMANDS, OBSIDIAN_RIBBON, OBSIDIAN_VIEW_TYPES } from "../src/obsidian/pluginTypes.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";

const now = () => new Date("2026-06-13T12:00:00.000Z");
let db: SqliteDatabase;

beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

async function fixture() {
  const repos = createRepositories(db);
  const imported = importTranscript(db, { filename: "obsidian.txt", rawText: "Alex: SQLite is the source of truth." });
  const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string };
  const memory = repos.memoryObjects.createMemoryObject(
    { type: "decision", generated_text: "SQLite is authoritative.", confidence: 0.95, created_by: "agent" },
    [{ span_id: span.id, role: "supports", evidence_score: 0.95 }],
  );
  const pointer = linkMemoryObjectToSpan(db, {
    memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id,
    evidenceRole: "support", evidenceStrength: "strong", confidence: 0.95,
  });
  await indexEvidencePointerForSearch(db, pointer.evidence_pointer_id);
  return { imported, span, pointer };
}

describe("Obsidian plugin registration contract", () => {
  it("declares all required views, commands, and dashboard ribbon action", () => {
    expect(Object.values(OBSIDIAN_VIEW_TYPES)).toEqual([
      "transcript-memory-dashboard", "transcript-memory-upload", "transcript-memory-transcript", "transcript-memory-ask",
      "transcript-memory-answer", "transcript-memory-evidence", "transcript-memory-memory-object", "transcript-memory-graph",
      "transcript-memory-search", "transcript-memory-review",
    ]);
    expect(OBSIDIAN_COMMANDS.map((command) => command.name)).toEqual([
      "Open Transcript Memory Dashboard", "Upload Transcript", "Ask AI About Transcripts",
      "Search Transcript Memory Vault", "Open Memory Graph", "Open Review Queue",
    ]);
    expect(OBSIDIAN_RIBBON).toEqual({ icon: "database", title: "Open Transcript Memory Dashboard" });
  });

  it("opens requested workspace views with internal state, not browser routes", async () => {
    const setViewState = vi.fn(async () => undefined);
    const leaf = { setViewState } as unknown as WorkspaceLeaf;
    const revealLeaf = vi.fn();
    const navigation = createObsidianNavigation({ workspace: { getLeaf: () => leaf, revealLeaf } } as never);
    await navigation.openEvidence("evp_1");
    expect(setViewState).toHaveBeenCalledWith({
      type: OBSIDIAN_VIEW_TYPES.evidence, active: true, state: { target: "mv://evidence/evp_1" },
    });
    expect(revealLeaf).toHaveBeenCalledWith(leaf);
  });
});

describe("Obsidian internal provenance navigation", () => {
  it("renders keyboard-accessible nav and quick actions with explicit internal route handlers", async () => {
    const html = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.dashboard());
    for (const target of [
      routeHref.upload(), routeHref.ask(), routeHref.search(), routeHref.graph(), routeHref.reviewQueue(),
    ]) {
      expect(html).toContain(`type="button" class="route-action" data-route="${target}"`);
      expect(isInternalNavigationTarget(target)).toBe(true);
    }
    for (const label of ["Upload transcript", "Ask AI", "Search vault", "Open graph", "Review queue"]) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(isInternalNavigationTarget("https://example.com")).toBe(false);
  });

  it("routes every primary navigation action through Obsidian workspace navigation", async () => {
    const navigation = {
      openDashboard: vi.fn(async () => undefined),
      openUpload: vi.fn(async () => undefined),
      openTranscript: vi.fn(async () => undefined),
      openAskAI: vi.fn(async () => undefined),
      openAnswer: vi.fn(async () => undefined),
      openEvidence: vi.fn(async () => undefined),
      openMemoryObject: vi.fn(async () => undefined),
      openGraph: vi.fn(async () => undefined),
      openSearch: vi.fn(async () => undefined),
      openReviewQueue: vi.fn(async () => undefined),
    };
    await navigateInternal(navigation, routeHref.dashboard());
    await navigateInternal(navigation, routeHref.upload());
    await navigateInternal(navigation, routeHref.ask());
    await navigateInternal(navigation, routeHref.search());
    await navigateInternal(navigation, routeHref.graph());
    await navigateInternal(navigation, routeHref.reviewQueue());
    expect(navigation.openDashboard).toHaveBeenCalledOnce();
    expect(navigation.openUpload).toHaveBeenCalledOnce();
    expect(navigation.openAskAI).toHaveBeenCalledOnce();
    expect(navigation.openSearch).toHaveBeenCalledOnce();
    expect(navigation.openGraph).toHaveBeenCalledOnce();
    expect(navigation.openReviewQueue).toHaveBeenCalledOnce();
  });

  it("preserves answer to citation to evidence to exact highlighted transcript span", async () => {
    const seeded = await fixture();
    const api = createSqliteFrontendApi(db, { now });
    const answer = await askAI({ question: "SQLite source truth" }, createDatabaseAskAIDependencies(db, { now }));
    const answerHtml = await renderRoute(api, routeHref.answer(answer.id));
    expect(answerHtml).toContain(`href="${routeHref.evidence(seeded.pointer.evidence_pointer_id)}"`);
    expect(answerHtml).not.toContain('href="/evidence/');

    const evidenceHtml = await renderRoute(api, routeHref.evidence(seeded.pointer.evidence_pointer_id));
    const transcriptTarget = routeHref.transcript(seeded.imported.transcriptId, seeded.span.id);
    expect(evidenceHtml).toContain(transcriptTarget);

    const openTranscript = vi.fn(async () => undefined);
    await navigateInternal({
      openDashboard: async () => undefined, openUpload: async () => undefined, openTranscript,
      openAskAI: async () => undefined, openAnswer: async () => undefined, openEvidence: async () => undefined,
      openMemoryObject: async () => undefined, openGraph: async () => undefined, openSearch: async () => undefined,
      openReviewQueue: async () => undefined,
    }, transcriptTarget);
    expect(openTranscript).toHaveBeenCalledWith(seeded.imported.transcriptId, { spanId: seeded.span.id });
    expect(await renderRoute(api, transcriptTarget)).toContain(`data-selected-span="${seeded.span.id}"`);
  });

  it("keeps broken evidence visible in Obsidian-rendered views", async () => {
    const seeded = await fixture();
    const api = createSqliteFrontendApi(db, { now });
    db.prepare("UPDATE source_pointers SET span_text_sha256='broken' WHERE pointer_uri=?").run(seeded.pointer.source_pointer_uri);
    const html = await renderRoute(api, routeHref.evidence(seeded.pointer.evidence_pointer_id));
    expect(html).toContain('data-trust-state="broken"');
    expect(html).not.toContain("Open exact transcript span");
  });
});

describe("Obsidian UI mount does not stack duplicate listeners", () => {
  // Minimal host backed by Node's built-in EventTarget so addEventListener({ signal }) + dispatchEvent
  // work without jsdom; closest() is stubbed to return the clicked internal-route control.
  class FakeHost extends EventTarget {
    innerHTML = "";
    routeControl: { dataset: { route?: string }; getAttribute: (name: string) => string | null } | null = null;
    closest(selector: string): unknown {
      if (selector.includes("data-copy-quote")) return null;
      if (selector.includes("data-route") || selector.includes("a[href]")) return this.routeControl;
      return null;
    }
  }

  it("opens exactly one view per internal link click after re-mounting the same host", async () => {
    const host = new FakeHost();
    const navigation = {
      openDashboard: vi.fn(async () => undefined), openUpload: vi.fn(async () => undefined),
      openTranscript: vi.fn(async () => undefined), openAskAI: vi.fn(async () => undefined),
      openAnswer: vi.fn(async () => undefined), openEvidence: vi.fn(async () => undefined),
      openMemoryObject: vi.fn(async () => undefined), openGraph: vi.fn(async () => undefined),
      openSearch: vi.fn(async () => undefined), openReviewQueue: vi.fn(async () => undefined),
    } satisfies ObsidianNavigation;
    const api = createSqliteFrontendApi(db); // the upload route renders without DB rows
    const el = host as unknown as HTMLElement;

    // Obsidian re-renders on both onOpen and setState, so the same host is mounted twice.
    await mountObsidianUi(el, api, navigation, "mv://upload");
    await mountObsidianUi(el, api, navigation, "mv://upload");

    host.routeControl = { dataset: { route: "mv://memory/m1" }, getAttribute: () => null };
    host.dispatchEvent(new Event("click"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Without listener de-duplication this would be called twice (two stacked click handlers).
    expect(navigation.openMemoryObject).toHaveBeenCalledTimes(1);
    expect(navigation.openMemoryObject).toHaveBeenCalledWith("m1");
  });
});
