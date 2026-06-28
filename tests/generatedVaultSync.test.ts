import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askAI, createDatabaseAskAIDependencies } from "../src/ask-ai/index.js";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { GENERATED_VAULT_FOLDER, OBSIDIAN_SYNC_GRAPH_COMMAND, generateObsidianVault } from "../src/obsidian/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";
import { createSqliteFrontendApi, renderRoute, type GeneratedSyncResult } from "../src/frontend/index.js";

const fixedNow = () => new Date("2026-06-12T12:00:00.000Z");
const read = (root: string, path: string) => readFile(join(root, path), "utf8");

let db: SqliteDatabase;
let root: string;
beforeEach(async () => { db = openDatabase(":memory:"); root = await mkdtemp(join(tmpdir(), "tmv-sync-")); });
afterEach(async () => { db.close(); await rm(root, { recursive: true, force: true }); });

// Seed a transcript + strong/weak memory + evidence + a (deterministic, offline) answer so notes have links.
async function seed() {
  const imported = importTranscript(db, { filename: "Meeting.txt", rawText: "Alex: Use SQLite as the source of truth.\nAlex: Maybe avoid SQLite." });
  const spans = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? ORDER BY ordinal").all(imported.transcriptId) as Array<{ id: string }>;
  const repos = createRepositories(db);
  const strong = repos.memoryObjects.createMemoryObject({ type: "decision", title: "SQLite truth", generated_text: "Use SQLite as the source of truth.", confidence: 0.95, created_by: "agent" }, [{ span_id: spans[0].id, role: "supports", evidence_score: 0.95 }]);
  const weak = repos.memoryObjects.createMemoryObject({ type: "preference", title: "Maybe avoid", generated_text: "Maybe avoid SQLite.", confidence: 0.4, created_by: "agent" }, [{ span_id: spans[1].id, role: "qualifies", evidence_score: 0.3 }]);
  const strongPtr = linkMemoryObjectToSpan(db, { memoryObjectId: strong.id, transcriptId: imported.transcriptId, spanId: spans[0].id, evidenceStrength: "strong", confidence: 0.95 });
  const weakPtr = linkMemoryObjectToSpan(db, { memoryObjectId: weak.id, transcriptId: imported.transcriptId, spanId: spans[1].id, evidenceStrength: "weak", confidence: 0.3 });
  await indexEvidencePointerForSearch(db, strongPtr.evidence_pointer_id);
  const answer = await askAI({ question: "SQLite source of truth" }, createDatabaseAskAIDependencies(db, { now: fixedNow }));
  return { imported, spans, strong, weak, strongPtr, weakPtr, answer };
}

