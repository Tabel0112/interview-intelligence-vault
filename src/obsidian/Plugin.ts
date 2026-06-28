import { FileSystemAdapter, Notice, Platform, Plugin } from "obsidian";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openDatabase, type SqliteDatabase } from "../db/index.js";
import { validateMigrationPackage } from "../db/migrations/index.js";
import { navigateInternal, obsidianRouteFromProtocol, OBSIDIAN_PROTOCOL_ACTION, type FrontendApi, type GeneratedSyncResult } from "../frontend/index.js";
import { createObsidianNavigation } from "./ObsidianNavigation.js";
import { generateObsidianVault } from "./generateVault.js";
import { dedupeCanonicalMemories } from "../memory/index.js";
import type { ObsidianViewResult } from "./types.js";
import { nativeBindingLoadError, resolveNativeBinding } from "./nativeBindings.js";
import { TranscriptMemorySettingsTab } from "./SettingsTab.js";
import { TranscriptMemoryItemView } from "./TranscriptMemoryItemView.js";
import { createObsidianAppApi } from "./services/ObsidianAppApi.js";
import { GENERATED_VAULT_FOLDER, OBSIDIAN_COMMANDS, OBSIDIAN_DEDUPE_COMMAND, OBSIDIAN_REINDEX_COMMAND, OBSIDIAN_RIBBON, OBSIDIAN_SYNC_GRAPH_COMMAND, OBSIDIAN_VIEW_TYPES, type TranscriptMemoryViewType } from "./pluginTypes.js";
import { createUnavailableFrontendApi, DESKTOP_ONLY_MESSAGE, initialPluginHealth, readableStartupError, startupSupport, type PluginHealth } from "./startup.js";
import { DEFAULT_SETTINGS, isLlmConfigured, normalizeSettings, settingsHealthSummary, type TranscriptMemorySettings } from "./settings.js";
import { embeddingReindexStatus, runEmbeddingReindex } from "./embeddingSettings.js";
import { createObsidianEmbeddingTransport } from "./embeddingTransport.js";
import { askAiSynthesisFromSettings, memoryExtractorFromSettings } from "./llmSettings.js";
import { createObsidianLlmTransport } from "./llmTransport.js";
import { ViewRefreshRegistry } from "./viewRefreshRegistry.js";

export default class TranscriptMemoryVaultPlugin extends Plugin {
  private db: SqliteDatabase | null = null;
  // Absolute on-disk vault root (desktop only); the generated Markdown view layer is written under it.
  private vaultBasePath: string | null = null;
  private pluginSettings: TranscriptMemorySettings = DEFAULT_SETTINGS;
  private health: PluginHealth = initialPluginHealth();
  private api: FrontendApi = createUnavailableFrontendApi(() => this.health);
  // Built once; reused. The transport makes no call until the synthesis adapter actually runs.
  private readonly llmTransport = createObsidianLlmTransport();
  // Tracks open plugin views so a mutating action in one refreshes the others (cross-view invalidation).
  private readonly viewRegistry = new ViewRefreshRegistry();

