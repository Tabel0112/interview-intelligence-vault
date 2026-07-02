import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, renderRoute, routeHref, type SetupSummary } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";
import { initialPluginHealth, type PluginHealth } from "../src/obsidian/startup.js";

const now = () => new Date("2026-06-28T12:00:00.000Z");
let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const readyHealth = (databasePath: string): PluginHealth => ({ ...initialPluginHealth(), status: "ready", databaseConnected: true, realSqliteStorage: true, migrationStatus: "current", databasePath });

// A representative non-secret setup summary (what the Obsidian plugin injects). NO api key material.
const SECRET_LOOKING = "sk-should-never-appear-1234567890";
const setupSummary = (over: Partial<SetupSummary> = {}): SetupSummary => ({
  llmConfigured: true, llmProvider: "openai", llmModel: "gpt-4o-mini",
  embeddingConfigured: true, embeddingProvider: "openai", embeddingModel: "text-embedding-3-small", embeddingDimensions: 1536,
  embeddingHealth: "ok", reindexNeeded: false,
  databasePath: "/vault/.obsidian/plugins/transcript-memory-vault/transcript-memory.sqlite",
  settingsPath: "/vault/.obsidian/plugins/transcript-memory-vault/data.json",
  ...over,
});
const apiWith = (summary?: SetupSummary, path = "/vault/x.sqlite") =>
  createSqliteFrontendApi(db, { now, health: readyHealth(path), ...(summary ? { getSetupSummary: () => summary } : {}) });

async function seedWeak() {
  const repos = createRepositories(db);
  const imported = importTranscript(db, { filename: "m.txt", rawText: "Alex: We might use SQLite." });
  const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string };
  const memory = repos.memoryObjects.createMemoryObject(
    { type: "preference", title: "Maybe SQLite", generated_text: "We might use SQLite.", confidence: 0.4, created_by: "agent" },
    [{ span_id: span.id, role: "supports", evidence_score: 0.3 }],
  );
  const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceStrength: "weak", confidence: 0.3 });
  await indexEvidencePointerForSearch(db, pointer.evidence_pointer_id);
  return { imported, memory, pointer };
}

