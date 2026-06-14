import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { ObsidianNavigation } from "../frontend/index.js";
import type { PluginHealth } from "./startup.js";
import {
  EMBEDDING_PROVIDER_OPTIONS, LLM_PROVIDER_OPTIONS, redactApiKey, setApiKey, type TranscriptMemorySettings,
} from "./settings.js";

export class TranscriptMemorySettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly getHealth: () => PluginHealth,
    private readonly navigation: ObsidianNavigation,
    private readonly getSettings: () => TranscriptMemorySettings,
    private readonly onSave: (next: TranscriptMemorySettings) => Promise<void>,
  ) {
    super(app, plugin);
  }

  display(): void {
    const health = this.getHealth();
    const settings = this.getSettings();
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "Transcript Memory Vault" });

    this.containerEl.createEl("h3", { text: "AI providers" });
    const warning = this.containerEl.createEl("p", {
      text: "API keys are stored in this plugin's local data file (data.json) as plain text. If your vault is synced, the key may sync with it. No external network calls are made yet — the app runs in local deterministic mode regardless of these settings.",
    });
    warning.addClass("setting-item-description");

    new Setting(this.containerEl)
      .setName("Mode")
      .setDesc("Local deterministic runs fully offline and is the default. External providers are recorded but not active yet.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("local", "Local deterministic (default)")
          .addOption("external", "External providers (not active yet)")
          .setValue(settings.mode)
          .onChange(async (value) => {
            await this.onSave({ ...this.getSettings(), mode: value === "external" ? "external" : "local" });
          }),
      );

    new Setting(this.containerEl)
      .setName("LLM provider")
      .setDesc("For future Ask AI synthesis. Not called yet.")
      .addDropdown((dropdown) => {
        for (const option of LLM_PROVIDER_OPTIONS) dropdown.addOption(option, option);
        dropdown.setValue(settings.llm.provider).onChange(async (value) => {
          await this.onSave({ ...this.getSettings(), llm: { ...this.getSettings().llm, provider: value } });
          this.display();
        });
      });

    new Setting(this.containerEl)
      .setName("LLM model")
      .setDesc("Model identifier placeholder.")
      .addText((text) =>
        text.setPlaceholder("e.g. claude-...").setValue(settings.llm.model).onChange(async (value) => {
          await this.onSave({ ...this.getSettings(), llm: { ...this.getSettings().llm, model: value } });
        }),
      );

    new Setting(this.containerEl)
      .setName("Embedding provider")
      .setDesc("For future semantic retrieval. The deterministic test provider is the default.")
      .addDropdown((dropdown) => {
        for (const option of EMBEDDING_PROVIDER_OPTIONS) dropdown.addOption(option, option);
        dropdown.setValue(settings.embedding.provider).onChange(async (value) => {
          await this.onSave({ ...this.getSettings(), embedding: { ...this.getSettings().embedding, provider: value } });
        });
      });

    new Setting(this.containerEl)
      .setName("Embedding model")
      .setDesc("Model identifier placeholder.")
      .addText((text) =>
        text.setPlaceholder("token-hash-v1").setValue(settings.embedding.model).onChange(async (value) => {
          await this.onSave({ ...this.getSettings(), embedding: { ...this.getSettings().embedding, model: value } });
        }),
      );

    const providerId = settings.llm.provider;
    const keyStatus = redactApiKey(settings.apiKeys[providerId]);
    new Setting(this.containerEl)
      .setName("API key")
      .setDesc(
        providerId === "none"
          ? "Select an LLM provider to set its API key."
          : `Stored for "${providerId}": ${keyStatus}. Type a new key to replace it; leave blank to keep the existing one.`,
      )
      .addText((text) => {
        text.inputEl.type = "password";
        // Never prefill the input with the stored secret; only accept new values.
        text.setPlaceholder("Enter API key").onChange(async (value) => {
          if (providerId === "none") return;
          const trimmed = value.trim();
          if (!trimmed) return;
          await this.onSave(setApiKey(this.getSettings(), providerId, trimmed));
        });
      })
      .addButton((button) =>
        button.setButtonText("Clear").onClick(async () => {
          if (providerId === "none") return;
          await this.onSave(setApiKey(this.getSettings(), providerId, ""));
          this.display();
        }),
      );

    this.containerEl.createEl("h3", { text: "Status" });
    new Setting(this.containerEl).setName("Plugin status").setDesc(health.status);
    new Setting(this.containerEl).setName("Provider mode").setDesc(health.providerMode ?? settings.mode);
    new Setting(this.containerEl).setName("API key").setDesc(health.apiKeyConfigured ? "configured" : "not configured");
    new Setting(this.containerEl).setName("Database location").setDesc(health.databasePath ?? "Unavailable");
    new Setting(this.containerEl).setName("SQLite storage").setDesc(health.realSqliteStorage ? "Connected to real local SQLite storage" : "Not connected");
    new Setting(this.containerEl).setName("Migration status").setDesc(`${health.migrationStatus}: ${health.appliedMigrationCount}/${health.packagedMigrationCount} applied`);
    new Setting(this.containerEl).setName("Last initialization error").setDesc(health.lastInitializationError ?? "None");
    new Setting(this.containerEl).setName("Native binding target").setDesc(health.nativeBindingTarget ?? "Unresolved");
    new Setting(this.containerEl).setName("Packaged native targets").setDesc(health.packagedNativeTargets.join(", ") || "None");
    new Setting(this.containerEl).setName("Dashboard").addButton((button) => button.setButtonText("Open dashboard").onClick(() => void this.navigation.openDashboard()));
  }
}
