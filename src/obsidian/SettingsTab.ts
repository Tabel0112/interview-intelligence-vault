import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { ObsidianNavigation } from "../frontend/index.js";
import type { PluginHealth } from "./startup.js";

export class TranscriptMemorySettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: Plugin, private readonly getHealth: () => PluginHealth, private readonly navigation: ObsidianNavigation) {
    super(app, plugin);
  }

  display(): void {
    const health = this.getHealth();
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "Transcript Memory Vault" });
    new Setting(this.containerEl).setName("Plugin status").setDesc(health.status);
    new Setting(this.containerEl).setName("Database location").setDesc(health.databasePath ?? "Unavailable");
    new Setting(this.containerEl).setName("SQLite storage").setDesc(health.realSqliteStorage ? "Connected to real local SQLite storage" : "Not connected");
    new Setting(this.containerEl).setName("Migration status").setDesc(`${health.migrationStatus}: ${health.appliedMigrationCount}/${health.packagedMigrationCount} applied`);
    new Setting(this.containerEl).setName("Last initialization error").setDesc(health.lastInitializationError ?? "None");
    new Setting(this.containerEl).setName("Dashboard").addButton((button) => button.setButtonText("Open dashboard").onClick(() => void this.navigation.openDashboard()));
  }
}
