import { FileSystemAdapter, Notice, Platform, Plugin } from "obsidian";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDatabase, type SqliteDatabase } from "../db/index.js";
import { validateMigrationPackage } from "../db/migrations/index.js";
import type { FrontendApi } from "../frontend/index.js";
import { createObsidianNavigation } from "./ObsidianNavigation.js";
import { TranscriptMemorySettingsTab } from "./SettingsTab.js";
import { TranscriptMemoryItemView } from "./TranscriptMemoryItemView.js";
import { createObsidianAppApi } from "./services/ObsidianAppApi.js";
import { OBSIDIAN_COMMANDS, OBSIDIAN_RIBBON, OBSIDIAN_VIEW_TYPES, type TranscriptMemoryViewType } from "./pluginTypes.js";
import { createUnavailableFrontendApi, DESKTOP_ONLY_MESSAGE, initialPluginHealth, readableStartupError, startupSupport, type PluginHealth } from "./startup.js";

export default class TranscriptMemoryVaultPlugin extends Plugin {
  private db: SqliteDatabase | null = null;
  private health: PluginHealth = initialPluginHealth();
  private api: FrontendApi = createUnavailableFrontendApi(() => this.health);

  async onload(): Promise<void> {
    const navigation = createObsidianNavigation(this.app);
    for (const type of Object.values(OBSIDIAN_VIEW_TYPES)) {
      this.registerView(type, (leaf) => new TranscriptMemoryItemView(leaf, type as TranscriptMemoryViewType, () => this.api, navigation));
    }
    for (const command of OBSIDIAN_COMMANDS) {
      this.addCommand({ id: command.id, name: command.name, callback: () => void navigationForView(navigation, command.viewType) });
    }
    this.addRibbonIcon(OBSIDIAN_RIBBON.icon, OBSIDIAN_RIBBON.title, () => void navigation.openDashboard());
    this.addSettingTab(new TranscriptMemorySettingsTab(this.app, this, () => this.health, navigation));

    const adapter = this.app.vault.adapter;
    const fileSystemAdapter = adapter instanceof FileSystemAdapter ? adapter : null;
    const support = startupSupport({ isDesktopApp: Platform.isDesktopApp, hasLocalFilesystem: fileSystemAdapter != null });
    if (!support.supported) {
      this.health = { ...this.health, status: "unsupported", lastInitializationError: support.message };
      new Notice(DESKTOP_ONLY_MESSAGE);
      console.error("Transcript Memory Vault unsupported environment:", support.message);
      return;
    }

    const pluginDirectory = join(fileSystemAdapter!.getBasePath(), this.app.vault.configDir, "plugins", this.manifest.id);
    const databasePath = join(pluginDirectory, "transcript-memory.sqlite");
    const runtime = globalThis as typeof globalThis & {
      __TRANSCRIPT_MEMORY_MIGRATION_DIR__?: string;
      __TRANSCRIPT_MEMORY_NATIVE_BINDING__?: string;
    };
    runtime.__TRANSCRIPT_MEMORY_MIGRATION_DIR__ = join(pluginDirectory, "migrations");
    runtime.__TRANSCRIPT_MEMORY_NATIVE_BINDING__ = join(pluginDirectory, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
    this.health = { ...this.health, databasePath };
    try {
      mkdirSync(pluginDirectory, { recursive: true });
      const migrationPackage = validateMigrationPackage(join(pluginDirectory, "migrations"));
      if (!migrationPackage.ok) throw new Error(`Missing packaged migrations: ${migrationPackage.missing.join(", ")}`);
      const firstRun = !existsSync(databasePath);
      this.db = openDatabase(databasePath);
      const appliedMigrationCount = (this.db.prepare("SELECT COUNT(*) count FROM schema_migrations").get() as { count: number }).count;
      this.health = {
        ...this.health, status: "ready", databaseConnected: true, migrationStatus: "current", appliedMigrationCount,
        realSqliteStorage: true, firstRun, lastInitializationError: null,
      };
      this.api = createObsidianAppApi(this.db, this.app.vault, this.health);
      if (firstRun) new Notice("Transcript Memory Vault is ready. Upload a transcript to begin.");
    } catch (error) {
      this.db?.close();
      this.db = null;
      const message = readableStartupError(error);
      this.health = { ...this.health, status: "error", databaseConnected: false, migrationStatus: "failed", realSqliteStorage: false, lastInitializationError: message };
      this.api = createUnavailableFrontendApi(() => this.health);
      new Notice(`Transcript Memory Vault could not initialize: ${message}`);
      console.error("Transcript Memory Vault initialization failed", error);
    }
  }

  onunload(): void {
    for (const type of Object.values(OBSIDIAN_VIEW_TYPES)) this.app.workspace.detachLeavesOfType(type);
    this.db?.close();
    this.db = null;
    this.api = createUnavailableFrontendApi(() => this.health);
  }
}

function navigationForView(navigation: ReturnType<typeof createObsidianNavigation>, viewType: TranscriptMemoryViewType): Promise<void> {
  if (viewType === OBSIDIAN_VIEW_TYPES.upload) return navigation.openUpload();
  if (viewType === OBSIDIAN_VIEW_TYPES.ask) return navigation.openAskAI();
  if (viewType === OBSIDIAN_VIEW_TYPES.search) return navigation.openSearch();
  if (viewType === OBSIDIAN_VIEW_TYPES.graph) return navigation.openGraph();
  if (viewType === OBSIDIAN_VIEW_TYPES.review) return navigation.openReviewQueue();
  return navigation.openDashboard();
}
