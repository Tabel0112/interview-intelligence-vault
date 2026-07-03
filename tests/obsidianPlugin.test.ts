import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
import { askAI, createDatabaseAskAIDependencies } from "../src/ask-ai/index.js";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, isInternalNavigationTarget, mountObsidianUi, navigateInternal, refreshTargetAfterAction, renderRoute, routeHref, type ObsidianNavigation } from "../src/frontend/index.js";
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
      "transcript-memory-dashboard", "transcript-memory-upload", "transcript-memory-transcripts", "transcript-memory-transcript", "transcript-memory-ask",
      "transcript-memory-answer", "transcript-memory-answer-trace", "transcript-memory-evidence", "transcript-memory-memory-object", "transcript-memory-graph",
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

  // Regression: the "View trace" button was rendered and matchRoute recognized the route, but the
  // delegated navigation path (navigateInternal) had no answer_trace case and hit `default: throw`,
  // which the click handler's `void navigateInternal(...)` silently swallowed — so nothing opened.
  it("opens the Ask AI trace view via its own view type and target", async () => {
    const setViewState = vi.fn(async () => undefined);
    const leaf = { setViewState } as unknown as WorkspaceLeaf;
    const revealLeaf = vi.fn();
    const navigation = createObsidianNavigation({ workspace: { getLeaf: () => leaf, revealLeaf } } as never);
    await navigation.openAnswerTrace("ask_1");
    expect(setViewState).toHaveBeenCalledWith({
      type: OBSIDIAN_VIEW_TYPES.answerTrace, active: true, state: { target: "mv://answers/ask_1/trace" },
    });
    expect(revealLeaf).toHaveBeenCalledWith(leaf);
  });
});

describe("Obsidian internal provenance navigation", () => {
  it("renders keyboard-accessible viewer nav with the workflow primary and Ask AI demoted to Advanced", async () => {
    const html = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.dashboard());
    for (const target of [routeHref.upload(), routeHref.transcripts(), routeHref.ask(), routeHref.search(), routeHref.graph(), routeHref.reviewQueue()]) {
      expect(html).toContain(`data-route="${target}"`); // every route still reachable from the viewer dashboard/nav
      expect(isInternalNavigationTarget(target)).toBe(true);
    }
    // Viewer-mode primary nav (before the Advanced disclosure) leads with the vault workflow —
    // Upload/Review/Graph/Search/Transcripts — and EXCLUDES the demoted Ask AI.
    const navPrimary = html.slice(html.indexOf('aria-label="Primary"'), html.indexOf('<details class="nav-advanced'));
    for (const target of [routeHref.upload(), routeHref.reviewQueue(), routeHref.graph(), routeHref.search(), routeHref.transcripts()]) {
      expect(navPrimary).toContain(`data-route="${target}"`);
    }
    expect(navPrimary).not.toContain(`data-route="${routeHref.ask()}"`);
    // The Advanced disclosure holds the demoted "Internal Ask AI" (route preserved), NOT Upload.
    const advanced = html.slice(html.indexOf('<details class="nav-advanced'), html.indexOf("</details>"));
    expect(advanced).toContain(`data-route="${routeHref.ask()}"`);
    expect(advanced).toContain("Internal Ask AI");
    expect(advanced).not.toContain(`data-route="${routeHref.upload()}"`);
    expect(isInternalNavigationTarget("https://example.com")).toBe(false);
  });

  it("routes every primary navigation action through Obsidian workspace navigation", async () => {
    const navigation = {
      openDashboard: vi.fn(async () => undefined),
      openUpload: vi.fn(async () => undefined),
      openTranscripts: vi.fn(async () => undefined),
      openTranscript: vi.fn(async () => undefined),
      openAskAI: vi.fn(async () => undefined),
      openAnswer: vi.fn(async () => undefined),
      openAnswerTrace: vi.fn(async () => undefined),
      openEvidence: vi.fn(async () => undefined),
      openMemoryObject: vi.fn(async () => undefined),
      openGraph: vi.fn(async () => undefined),
      openSearch: vi.fn(async () => undefined),
      openReviewQueue: vi.fn(async () => undefined),
    };
    await navigateInternal(navigation, routeHref.dashboard());
    await navigateInternal(navigation, routeHref.upload());
    await navigateInternal(navigation, routeHref.transcripts());
    await navigateInternal(navigation, routeHref.ask());
    await navigateInternal(navigation, routeHref.search());
    await navigateInternal(navigation, routeHref.graph());
    await navigateInternal(navigation, routeHref.reviewQueue());
    // The trace route MUST route through navigateInternal without throwing (the bug: it hit default:throw).
    await navigateInternal(navigation, routeHref.answerTrace("ask_1"));
    // The answer-detail route stays distinct and unaffected.
    await navigateInternal(navigation, routeHref.answer("ask_2"));
    expect(navigation.openDashboard).toHaveBeenCalledOnce();
    expect(navigation.openUpload).toHaveBeenCalledOnce();
    expect(navigation.openTranscripts).toHaveBeenCalledOnce();
    expect(navigation.openAskAI).toHaveBeenCalledOnce();
    expect(navigation.openSearch).toHaveBeenCalledOnce();
    expect(navigation.openGraph).toHaveBeenCalledOnce();
    expect(navigation.openReviewQueue).toHaveBeenCalledOnce();
    expect(navigation.openAnswerTrace).toHaveBeenCalledExactlyOnceWith("ask_1");
    expect(navigation.openAnswer).toHaveBeenCalledExactlyOnceWith("ask_2");
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
      openDashboard: async () => undefined, openUpload: async () => undefined, openTranscripts: async () => undefined, openTranscript,
      openAskAI: async () => undefined, openAnswer: async () => undefined, openAnswerTrace: async () => undefined, openEvidence: async () => undefined,
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
      openTranscripts: vi.fn(async () => undefined), openTranscript: vi.fn(async () => undefined), openAskAI: vi.fn(async () => undefined),
      openAnswer: vi.fn(async () => undefined), openAnswerTrace: vi.fn(async () => undefined), openEvidence: vi.fn(async () => undefined),
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

    // A second click still routes exactly once: handlers are not recreated by repeated renders/clicks.
    host.dispatchEvent(new Event("click"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigation.openMemoryObject).toHaveBeenCalledTimes(2);

    // Regression: a "View trace" click flows through the SAME delegated handler -> navigateInternal ->
    // openAnswerTrace. Before the fix this path threw inside a void-ed promise and opened nothing.
    host.routeControl = { dataset: { route: "mv://answers/ask_1/trace" }, getAttribute: () => null };
    host.dispatchEvent(new Event("click"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigation.openAnswerTrace).toHaveBeenCalledExactlyOnceWith("ask_1");
  });

  it("refreshes the current route after an action, resolving review-detail pages to the queue", () => {
    expect(refreshTargetAfterAction("mv://review")).toBe("mv://review");
    expect(refreshTargetAfterAction("mv://memory/m1")).toBe("mv://memory/m1");
    expect(refreshTargetAfterAction("mv://dashboard")).toBe("mv://dashboard");
    // A resolved review-detail item has nothing to show, so the refresh falls back to the review queue.
    expect(refreshTargetAfterAction("mv://review/memory:m1")).toBe(routeHref.reviewQueue());
    expect(refreshTargetAfterAction(`mv://review/weak:evp_1`)).toBe(routeHref.reviewQueue());
  });
});
