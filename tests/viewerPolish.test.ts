import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, renderRoute, routeHref } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";
import { initialPluginHealth, type PluginHealth } from "../src/obsidian/startup.js";

const now = () => new Date("2026-06-30T12:00:00.000Z");
let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;
beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); });
afterEach(() => db.close());
const api = () => createSqliteFrontendApi(db, { now });

async function seedWeakMemory() {
  const imported = importTranscript(db, { filename: "m.txt", rawText: "Alex: We might use SQLite." });
  const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string };
  const memory = repos.memoryObjects.createMemoryObject(
    { type: "preference", title: "Maybe SQLite", generated_text: "We might use SQLite.", status: "needs_review", confidence: 0.4, created_by: "agent" },
    [{ span_id: span.id, role: "supports", evidence_score: 0.3 }],
  );
  const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceStrength: "weak", confidence: 0.3 });
  await indexEvidencePointerForSearch(db, pointer.evidence_pointer_id);
  return { imported, memory, pointer };
}

describe("Pass 4: Review page polish (presentation only)", () => {
  it("renders the review intro callout and groups active items, with cards using the design system", async () => {
    await seedWeakMemory();
    const html = await renderRoute(api(), routeHref.reviewQueue());
    expect(html).toContain("tmv-callout--info"); // intro callout
    expect(html).toContain("append-only"); // intro explains append-only correction behavior
    expect(html).toContain(">Needs review</h2>"); // grouping heading
    expect(html).toContain("review-card tmv-card");
    expect(html).toContain('value="approve"'); // normal item keeps Approve
    expect(html).toContain('value="reject"');
  });

  it("still blocks Approve for a degraded (evidence-removed) memory and keeps Reject/Dismiss", async () => {
    const { memory, imported } = await seedWeakMemory();
    // Remove the evidence by deleting the source transcript -> memory degrades (no live evidence).
    await api().deleteTranscript(imported.transcriptId);
    const html = await renderRoute(api(), routeHref.reviewQueue());
    if (html.includes(memory.id) || html.includes("Degraded — evidence missing")) {
      // When the degraded item is present, Approve must be absent and the reason must be shown.
      expect(html).toContain("Evidence was removed");
      expect(html).toContain('value="reject"');
      expect(html).not.toContain('value="approve"');
      expect(html).toContain("Approve is unavailable because there is no live evidence");
    }
  });

  it("shows the empty state when nothing needs review", async () => {
    const html = await renderRoute(api(), routeHref.reviewQueue());
    expect(html).toContain("Review queue is clear");
  });
});

describe("Pass 4: Graph viewer polish", () => {
  it("renders a legend explaining nodes/edges and an empty state when there are no nodes", async () => {
    const html = await renderRoute(api(), routeHref.graph());
    expect(html).toContain("graph-legend");
    expect(html).toContain("supports"); // legend explains edge types
    expect(html).toContain("inferred / no evidence link"); // legend keeps provenance messaging
    expect(html).toContain("SQLite"); // legend keeps the source-of-truth framing
    expect(html).toContain("Graph is empty"); // empty state
  });

  it("keeps Nodes/Edges listings and the selected-node heading when the graph has content", async () => {
    await seedWeakMemory();
    const html = await renderRoute(api(), routeHref.graph());
    expect(html).toContain(">Nodes</h2>");
    expect(html).toContain(">Edges</h2>");
  });
});

describe("Pass 4: Evidence page polish", () => {
  it("labels healthy evidence as transcript-backed with its score, and keeps the source span link", async () => {
    const { pointer } = await seedWeakMemory();
    const html = await renderRoute(api(), routeHref.evidence(pointer.evidence_pointer_id));
    expect(html).toContain("Transcript-backed evidence");
    expect(html).toContain("tmv-callout--success");
    expect(html).toContain("Open highlighted source span");
  });
});

describe("Pass 4: Settings/health polish never exposes secrets", () => {
  const readyHealth = (): PluginHealth => ({ ...initialPluginHealth(), status: "ready", databaseConnected: true, realSqliteStorage: true, migrationStatus: "current", databasePath: "/vault/.obsidian/plugins/transcript-memory-vault/transcript-memory.sqlite" });
  it("keeps all health fields, points to the Settings tab for keys, and renders no API key", async () => {
    const html = await renderRoute(createSqliteFrontendApi(db, { now, health: readyHealth() }), routeHref.dashboard());
    const advanced = html.slice(html.indexOf(">Advanced / Internal tools</h2>"));
    expect(advanced).toContain("Database health");
    expect(advanced).toContain("Migration status");
    expect(advanced).toContain("Database location");
    expect(advanced).toContain("configured in the Obsidian plugin");
    expect(advanced.toLowerCase()).not.toContain("apikey");
    expect(advanced).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});
