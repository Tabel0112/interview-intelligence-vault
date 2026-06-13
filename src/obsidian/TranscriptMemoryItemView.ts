import { ItemView, type WorkspaceLeaf } from "obsidian";
import { mountObsidianUi, type FrontendApi, type ObsidianNavigation } from "../frontend/index.js";
import { defaultTarget, type TranscriptMemoryViewState, type TranscriptMemoryViewType, viewTitle } from "./pluginTypes.js";

export class TranscriptMemoryItemView extends ItemView {
  private state: TranscriptMemoryViewState = {};

  constructor(leaf: WorkspaceLeaf, private readonly type: TranscriptMemoryViewType, private readonly getApi: () => FrontendApi, private readonly vaultNavigation: ObsidianNavigation) {
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

  async onOpen(): Promise<void> { await this.render(); }
  async onClose(): Promise<void> { this.contentEl.empty(); }

  private async render(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("transcript-memory-plugin");
    try {
      await mountObsidianUi(this.contentEl, this.getApi(), this.vaultNavigation, this.state.target ?? defaultTarget(this.type));
    } catch (error) {
      console.error("Transcript Memory Vault view load failed", error);
      this.contentEl.empty();
      this.contentEl.createEl("h2", { text: "Transcript Memory Vault could not load this view" });
      this.contentEl.createEl("p", { text: error instanceof Error ? error.message : String(error) });
      this.contentEl.createEl("p", { text: "The plugin did not continue as if the database were trustworthy. Open the dashboard or plugin settings for database health details." });
    }
  }
}
