import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askAI, createDatabaseAskAIDependencies } from "../src/ask-ai/index.js";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { GENERATED_VAULT_FOLDER, OBSIDIAN_SYNC_GRAPH_COMMAND, generateObsidianVault, shortId } from "../src/obsidian/index.js";
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
    const result = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    const find = (entityId: string, logicalType: string) => result.files.find((f) => f.entityId === entityId && f.logicalType === logicalType)!;
    // memory -> evidence and memory -> transcript span (native graph edges, not just mv:// text)
    const memory = await read(root, find(data.strong.id, "memory_note").relativePath);
    expect(memory).toContain(`[[Evidence/${shortId(data.strongPtr.evidence_pointer_id)}/`); // wikilink uses the new folder-based path
    expect(memory).toContain("[[Transcripts/");
    // evidence -> transcript span
    expect(await read(root, find(data.strongPtr.evidence_pointer_id, "evidence_note").relativePath)).toContain("[[Transcripts/");
    // home note links the section/graph notes together
    expect(await read(root, "00 Home.md")).toContain("[[Graphs/Source Evidence Graph");
    // answer note exists and carries claim-level citations (links into the graph)
    expect(await read(root, find(data.answer.id, "answer_note").relativePath)).toContain("Claim-Level Citations");
  });

  it("preserves weak/broken evidence warnings in generated notes", async () => {
    const data = await seed();
    // Break the strong pointer's source hash AFTER seeding so its evidence note must warn.
    db.prepare("UPDATE source_pointers SET span_text_sha256='broken' WHERE pointer_uri=?").run(data.strongPtr.source_pointer_uri);
    const result = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    const find = (entityId: string, logicalType: string) => result.files.find((f) => f.entityId === entityId && f.logicalType === logicalType)!;
    expect(result.warnings.some((w) => w.startsWith(`Broken evidence pointer ${data.strongPtr.evidence_pointer_id}`))).toBe(true);
    expect(await read(root, find(data.strongPtr.evidence_pointer_id, "evidence_note").relativePath)).toContain("Broken evidence pointer");
    expect(await read(root, find(data.weak.id, "memory_note").relativePath)).toContain("Weak or review-only evidence");
  });

  it("puts the short id in a parent folder and keeps the filename basename a clean human label", async () => {
    const data = await seed();
    const result = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    const find = (entityId: string, logicalType: string) => result.files.find((f) => f.entityId === entityId && f.logicalType === logicalType)!;
    const basename = (p: string) => p.split("/").pop()!;

    const answer = find(data.answer.id, "answer_note");
    expect(answer.relativePath).toContain(`/${shortId(data.answer.id)}/`); // short id is a PARENT FOLDER
    expect(answer.relativePath).not.toContain(data.answer.id);             // full long id never in the path
    expect(basename(answer.relativePath)).not.toContain(" - ");            // no " - <id>" suffix in the filename
    expect(basename(answer.relativePath)).not.toContain("ask_");           // no id token in the filename basename
    expect(await read(root, answer.relativePath)).toContain(`mv_entity_id: ${JSON.stringify(data.answer.id)}`); // full id in frontmatter

    const evidence = find(data.strongPtr.evidence_pointer_id, "evidence_note");
    expect(evidence.relativePath).toContain(`/${shortId(data.strongPtr.evidence_pointer_id)}/`);
    expect(evidence.relativePath).not.toContain(data.strongPtr.evidence_pointer_id);
    expect(basename(evidence.relativePath)).not.toContain("evp_");
    expect(await read(root, evidence.relativePath)).toContain(data.strongPtr.evidence_pointer_id); // full id preserved in note body/frontmatter

    const memory = find(data.strong.id, "memory_note");
    expect(memory.relativePath).toBe(`Memories/Decisions/${shortId(data.strong.id)}/SQLite truth.md`); // exact folder-based path
    expect(basename(memory.relativePath)).toBe("SQLite truth.md");         // clean human label, no id
    expect(memory.relativePath).not.toContain(data.strong.id);
  });

  it("disambiguates duplicate titles via the short id folder and sanitizes unsafe characters", async () => {
    const data = await seed();
    const repos = createRepositories(db);
    const mk = (gen: string) => repos.memoryObjects.createMemoryObject(
      { type: "decision", title: "A/B: choice?", generated_text: gen, confidence: 0.9, created_by: "agent" },
      [{ span_id: data.spans[0].id, role: "supports", evidence_score: 0.9 }]);
    const a = mk("first"), b = mk("second");
    const result = await generateObsidianVault(db, { outputRoot: root, now: fixedNow });
    const pathOf = (id: string) => result.files.find((f) => f.entityId === id && f.logicalType === "memory_note")!.relativePath;
    const basename = (p: string) => p.split("/").pop()!;
    expect(pathOf(a.id)).not.toBe(pathOf(b.id));                        // identical titles -> distinct files (distinct short-id folders)
    expect(pathOf(a.id)).toContain(`/${shortId(a.id)}/`);              // short id is a parent folder
    expect(pathOf(b.id)).toContain(`/${shortId(b.id)}/`);
    expect(pathOf(a.id)).not.toMatch(/[:?]/);                          // ':' and '?' sanitized out of the whole path
    expect(basename(pathOf(a.id))).toBe("A B choice.md");             // '/' in the title sanitized into the basename, NOT a stray folder
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

  it("first sync removes old-scheme (flat-named) generated files listed in the prior manifest, preserving user files", async () => {
    await seed();
    // Simulate a prior Phase 3.1 sync: an old flat "<title> - <shortId>.md" file + a manifest listing it.
    const oldRel = "Evidence/Some title - evp_oldone.md";
    await mkdir(join(root, "Evidence"), { recursive: true });
    await writeFile(join(root, oldRel), "old generated note", "utf8");
    await mkdir(join(root, "_system"), { recursive: true });
    await writeFile(join(root, "_system/view-manifest.json"), JSON.stringify({ files: [{ relativePath: oldRel }] }), "utf8");
    await writeFile(join(root, "My User Note.md"), "keep", "utf8"); // untracked user file must survive

    await generateObsidianVault(db, { outputRoot: root, cleanBeforeWrite: true, now: fixedNow });

    expect(existsSync(join(root, oldRel))).toBe(false);       // old flat-named file removed via the prior manifest
    expect(await read(root, "My User Note.md")).toBe("keep"); // user file preserved
    expect(existsSync(join(root, "00 Home.md"))).toBe(true);  // new folder-based generation written
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
