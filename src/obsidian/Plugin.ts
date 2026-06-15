import { FileSystemAdapter, Notice, Platform, Plugin } from "obsidian";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDatabase, type SqliteDatabase } from "../db/index.js";
import { validateMigrationPackage } from "../db/migrations/index.js";
import type { FrontendApi } from "../frontend/index.js";
import { createObsidianNavigation } from "./ObsidianNavigation.js";
import { nativeBindingLoadError, resolveNativeBinding } from "./nativeBindings.js";
import { TranscriptMemorySettingsTab } from "./SettingsTab.js";
import { TranscriptMemoryItemView } from "./TranscriptMemoryItemView.js";
import { createObsidianAppApi } from "./services/ObsidianAppApi.js";
import { OBSIDIAN_COMMANDS, OBSIDIAN_REINDEX_COMMAND, OBSIDIAN_RIBBON, OBSIDIAN_VIEW_TYPES, type TranscriptMemoryViewType } from "./pluginTypes.js";
import { createUnavailableFrontendApi, DESKTOP_ONLY_MESSAGE, initialPluginHealth, readableStartupError, startupSupport, type PluginHealth } from "./startup.js";
import { DEFAULT_SETTINGS, normalizeSettings, settingsHealthSummary, type TranscriptMemorySettings } from "./settings.js";
import { embeddingReindexStatus, runEmbeddingReindex } from "./embeddingSettings.js";
import { createObsidianEmbeddingTransport } from "./embeddingTransport.js";

export default class TranscriptMemoryVaultPlugin extends Plugin {
  private db: SqliteDatabase | null = null;
  private pluginSettings: TranscriptMemorySettings = DEFAULT_SETTINGS;
  private health: PluginHealth = initialPluginHealth();
  private api: FrontendApi = createUnavailableFrontendApi(() => this.health);

  async onload(): Promise<void> {
    await this.loadSettings();
    const navigation = createObsidianNavigation(this.app);
    for (const type of Object.values(OBSIDIAN_VIEW_TYPES)) {
      this.registerView(type, (leaf) => new TranscriptMemoryItemView(leaf, type as TranscriptMemoryViewType, () => this.api, navigation));
    }
    for (const command of OBSIDIAN_COMMANDS) {
      this.addCommand({ id: command.id, name: command.name, callback: () => void navigationForView(navigation, command.viewType) });
    }
    this.addCommand({ id: OBSIDIAN_REINDEX_COMMAND.id, name: OBSIDIAN_REINDEX_COMMAND.name, callback: () => void this.rebuildEmbeddingIndex() });
    this.addRibbonIcon(OBSIDIAN_RIBBON.icon, OBSIDIAN_RIBBON.title, () => void navigation.openDashboard());
    this.addSettingTab(new TranscriptMemorySettingsTab(this.app, this, () => this.health, navigation, () => this.pluginSettings, (next) => this.saveSettings(next)));

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
    const migrationDirectory = join(pluginDirectory, "migrations");
    const nativeBinding = resolveNativeBinding(pluginDirectory);
    this.health = {
      ...this.health, databasePath, nativeBindingTarget: nativeBinding.target, packagedNativeTargets: nativeBinding.packagedTargets,
    };
    if (!nativeBinding.ok) {
      this.health = { ...this.health, status: "error", lastInitializationError: nativeBinding.error };
      this.api = createUnavailableFrontendApi(() => this.health);
      new Notice(nativeBinding.error!);
      console.error("Transcript Memory Vault native binding unavailable:", nativeBinding.error);
      return;
    }
    try {
      mkdirSync(pluginDirectory, { recursive: true });
      const migrationPackage = validateMigrationPackage(migrationDirectory);
      if (!migrationPackage.ok) throw new Error(`Missing packaged migrations: ${migrationPackage.missing.join(", ")}`);
      const firstRun = !existsSync(databasePath);
      try {
        this.db = openDatabase(databasePath, { nativeBinding: nativeBinding.bindingPath!, migrationDirectory });
      } catch (error) {
        throw nativeBindingLoadError(nativeBinding, error);
      }
      const appliedMigrationCount = (this.db.prepare("SELECT COUNT(*) count FROM schema_migrations").get() as { count: number }).count;
      this.health = {
        ...this.health, status: "ready", databaseConnected: true, migrationStatus: "current", appliedMigrationCount,
        realSqliteStorage: true, firstRun, lastInitializationError: null,
      };
      this.api = createObsidianAppApi(this.db, this.app.vault, this.health);
      this.refreshReindexStatus();
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

  private async loadSettings(): Promise<void> {
    try {
      this.pluginSettings = normalizeSettings(await this.loadData());
    } catch (error) {
      // A corrupt/unreadable settings file must never block startup; fall back to deterministic defaults.
      this.pluginSettings = DEFAULT_SETTINGS;
      console.error("Transcript Memory Vault settings could not be loaded; using local deterministic defaults.");
    }
    this.health = { ...this.health, ...settingsHealthSummary(this.pluginSettings) };
  }

  async saveSettings(next: TranscriptMemorySettings): Promise<void> {
    this.pluginSettings = normalizeSettings(next);
    await this.saveData(this.pluginSettings);
    this.health = { ...this.health, ...settingsHealthSummary(this.pluginSettings) };
    // Read-only, network-free: recompute whether the index matches the (possibly changed) provider.
    this.refreshReindexStatus();
  }

  /** Read-only, network-free. Safe to call on startup and after every settings change. */
  private refreshReindexStatus(): void {
    if (!this.db) return;
    try {
      const { summary, assessment } = embeddingReindexStatus(this.db, this.pluginSettings);
      this.health = {
        ...this.health,
        reindexNeeded: assessment.needsReindex,
        reindexSummary: assessment.reasons.join(" ") || "Embedding index is up to date.",
        embeddingUsedFallback: summary.usedFallback,
      };
    } catch {
      // Status is best-effort and must never break the plugin.
      this.health = { ...this.health, reindexSummary: "Reindex status unavailable." };
    }
  }

  /** EXPLICIT manual action. The only path that may make a network call (when external is configured). */
  private async rebuildEmbeddingIndex(): Promise<void> {
    if (!this.db || this.health.status !== "ready") {
      new Notice("Transcript Memory Vault is not ready; cannot rebuild the embedding index.");
      return;
    }
    new Notice("Rebuilding embedding index…");
    try {
      const { summary, result } = await runEmbeddingReindex(this.db, this.pluginSettings, { transport: createObsidianEmbeddingTransport() });
      if (summary.usedFallback && summary.reason) new Notice(summary.reason);
      new Notice(`Embedding index rebuilt: ${result.indexed} indexed, ${result.embedded} embedded, ${result.errors} error(s).`);
      this.refreshReindexStatus();
    } catch (error) {
      new Notice(`Embedding index rebuild failed: ${readableStartupError(error)}`);
      console.error("Transcript Memory Vault embedding reindex failed", error);
    }
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
