import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, renderRoute, routeHref } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";
import { initialPluginHealth, type PluginHealth } from "../src/obsidian/startup.js";

const now = () => new Date("2026-06-28T12:00:00.000Z");
let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const readyHealth = (databasePath: string): PluginHealth => ({ ...initialPluginHealth(), status: "ready", databaseConnected: true, realSqliteStorage: true, migrationStatus: "current", databasePath });

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

describe("Viewer-mode dashboard", () => {
  it("getDashboard().attention is a read-only projection of weak/broken/conflicting review items (capped at 5)", async () => {
    await seedWeak();
    const dash = await createSqliteFrontendApi(db, { now }).getDashboard();
    expect(dash.attention).toBeDefined();
    expect(dash.attention!.length).toBeGreaterThan(0);
    expect(dash.attention!.length).toBeLessThanOrEqual(5);
    expect(dash.attention!.every((item) => ["weak", "broken", "conflicting"].includes(item.trustState))).toBe(true);
  });

  it("renders every viewer-first dashboard section and the source-of-truth message", async () => {
    await seedWeak();
    const html = await renderRoute(createSqliteFrontendApi(db, { now, health: readyHealth("/vault/x.sqlite") }), routeHref.dashboard());
    for (const heading of ["Vault status", "Use Claude Desktop (MCP)", "Evidence needing attention", "Recent answers", "Review queue / conflicts", "Native Obsidian graph", "Transcripts", "Search vault"]) {
      expect(html, `missing section: ${heading}`).toContain(`>${heading}</h2>`);
    }
    expect(html).toContain("SQLite is the source of truth.");
  });

  it("the Claude Desktop / MCP card shows this vault's databasePath as TMV_DB_PATH", async () => {
    const path = "/vault/.obsidian/plugins/transcript-memory-vault/transcript-memory.sqlite";
    const html = await renderRoute(createSqliteFrontendApi(db, { now, health: readyHealth(path) }), routeHref.dashboard());
    const card = html.slice(html.indexOf("Use Claude Desktop (MCP)"), html.indexOf("Evidence needing attention"));
    expect(card).toContain("TMV_DB_PATH");
    expect(card).toContain(path);
  });

  it("Evidence needing attention shows weak items with reused trust badges, and an empty state when clear", async () => {
    const empty = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.dashboard());
    expect(empty.slice(empty.indexOf("Evidence needing attention"), empty.indexOf("Recent answers"))).toContain("Nothing needs attention");

    await seedWeak();
    const html = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.dashboard());
    const section = html.slice(html.indexOf("Evidence needing attention"), html.indexOf("Recent answers"));
    expect(section).toContain("attention-item");
    expect(section).toContain('data-trust-state="weak"'); // reuses the existing trust-badge presentation
  });

  it("Review queue / conflicts section links to the review queue", async () => {
    const html = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.dashboard());
    const section = html.slice(html.indexOf("Review queue / conflicts"), html.indexOf("Native Obsidian graph"));
    expect(section).toContain(`data-route="${routeHref.reviewQueue()}"`);
  });

  it("Transcripts section offers Upload as a secondary action; Search section links to Search", async () => {
    const html = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.dashboard());
    const transcripts = html.slice(html.indexOf(">Transcripts</h2>"), html.indexOf(">Search vault</h2>"));
    expect(transcripts).toContain(`data-route="${routeHref.upload()}"`);
    expect(html.slice(html.indexOf(">Search vault</h2>"))).toContain(`data-route="${routeHref.search()}"`);
  });

  it("Ask AI page keeps the Claude Desktop banner, stays functional, and is not called legacy/local", async () => {
    const html = await renderRoute(createSqliteFrontendApi(db, { now }), routeHref.ask());
    expect(html).toContain("Claude Desktop (via MCP) is the recommended chat UI");
    expect(html).toContain("same evidence-grounded, LLM-required pipeline");
    expect(html).toContain('data-action="ask"'); // the Ask AI form is still present and usable
    expect(html.toLowerCase()).not.toContain("legacy");
    expect(html.toLowerCase()).not.toContain("local ask ai");
  });
});