  async onload(): Promise<void> {
    await this.loadSettings();
    const navigation = createObsidianNavigation(this.app);
    for (const type of Object.values(OBSIDIAN_VIEW_TYPES)) {
      this.registerView(type, (leaf) => new TranscriptMemoryItemView(leaf, type as TranscriptMemoryViewType, () => this.api, navigation, this.viewRegistry));
    }
    for (const command of OBSIDIAN_COMMANDS) {
      this.addCommand({ id: command.id, name: command.name, callback: () => void navigationForView(navigation, command.viewType) });
    }
    this.addCommand({ id: OBSIDIAN_REINDEX_COMMAND.id, name: OBSIDIAN_REINDEX_COMMAND.name, callback: () => void this.rebuildEmbeddingIndex() });
    this.addCommand({ id: "run-ai-extraction", name: "Run AI extraction for transcripts missing it", callback: () => void this.runPendingExtraction() });
    this.addCommand({ id: OBSIDIAN_SYNC_GRAPH_COMMAND.id, name: OBSIDIAN_SYNC_GRAPH_COMMAND.name, callback: () => void this.syncGeneratedGraphNotesCommand() });
    this.addCommand({ id: OBSIDIAN_DEDUPE_COMMAND.id, name: OBSIDIAN_DEDUPE_COMMAND.name, callback: () => void this.mergeDuplicateMemoriesCommand() });
    this.addRibbonIcon(OBSIDIAN_RIBBON.icon, OBSIDIAN_RIBBON.title, () => void navigation.openDashboard());
    // External deep links (e.g. from Claude Desktop): obsidian://transcript-memory-vault?route=<mv://...>.
    // Navigation only — the route is allowlist-validated to a known mv:// view, then opened via the existing
    // navigation path. Invalid links show a readable Notice and never navigate or mutate data.
    this.registerObsidianProtocolHandler(OBSIDIAN_PROTOCOL_ACTION, (params) => {
      const route = obsidianRouteFromProtocol(params);
      if (route) void navigateInternal(navigation, route);
      else new Notice("Transcript Memory Vault: could not open that link (unrecognized or invalid route).");
    });
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

    this.vaultBasePath = fileSystemAdapter!.getBasePath();
    const pluginDirectory = join(this.vaultBasePath, this.app.vault.configDir, "plugins", this.manifest.id);
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
      // Per-call getters resolve the LLM from CURRENT settings (no network until synthesis/extraction runs).
      // The live app is LLM-REQUIRED: when no external LLM is configured the getters return undefined and
      // the UI shows setup-required instead of generating deterministic output.
      this.api = createObsidianAppApi(this.db, this.app.vault, this.health,
        () => askAiSynthesisFromSettings(this.pluginSettings, { transport: this.llmTransport }),
        () => memoryExtractorFromSettings(this.pluginSettings, { transport: this.llmTransport }),
        { llmRequired: true, getLlmReady: () => isLlmConfigured(this.pluginSettings), syncGeneratedViews: () => this.syncGeneratedGraphNotesForApi() });
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

  /** Run AI extraction for any transcript imported before the LLM was configured. Requires a configured LLM. */
  private async runPendingExtraction(): Promise<void> {
    if (!this.db || this.health.status !== "ready") { new Notice("Transcript Memory Vault is not ready."); return; }
    if (!isLlmConfigured(this.pluginSettings)) { new Notice("Configure an LLM provider, model, and API key in Settings first."); return; }
    new Notice("Running AI extraction…");
    let extracted = 0, failed = 0, skipped = 0;
    for (const transcript of await this.api.listTranscripts()) {
      const result = await this.api.runExtraction(transcript.id);
      if (result.status === "extracted") extracted += 1;
      else if (result.status === "failed") failed += 1;
      else skipped += 1;
    }
    new Notice(`AI extraction: ${extracted} processed, ${skipped} already done, ${failed} failed.`);
    await this.viewRegistry.notifyMutation();
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

  /**
   * Core generated-Markdown sync (no UI side effects). Writes the disposable view layer under
   * `<vault>/Transcript Memory Vault/` so Obsidian's native ribbon graph has notes + wikilinks.
   * `cleanBeforeWrite` removes ONLY previously-generated files (tracked in the manifest) and never
   * touches user-created notes. SQLite stays the source of truth; generated Markdown is never read back.
   */
  private async runGeneratedVaultSync(): Promise<ObsidianViewResult> {
    if (!this.db || this.health.status !== "ready") throw new Error("Transcript Memory Vault is not ready.");
    if (!this.vaultBasePath) throw new Error("Vault filesystem path is unavailable.");
    return generateObsidianVault(this.db, { outputRoot: join(this.vaultBasePath, GENERATED_VAULT_FOLDER), cleanBeforeWrite: true });
  }

  /** EXPLICIT manual action (command palette). Writes generated graph notes and reports via Notices. */
  private async syncGeneratedGraphNotesCommand(): Promise<void> {
    if (!this.db || this.health.status !== "ready") { new Notice("Transcript Memory Vault is not ready; cannot sync graph notes."); return; }
    new Notice("Syncing generated graph notes…");
    try {
      const result = await this.runGeneratedVaultSync();
      new Notice(result.errors.length
        ? `Graph notes synced with ${result.errors.length} file error(s); see "${GENERATED_VAULT_FOLDER}/_system/generation-log.md".`
        : `Graph notes synced into "${GENERATED_VAULT_FOLDER}/": ${result.filesWritten} written, ${result.filesSkipped} unchanged, ${result.graphNodeCount} nodes, ${result.graphEdgeCount} edges. Open Obsidian's graph view to see them.`);
      await this.viewRegistry.notifyMutation();
    } catch (error) {
      new Notice(`Graph notes sync failed: ${readableStartupError(error)}`);
      console.error("Transcript Memory Vault generated graph sync failed", error);
    }
  }

  /**
   * EXPLICIT manual action (command palette). Deterministic, idempotent: merges EXACT duplicate memories
   * onto one canonical and consolidates their evidence. Never deletes raw data; never touches near-dups
   * (those stay needs_review for human review). Reports the result via a Notice.
   */
  private async mergeDuplicateMemoriesCommand(): Promise<void> {
    if (!this.db || this.health.status !== "ready") { new Notice("Transcript Memory Vault is not ready; cannot merge duplicate memories."); return; }
    try {
      const r = dedupeCanonicalMemories(this.db);
      new Notice(r.canonicalGroups === 0
        ? "No exact duplicate memories found. Near-duplicates (if any) remain in the review queue."
        : `Merged duplicate memories: ${r.canonicalGroups} canonical group(s), ${r.duplicatesSuperseded} duplicate(s) superseded, ${r.evidenceLinksConsolidated} evidence link(s) consolidated. Resync graph notes to refresh the native graph.`);
      await this.viewRegistry.notifyMutation();
    } catch (error) {
      new Notice(`Merge duplicate memories failed: ${readableStartupError(error)}`);
      console.error("Transcript Memory Vault memory dedupe failed", error);
    }
  }

  /** Same sync, triggered from the dashboard button. Returns a frontend-friendly summary (no Notices). */
  private async syncGeneratedGraphNotesForApi(): Promise<GeneratedSyncResult> {
    try {
      const result = await this.runGeneratedVaultSync();
      return {
        status: "synced", filesWritten: result.filesWritten, filesSkipped: result.filesSkipped,
        graphNodeCount: result.graphNodeCount, graphEdgeCount: result.graphEdgeCount, warnings: result.warnings, errors: result.errors,
      };
    } catch (error) {
      return { status: "failed", message: readableStartupError(error) };
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
