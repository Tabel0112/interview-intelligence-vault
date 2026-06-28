import { ItemView, Notice, type WorkspaceLeaf } from "obsidian";
import { mountObsidianUi, type FrontendApi, type ObsidianNavigation } from "../frontend/index.js";
import { defaultTarget, type TranscriptMemoryViewState, type TranscriptMemoryViewType, viewTitle } from "./pluginTypes.js";
import type { RefreshableView, ViewRefreshRegistry } from "./viewRefreshRegistry.js";

export class TranscriptMemoryItemView extends ItemView implements RefreshableView {
  private state: TranscriptMemoryViewState = {};

  constructor(leaf: WorkspaceLeaf, private readonly type: TranscriptMemoryViewType, private readonly getApi: () => FrontendApi, private readonly vaultNavigation: ObsidianNavigation, private readonly registry: ViewRefreshRegistry) {
    super(leaf);
  }

  getViewType(): string { return this.type; }
  getDisplayText(): string { return viewTitle(this.type); }
  getIcon(): string { return "database"; }
  getState(): TranscriptMemoryViewState { return this.state; }

  async setState(state: TranscriptMemoryViewState): Promise<void> {
    this.state = state;
    await this.render();
  }

  async onOpen(): Promise<void> {
    // Register so a mutating action in another view can refresh this one (cross-view invalidation).
    this.registry.register(this);
    await this.render();
  }

  async onClose(): Promise<void> {
    this.registry.unregister(this);
    this.contentEl.empty();
  }

  /** Re-fetch and re-render this view's current route. Invoked by the registry after a mutation elsewhere. */
  async refresh(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("transcript-memory-vault-host");
    try {
      // onMutation refreshes the OTHER open views after a successful mutating action in this one.
      await mountObsidianUi(this.contentEl, this.getApi(), this.vaultNavigation, this.state.target ?? defaultTarget(this.type), () => this.registry.notifyMutation(this), (message) => new Notice(message));
    } catch (error) {
      console.error("Transcript Memory Vault view load failed", error);
      this.contentEl.empty();
      this.contentEl.createEl("h2", { text: "Transcript Memory Vault could not load this view" });
      this.contentEl.createEl("p", { text: error instanceof Error ? error.message : String(error) });
      this.contentEl.createEl("p", { text: "The plugin did not continue as if the database were trustworthy. Open the dashboard or plugin settings for database health details." });
    }
  }
}