describe("Generated Obsidian graph sync (Phase 3 wiring)", () => {
  it("exposes a manual sync command id/name and a clearly-named generated folder", () => {
    expect(OBSIDIAN_SYNC_GRAPH_COMMAND).toEqual({ id: "sync-generated-graph-notes", name: "Sync generated graph notes" });
    expect(GENERATED_VAULT_FOLDER).toBe("Transcript Memory Vault");
  });

  it("writes home, manifest, and generation log into the generated folder and records a run", async () => {
    await seed();
    const result = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    expect(result.errors).toEqual([]);
    expect(await read(root, "00 Home.md")).toContain("database is the source of truth");
    expect(JSON.parse(await read(root, "_system/view-manifest.json"))).toMatchObject({ generatedFrom: "sqlite" });
    expect(await read(root, "_system/generation-log.md")).toContain("SQLite remains the source of truth");
    expect(db.prepare("SELECT COUNT(*) c FROM obsidian_view_runs").get()).toEqual({ c: 1 });
  });

  it("emits wiki links between transcript/evidence/memory/answer notes so the native graph has edges", async () => {
    const data = await seed();
    await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    // memory -> evidence and memory -> transcript span (native graph edges, not just mv:// text)
    const memoryFile = `Memories/Decisions/SQLite truth--${data.strong.id}.md`;
    const memory = await read(root, memoryFile);
    expect(memory).toContain(`[[Evidence/${data.strongPtr.evidence_pointer_id}`);
    expect(memory).toContain("[[Transcripts/");
    // evidence -> transcript span
    expect(await read(root, `Evidence/${data.strongPtr.evidence_pointer_id}.md`)).toContain("[[Transcripts/");
    // home note links the section/graph notes together
    expect(await read(root, "00 Home.md")).toContain("[[Graphs/Source Evidence Graph");
    // answer note exists and carries claim-level citations (links into the graph)
    const answerNote = await read(root, `Answers/${data.answer.id}.md`);
    expect(answerNote).toContain("Claim-Level Citations");
  });

  it("preserves weak/broken evidence warnings in generated notes", async () => {
    const data = await seed();
    // Break the strong pointer's source hash AFTER seeding so its evidence note must warn.
    db.prepare("UPDATE source_pointers SET span_text_sha256='broken' WHERE pointer_uri=?").run(data.strongPtr.source_pointer_uri);
    const result = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    expect(result.warnings.some((w) => w.startsWith(`Broken evidence pointer ${data.strongPtr.evidence_pointer_id}`))).toBe(true);
    expect(await read(root, `Evidence/${data.strongPtr.evidence_pointer_id}.md`)).toContain("Broken evidence pointer");
    expect(await read(root, `Memories/Preferences/Maybe avoid--${data.weak.id}.md`)).toContain("Weak or review-only evidence");
  });

  it("dashboard reports never-synced before, and last-synced status after a sync", async () => {
    await seed();
    const api = createSqliteFrontendApi(db);
    expect((await api.getDashboard()).generatedSync).toEqual({ synced: false });
    const result = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    const status = (await api.getDashboard()).generatedSync;
    expect(status).toMatchObject({ synced: true, lastSyncedAt: "2026-06-12T12:00:00.000Z", status: "completed", graphNodeCount: result.graphNodeCount });
    expect(status?.fileCount).toBeGreaterThan(0);
  });

  it("dashboard render shows the sync button and the never-synced/last-synced status", async () => {
    await seed();
    const api = createSqliteFrontendApi(db);
    const before = await renderRoute(api, "mv://dashboard");
    expect(before).toContain('data-action="sync-graph"');
    expect(before).toContain("Sync Obsidian graph notes");
    expect(before).toContain("native (ribbon) graph"); // explains what the notes power
    expect(before).toContain("Never synced");
    await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    const after = await renderRoute(api, "mv://dashboard");
    expect(after).toContain("Last synced 2026-06-12T12:00:00.000Z");
    expect(after).not.toContain("Never synced");
  });

  it("syncGeneratedGraphNotes delegates to the injected writer; unavailable without injection", async () => {
    await seed();
    // No injection (headless/MCP): a clear unavailable result, never a crash.
    const headless = createSqliteFrontendApi(db);
    expect(await headless.syncGeneratedGraphNotes?.()).toMatchObject({ status: "unavailable" });

    // Injected writer (as the plugin wires it) is invoked and its summary is returned verbatim.
    let invoked = 0;
    const wired = createSqliteFrontendApi(db, {
      syncGeneratedViews: async () => {
        invoked += 1;
        const r = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
        return { status: "synced", filesWritten: r.filesWritten, filesSkipped: r.filesSkipped, graphNodeCount: r.graphNodeCount, graphEdgeCount: r.graphEdgeCount, warnings: r.warnings, errors: r.errors } satisfies GeneratedSyncResult;
      },
    });
    const out = await wired.syncGeneratedGraphNotes?.();
    expect(invoked).toBe(1);
    expect(out).toMatchObject({ status: "synced" });
    expect((out as { graphNodeCount: number }).graphNodeCount).toBeGreaterThan(0);
  });

  it("is deterministic and never writes secrets into generated notes", async () => {
    await seed();
    const first = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    // A user edit to a generated note is overwritten (Markdown is never read back as truth).
    const second = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    expect(second.contentHash).toBe(first.contentHash);
    const dump = first.files.map((f) => f.content).join("\n");
    for (const forbidden of ["Bearer ", "Authorization", "sk-", "api_key", "apiKey", "TMV_LLM_API_KEY"]) {
      expect(dump).not.toContain(forbidden);
    }
  });

  it("cleanBeforeWrite removes only previously-generated files and preserves user files", async () => {
    await seed();
    await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    await writeFile(join(root, "My User Note.md"), "Keep me.", "utf8");
    await generateObsidianVault(db, { outputRoot: root, cleanBeforeWrite: true, now: fixedNow });
    expect(await read(root, "My User Note.md")).toBe("Keep me.");
    expect(await read(root, "00 Home.md")).toContain("Memory Vault");
  });
});
