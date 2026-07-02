import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, renderRoute, routeHref } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexTranscriptForRetrieval } from "../src/retrieval/index.js";
import { initialPluginHealth, type PluginHealth } from "../src/obsidian/startup.js";
import { embeddingReindexStatus } from "../src/obsidian/embeddingSettings.js";
import { setApiKey, type TranscriptMemorySettings } from "../src/obsidian/settings.js";
import { ViewRefreshRegistry } from "../src/obsidian/viewRefreshRegistry.js";

const now = () => new Date("2026-07-01T12:00:00.000Z");
let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const readyHealth = (over: Partial<PluginHealth> = {}): PluginHealth => ({
  ...initialPluginHealth(), status: "ready", databaseConnected: true, realSqliteStorage: true,
  migrationStatus: "current", databasePath: "/vault/x.sqlite", ...over,
});

describe("dashboard health is LIVE, not startup-frozen (Pass E)", () => {
  it("getDashboard reflects the current health via getHealth, including changes after construction", async () => {
    // Mutable live health the plugin would own; getHealth returns the CURRENT object each render.
    let live: PluginHealth = readyHealth({ migrationStatus: "pending", firstRun: true });
    const api = createSqliteFrontendApi(db, { now, getHealth: () => live });

    // Banner-specific phrasing (the empty-transcripts state also says "Upload a transcript to begin.",
    // so key the firstRun assertion on the banner's unique lead-in).
    const FIRST_RUN_BANNER = "to begin. Imported raw transcript snapshots";
    const before = await renderRoute(api, routeHref.dashboard());
    expect(before).toContain("pending"); // startup-time migration status
    expect(before).toContain(FIRST_RUN_BANNER); // firstRun banner present

    // Underlying state advances AFTER the api was constructed (e.g. migrations complete, first-run clears).
    live = readyHealth({ migrationStatus: "current", firstRun: false });
    const after = await renderRoute(api, routeHref.dashboard());
    expect(after).toContain("current"); // live value, not the frozen "pending"
    expect(after).not.toContain(FIRST_RUN_BANNER); // firstRun banner cleared (live)
  });

  it("falls back to the static health snapshot when no getHealth getter is provided (back-compat)", async () => {
    const api = createSqliteFrontendApi(db, { now, health: readyHealth({ migrationStatus: "current" }) });
    expect(await renderRoute(api, routeHref.dashboard())).toContain("current");
  });

  it("renders no API key / secret in the health or setup surfaces", async () => {
    const api = createSqliteFrontendApi(db, { now, getHealth: () => readyHealth() });
    const html = await renderRoute(api, routeHref.dashboard());
    expect(html).not.toMatch(/sk-[A-Za-z0-9]{16,}/);
    expect(html.toLowerCase()).not.toContain("apikey");
  });
});

describe("ViewRefreshRegistry runs a pre-refresh (reindex/health) hook on every mutation (Pass E)", () => {
  it("invokes beforeNotify once before refreshing views", async () => {
    const order: string[] = [];
    const registry = new ViewRefreshRegistry(() => { order.push("beforeNotify"); });
    registry.register({ refresh: () => { order.push("refresh"); } });
    await registry.notifyMutation();
    expect(order).toEqual(["beforeNotify", "refresh"]);
  });

  it("still refreshes views if beforeNotify throws (best-effort, never blocks refresh)", async () => {
    const refreshed = vi.fn();
    const registry = new ViewRefreshRegistry(() => { throw new Error("reindex read failed"); });
    registry.register({ refresh: refreshed });
    await expect(registry.notifyMutation()).resolves.toBeUndefined();
    expect(refreshed).toHaveBeenCalledOnce();
  });

  it("works with no hook (back-compat)", async () => {
    const refreshed = vi.fn();
    const registry = new ViewRefreshRegistry();
    registry.register({ refresh: refreshed });
    await registry.notifyMutation();
    expect(refreshed).toHaveBeenCalledOnce();
  });
});

describe("embedding reindex status is stale->required after new documents, ready after (Pass E) — the fact the hook surfaces", () => {
  const externalSettings = (): TranscriptMemorySettings => setApiKey({
    schemaVersion: 1, mode: "external", llm: { provider: "openai", model: "gpt-4o-mini" },
    embedding: { provider: "openai", model: "text-embedding-3-small", dimensions: 8 }, apiKeys: {},
  }, "openai", "sk-live-health-PLANTED-1234567890");

  async function seedIndexedMemory() {
    const repos = createRepositories(db);
    const imported = importTranscript(db, { filename: "t.txt", rawText: "Alex: We use SQLite as the source of truth." });
    const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? LIMIT 1").get(imported.transcriptId) as { id: string };
    const memory = repos.memoryObjects.createMemoryObject(
      { type: "decision", title: "Use SQLite", generated_text: "We use SQLite as the source of truth.", confidence: 0.95, created_by: "agent" },
      [{ span_id: span.id, role: "supports", evidence_score: 0.95 }],
    );
    linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceStrength: "strong", confidence: 0.95 });
    await indexTranscriptForRetrieval(db, imported.transcriptId); // creates retrieval_documents, no external embeddings
  }

  it("reports needsReindex once documents exist but are not embedded under the configured provider", async () => {
    const settings = externalSettings();
    // Empty vault: nothing to embed yet -> not a reindex-required state driven by missing docs.
    expect(embeddingReindexStatus(db, settings).assessment.needsReindex).toBe(false);
    // After an upload/extraction bridged + locally indexed documents (no external embeddings built),
    // the status the mutation hook recomputes now reports reindex is needed.
    await seedIndexedMemory();
    const assessment = embeddingReindexStatus(db, settings).assessment;
    expect(assessment.needsReindex).toBe(true);
    expect(assessment.reasons.join(" ")).toMatch(/not embedded under the active space/i);
  });
});
