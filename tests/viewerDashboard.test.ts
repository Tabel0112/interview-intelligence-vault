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
    const order = ["Upload a transcript", "Use Claude Desktop with this vault", "Review queue", "Evidence needing attention",
      "Native Obsidian graph", "Transcripts", "Recent answers", "Advanced / Internal tools"];
    let cursor = -1;
    for (const heading of order) {
      const at = html.indexOf(`>${heading}</h2>`);
      expect(at, `missing/misordered section: ${heading}`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("makes Upload the first, primary, and most obvious action (drop-zone + formats + CTA)", async () => {
    const html = await renderRoute(apiWith(), routeHref.dashboard());
    // Slice from the section wrapper so the section-level class is included.
    const upload = html.slice(html.indexOf("upload-section"), html.indexOf(">Use Claude Desktop with this vault</h2>"));
    expect(upload).toContain("tmv-card--primary");
    expect(upload).toContain("tmv-dropzone");
    expect(upload).toContain('data-action="upload"');
    expect(upload).toContain(".txt · .md · .srt · .vtt"); // supported formats
    expect(upload).toContain("Upload transcript"); // CTA
    expect(upload).toContain("recommended next steps"); // post-import guidance
  });

  it("keeps the source-of-truth message and the metric grid", async () => {
    await seedWeak();
    const html = await renderRoute(apiWith(), routeHref.dashboard());
    expect(html).toContain("SQLite is the source of truth.");
    expect(html.slice(html.indexOf(">Review queue</h2>"))).toContain("metric-grid");
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
  it("renders DB path, settings path, LLM + embedding provider/model/dimensions, and health badge", async () => {
    const html = await renderRoute(apiWith(setupSummary()), routeHref.dashboard());
    const card = html.slice(html.indexOf(">Use Claude Desktop with this vault</h2>"), html.indexOf(">Review queue</h2>"));
    expect(card).toContain("Use Claude Desktop for normal chat");
    expect(card).toContain("TMV_DB_PATH");
    expect(card).toContain("/vault/.obsidian/plugins/transcript-memory-vault/transcript-memory.sqlite");
    expect(card).toContain("data.json");
    expect(card).toContain("LLM configured: yes");
    expect(card).toContain("openai / gpt-4o-mini");
    expect(card).toContain("Embeddings configured: yes");
    expect(card).toContain("openai / text-embedding-3-small / 1536d");
    expect(card).toContain('data-trust-state="strong"'); // embedding health ok badge
    expect(card).toContain("Reindex needed: no");
  });

  it("renders setup/reindex health states as distinct badges", async () => {
    const setupReq = html_of(await renderRoute(apiWith(setupSummary({ embeddingConfigured: false, embeddingHealth: "setup_required" })), routeHref.dashboard()));
    expect(setupReq).toContain("embedding: setup_required");
    expect(setupReq).toContain("Embeddings configured: no");
    const reindex = html_of(await renderRoute(apiWith(setupSummary({ embeddingHealth: "reindex_required", reindexNeeded: true })), routeHref.dashboard()));
    expect(reindex).toContain("embedding: reindex_required");
    expect(reindex).toContain("Reindex needed: yes");
  });

  it("provides a copyable, key-free MCP config snippet with TMV_DB_PATH", async () => {
    const html = await renderRoute(apiWith(setupSummary()), routeHref.dashboard());
    const card = html.slice(html.indexOf(">Use Claude Desktop with this vault</h2>"), html.indexOf(">Review queue</h2>"));
    expect(card).toContain("mcp-config-snippet");
    expect(card).toContain("&quot;TMV_DB_PATH&quot;"); // escaped JSON in the snippet
    expect(card).toContain('data-copy='); // copy buttons for path + snippet
  });

  it("NEVER renders API keys — no sk-, no apiKey field, even when a secret-looking value exists in settings", async () => {
    // Even if a summary somehow carried a key-shaped provider string, the card renders only declared fields.
    const html = await renderRoute(apiWith(setupSummary({ llmModel: "gpt-4o-mini" })), routeHref.dashboard());
    expect(html).not.toContain(SECRET_LOOKING);
    expect(html).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(html.toLowerCase()).not.toContain("apikey");
  });

  it("degrades to a minimal card when no setup summary is wired (headless)", async () => {
    const html = await renderRoute(apiWith(undefined), routeHref.dashboard());
    const card = html.slice(html.indexOf(">Use Claude Desktop with this vault</h2>"), html.indexOf(">Review queue</h2>"));
    expect(card).toContain("Use Claude Desktop for normal chat");
    expect(card).toContain("TMV_DB_PATH"); // path still shown from health
    expect(card).not.toMatch(/sk-[A-Za-z0-9]/);
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

  it("Evidence needing attention shows weak items with reused trust badges, and an empty state when clear", async () => {
    const empty = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.dashboard());
    expect(empty.slice(empty.indexOf(">Evidence needing attention</h2>"), empty.indexOf(">Native Obsidian graph</h2>"))).toContain("Nothing needs attention");
    await seedWeak();
    const html = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.dashboard());
    const section = html.slice(html.indexOf(">Evidence needing attention</h2>"), html.indexOf(">Native Obsidian graph</h2>"));
    expect(section).toContain("attention-item");
    expect(section).toContain('data-trust-state="weak"');
  });
});

// small helper so the .slice repetition stays readable
function html_of(html: string): string { return html; }
