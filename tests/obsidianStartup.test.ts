import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { PACKAGED_MIGRATION_COUNT, validateMigrationPackage } from "../src/db/migrations/index.js";
import { createSqliteFrontendApi, renderRoute, type FrontendApi } from "../src/frontend/index.js";
import {
  createUnavailableFrontendApi, DESKTOP_ONLY_MESSAGE, initialPluginHealth, startupSupport, type PluginHealth,
} from "../src/obsidian/startup.js";

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const readyHealth = (overrides: Partial<PluginHealth> = {}): PluginHealth => ({
  ...initialPluginHealth(), status: "ready", databaseConnected: true, migrationStatus: "current",
  appliedMigrationCount: PACKAGED_MIGRATION_COUNT, databasePath: "/vault/.obsidian/plugins/transcript-memory-vault/transcript-memory.sqlite",
  realSqliteStorage: true, firstRun: true, ...overrides,
});

describe("Obsidian startup safety", () => {
  it("accepts supported desktop filesystem environments and exposes connected health", async () => {
    expect(startupSupport({ isDesktopApp: true, hasLocalFilesystem: true })).toEqual({ supported: true });
    const api = createSqliteFrontendApi(db, { health: readyHealth() });
    expect(await api.getDashboard()).toMatchObject({
      health: { status: "ready", databaseConnected: true, migrationStatus: "current", realSqliteStorage: true },
    });
  });

  it("returns a desktop-only state without crashing unsupported environments", async () => {
    expect(startupSupport({ isDesktopApp: false, hasLocalFilesystem: false })).toEqual({ supported: false, message: DESKTOP_ONLY_MESSAGE });
    const health: PluginHealth = { ...initialPluginHealth(), status: "unsupported", lastInitializationError: DESKTOP_ONLY_MESSAGE };
    const html = await renderRoute(createUnavailableFrontendApi(() => health), "mv://dashboard");
    expect(html).toContain(DESKTOP_ONLY_MESSAGE);
    expect(html).toContain('data-trust-state="no_evidence"');
  });

  it("renders readable non-blank view errors when database initialization or adapter calls fail", async () => {
    const error = "SQLite open failed without modifying the existing database";
    const health: PluginHealth = { ...initialPluginHealth(), status: "error", migrationStatus: "failed", lastInitializationError: error };
    const api = createUnavailableFrontendApi(() => health);
    expect(await renderRoute(api, "mv://dashboard")).toContain(error);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const html = await renderRoute(api, "mv://search?q=test");
    expect(html).toContain("could not load this view");
    expect(html).toContain(error);
    expect(html.trim()).not.toBe("");
    log.mockRestore();
  });
});

describe("migration packaging and first-run health", () => {
  it("matches the expected migration package and reports missing packages clearly", async () => {
    const sourceFiles = (await readdir("src/db/migrations")).filter((file) => file.endsWith(".sql"));
    expect(PACKAGED_MIGRATION_COUNT).toBe(sourceFiles.length);
    expect(validateMigrationPackage("src/db/migrations")).toEqual({ ok: true, count: PACKAGED_MIGRATION_COUNT });
    const empty = await mkdtemp(join(tmpdir(), "missing-migrations-"));
    const missing = validateMigrationPackage(empty);
    expect(missing).toMatchObject({ ok: false, count: PACKAGED_MIGRATION_COUNT });
    expect(!missing.ok && missing.missing).toContain("001_initial_schema.sql");
  });

  it("shows first-run setup success, storage location, and migration health on an empty dashboard", async () => {
    const html = await renderRoute(createSqliteFrontendApi(db, { health: readyHealth() }), "mv://dashboard");
    expect(html).toContain("Transcript Memory Vault is ready");
    expect(html).toContain("Imported raw transcript snapshots are immutable");
    expect(html).toContain("Database health");
    expect(html).toContain("database connected");
    expect(html).toContain(`${PACKAGED_MIGRATION_COUNT}`);
    expect(html).toContain("No transcripts");
    const orderedContent = [
      'aria-label="Primary"',
      "<h1>Dashboard</h1>",
      'class="immutable-notice status-banner"',
      'class="vault-section vault-status-section"',
      'class="metric-grid"',
      'class="vault-section database-health-section"',
      'class="vault-section mcp-card"',
      'class="vault-section attention-section"',
      'class="vault-section recent-answers-section"',
      'class="vault-section review-summary-section"',
      'class="vault-section generated-notes-section"',
      'class="vault-section transcripts-section"',
      'class="vault-section search-section"',
    ];
    for (let index = 1; index < orderedContent.length; index += 1) {
      expect(html.indexOf(orderedContent[index])).toBeGreaterThan(html.indexOf(orderedContent[index - 1]));
    }
    expect(html.indexOf("No transcripts")).toBeGreaterThan(html.indexOf('class="vault-section database-health-section"'));
    expect(html.indexOf("No answers")).toBeGreaterThan(html.indexOf('class="vault-section database-health-section"'));
    expect(html).not.toContain('<section class="empty-state"');
  });
});

describe("plugin documentation and build inputs", () => {
  it("documents desktop installation, trust chain, and smoke testing", async () => {
    const docs = await readFile("docs/OBSIDIAN_PLUGIN.md", "utf8");
    const smoke = await readFile("docs/SMOKE_TEST.md", "utf8");
    expect(docs).toContain("Obsidian desktop plugin");
    expect(docs).toContain("AI answer -> citation -> evidence -> exact highlighted transcript span");
    expect(docs).toContain("SQLite is the MVP source of truth");
    expect(smoke).toContain("Open exact transcript evidence");
    for (const path of ["manifest.json", "main.js", "styles.css", "migrations/001_initial_schema.sql"]) {
      expect((await stat(path)).isFile()).toBe(true);
    }
    const native = spawnSync(process.execPath, ["-e", `require(${JSON.stringify(resolve("native/darwin-arm64-abi140/better_sqlite3.node"))})`], { encoding: "utf8" });
    if (process.platform === "darwin" && process.arch === "arm64") {
      if (process.versions.modules === "140") expect(native.status).toBe(0);
      else expect(`${native.stderr}${native.stdout}`).toContain("NODE_MODULE_VERSION 140");
    }
  });
});