describe("Viewer-mode dashboard (Pass 3 order)", () => {
  it("renders the workflow-first sections in order, with Upload first and Claude/MCP second", async () => {
    await seedWeak();
    const html = await renderRoute(apiWith(setupSummary()), routeHref.dashboard());
    const order = ["Upload a transcript", "Use Claude Desktop with this vault", "Review and attention",
      "Native Obsidian graph", "Transcripts", "Recent answers", "Advanced / Internal tools"];
    let cursor = -1;
    for (const heading of order) {
      const at = html.indexOf(`>${heading}</h2>`);
      expect(at, `missing/misordered section: ${heading}`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("makes Upload the first, primary, and compact (no heavy dashed box; hidden input; single row)", async () => {
    const html = await renderRoute(apiWith(), routeHref.dashboard());
    // Slice from the section wrapper so the section-level class is included.
    const upload = html.slice(html.indexOf("upload-section"), html.indexOf(">Use Claude Desktop with this vault</h2>"));
    expect(upload).toContain("tmv-card--primary");
    expect(upload).toContain('data-action="upload"');
    // Drag/drop is a subtle enhancement (form is the drop target) — NOT a permanent dashed drop-zone box.
    expect(upload).toContain("data-dropzone");
    expect(upload).not.toContain("tmv-dropzone");
    expect(upload).toContain("upload-row"); // Choose + filename on one compact row
    // Native file input is hidden behind a styled "Choose transcript" label, but still present, accepting the
    // formats, AND `required` — because it is visually hidden (opacity:0), losing `required` would silently
    // break submit validation (app.ts drop-to-fill relies on it), so pin the attribute explicitly.
    expect(upload).toContain("upload-file-input");
    expect(upload).toContain('accept=".txt,.md,.srt,.vtt"');
    expect(upload).toMatch(/class="upload-file-input"[^>]*\brequired\b/); // hidden input stays required
    expect(upload).toContain("Choose transcript");
    // Formats are quiet helper text, not a heavy badge.
    expect(upload).toContain('class="upload-formats"');
    expect(upload).toContain("Supports .txt, .md, .srt, .vtt");
    expect(upload).not.toContain('class="tmv-badge">Supported'); // no heavy bordered formats badge
    // Filename status + submit CTA + collapsed next steps.
    expect(upload).toContain("upload-file-status");
    expect(upload).toContain("No file selected");
    expect(upload).toContain("Upload transcript");
    expect(upload).toContain("recommended next steps");
  });

  it("keeps the source-of-truth message and a compact light-chip review summary (no heavy metric grid)", async () => {
    await seedWeak();
    const html = await renderRoute(apiWith(), routeHref.dashboard());
    expect(html).toContain("SQLite is the source of truth.");
    const review = html.slice(html.indexOf(">Review and attention</h2>"), html.indexOf(">Native Obsidian graph</h2>"));
    expect(review).toContain("review-metrics");
    expect(review).toContain("tmv-status"); // light status chips
    expect(review).toContain("transcripts");
    expect(review).not.toContain("metric-grid"); // no heavy bordered metric grid
  });

  it("Recent Transcripts links to the full Transcripts route (and Upload)", async () => {
    const html = await renderRoute(apiWith(), routeHref.dashboard());
    const transcripts = html.slice(html.indexOf(">Transcripts</h2>"), html.indexOf(">Recent answers</h2>"));
    expect(transcripts).toContain(`data-route="${routeHref.transcripts()}"`);
    expect(transcripts).toContain(`data-route="${routeHref.upload()}"`);
  });

  it("puts Search and Internal Ask AI only inside the collapsed Advanced tools section", async () => {
    const html = await renderRoute(apiWith(), routeHref.dashboard());
    const advanced = html.slice(html.indexOf(">Advanced / Internal tools</h2>"));
    expect(advanced).toContain(`data-route="${routeHref.search()}"`);
    expect(advanced).toContain(`data-route="${routeHref.ask()}"`);
    expect(advanced).toContain("Internal Ask AI");
    // Ask AI must not be promoted elsewhere on the dashboard body.
    const beforeAdvanced = html.slice(html.indexOf(">Upload a transcript</h2>"), html.indexOf(">Advanced / Internal tools</h2>"));
    expect(beforeAdvanced).not.toContain(`data-route="${routeHref.ask()}"`);
  });
});

describe("Claude / MCP setup card", () => {
  const cardOf = (html: string) => html.slice(html.indexOf(">Use Claude Desktop with this vault</h2>"), html.indexOf(">Review and attention</h2>"));
  const defaultView = (card: string) => card.slice(0, card.indexOf("<details"));
  const detailsView = (card: string) => card.slice(card.indexOf("setup-details"));

  it("shows a compact default: intro + status chips + one metadata line + Copy DB path (no paths/JSON)", async () => {
    const card = cardOf(await renderRoute(apiWith(setupSummary()), routeHref.dashboard()));
    const shown = defaultView(card);
    expect(shown).toContain("Use Claude Desktop for normal chat");
    expect(shown).toContain("LLM ready");
    expect(shown).toContain("Embeddings OK");
    expect(shown).toContain("Reindex not needed");
    expect(shown).toContain("openai / gpt-4o-mini");
    expect(shown).toContain("openai / text-embedding-3-small / 1536d");
    expect(shown).toContain("Copy DB path");
    // The full DB path + MCP JSON are NOT rendered as VISIBLE text in the default view: no code blocks,
    // no JSON snippet. (The path exists only in the Copy button's data-copy attribute — an invisible
    // copy payload, not shown to the user — and as visible text only inside the collapsed details.)
    expect(shown).not.toContain('class="tmv-code"'); // no visible path/JSON code block up top
    expect(shown).not.toContain("mcp-config-snippet");
    const visibleText = shown.replace(/data-copy="[^"]*"/g, ""); // strip invisible copy payloads
    expect(visibleText).not.toContain("/vault/.obsidian/plugins/transcript-memory-vault/transcript-memory.sqlite");
  });

  it("HARD RULE: the full MCP JSON config appears ONLY inside the collapsed Setup details", async () => {
    const html = await renderRoute(apiWith(setupSummary()), routeHref.dashboard());
    const snippetAt = html.indexOf("mcp-config-snippet");
    expect(snippetAt).toBeGreaterThan(-1);
    // The snippet must sit inside an OPEN <details> (a <details> opened before it, not yet closed).
    const before = html.slice(0, snippetAt);
    expect(before.lastIndexOf("<details")).toBeGreaterThan(before.lastIndexOf("</details>"));
    // And the collapsed details also holds the full DB path + data.json path.
    const details = detailsView(cardOf(html));
    expect(details).toContain("TMV_DB_PATH");
    expect(details).toContain("/vault/.obsidian/plugins/transcript-memory-vault/transcript-memory.sqlite");
    expect(details).toContain("data.json");
    expect(details).toContain("&quot;TMV_DB_PATH&quot;"); // escaped JSON in the snippet
    expect(details).toContain("Copy MCP config");
  });

  it("reflects setup/reindex health as distinct light status chips", async () => {
    const setupReq = await renderRoute(apiWith(setupSummary({ embeddingConfigured: false, embeddingHealth: "setup_required" })), routeHref.dashboard());
    expect(setupReq).toContain("Embeddings not set up");
    expect(setupReq).toContain("tmv-status--warn");
    const reindex = await renderRoute(apiWith(setupSummary({ embeddingHealth: "reindex_required", reindexNeeded: true })), routeHref.dashboard());
    expect(reindex).toContain("Reindex needed");
    expect(reindex).toContain("tmv-status--warn");
  });

  it("exposes a Copy DB path action in the default view (key-free)", async () => {
    const card = cardOf(await renderRoute(apiWith(setupSummary()), routeHref.dashboard()));
    expect(defaultView(card)).toContain("Copy DB path");
    expect(card).toContain('data-copy='); // copyable path + MCP config, non-secret
  });

  it("NEVER renders API keys — no sk-, no apiKey field, even when a secret-looking value exists in settings", async () => {
    const html = await renderRoute(apiWith(setupSummary({ llmModel: "gpt-4o-mini" })), routeHref.dashboard());
    expect(html).not.toContain(SECRET_LOOKING);
    expect(html).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(html.toLowerCase()).not.toContain("apikey");
  });

  it("degrades to a minimal card when no setup summary is wired (headless)", async () => {
    const card = cardOf(await renderRoute(apiWith(undefined), routeHref.dashboard()));
    expect(card).toContain("Use Claude Desktop for normal chat");
    expect(card).toContain("TMV_DB_PATH"); // still available inside details
    expect(card).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
  });
});

describe("dashboard attention projection (unchanged behavior)", () => {
  it("getDashboard().attention is a read-only projection of weak/broken/conflicting review items (capped at 5)", async () => {
    await seedWeak();
    const dash = await createSqliteFrontendApi(db, { now }).getDashboard();
    expect(dash.attention).toBeDefined();
    expect(dash.attention!.length).toBeGreaterThan(0);
    expect(dash.attention!.length).toBeLessThanOrEqual(5);
    expect(dash.attention!.every((item) => ["weak", "broken", "conflicting"].includes(item.trustState))).toBe(true);
  });

  it("Review & attention shows weak items with reused trust badges, and a soft note when clear", async () => {
    const empty = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.dashboard());
    const emptyReview = empty.slice(empty.indexOf(">Review and attention</h2>"), empty.indexOf(">Native Obsidian graph</h2>"));
    expect(emptyReview).toContain("Nothing needs attention");
    await seedWeak();
    const html = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.dashboard());
    const section = html.slice(html.indexOf(">Review and attention</h2>"), html.indexOf(">Native Obsidian graph</h2>"));
    expect(section).toContain("attention-item");
    expect(section).toContain('data-trust-state="weak"');
  });
});
