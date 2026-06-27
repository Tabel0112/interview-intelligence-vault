import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { ObsidianNavigation } from "../frontend/index.js";
import type { PluginHealth } from "./startup.js";
import {
  EMBEDDING_PROVIDER_OPTIONS, isExternalEmbeddingProvider, isLlmConfigured, LLM_PROVIDER_OPTIONS, redactApiKey, setApiKey,
  type TranscriptMemorySettings,
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
      text: "API keys are stored in this plugin's local data file (data.json) as plain text. If your vault is synced, the key may sync with it. Run the \"Rebuild Embedding Index\" command to (re)build the index with the configured provider — that command is the only action that may make a network call.",
    });
    warning.addClass("setting-item-description");

    const required = this.containerEl.createEl("p", {
      text: isLlmConfigured(settings)
        ? `AI is configured: ${settings.llm.provider} / ${settings.llm.model}. Ask AI and AI memory extraction are enabled.`
        : "AI is NOT configured. Ask AI and AI memory extraction require an external LLM provider, model, and API key. Configure one below to enable AI features.",
    });
    required.addClass("setting-item-description");

    new Setting(this.containerEl)
      .setName("LLM provider")
      .setDesc("Required. Ask AI and AI memory extraction use this external provider. Select \"none\" to disable AI features.")
      .addDropdown((dropdown) => {
        for (const option of LLM_PROVIDER_OPTIONS) dropdown.addOption(option, option);
        dropdown.setValue(settings.llm.provider).onChange(async (value) => {
          // Selecting an external provider enables external mode; "none" disables AI features. There is
          // no user-facing local/deterministic mode.
          const mode = value !== "none" ? ("external" as const) : ("local" as const);
          await this.onSave({ ...this.getSettings(), mode, llm: { ...this.getSettings().llm, provider: value } });
          this.display();
        });
      });

    new Setting(this.containerEl)
      .setName("LLM model")
      .setDesc("Model identifier. Required for an external provider.")
      .addText((text) =>
        text.setPlaceholder("e.g. gpt-4o-mini").setValue(settings.llm.model).onChange(async (value) => {
          await this.onSave({ ...this.getSettings(), llm: { ...this.getSettings().llm, model: value } });
        }),
      );

    new Setting(this.containerEl)
      .setName("LLM base URL")
      .setDesc("Optional. Override the OpenAI-compatible endpoint for the external LLM provider.")
      .addText((text) =>
        text.setPlaceholder("https://api.openai.com/v1").setValue(settings.llm.baseUrl ?? "").onChange(async (value) => {
          const baseUrl = value.trim().length > 0 ? value.trim() : undefined;
          await this.onSave({ ...this.getSettings(), llm: { ...this.getSettings().llm, baseUrl } });
        }),
      );

    new Setting(this.containerEl)
      .setName("LLM request timeout (ms)")
      .setDesc("Optional. Applied to the external LLM provider; the local provider ignores it.")
      .addText((text) =>
        text.setPlaceholder("e.g. 30000").setValue(settings.llm.timeoutMs != null ? String(settings.llm.timeoutMs) : "").onChange(async (value) => {
          const parsed = Number(value.trim());
          const timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
          await this.onSave({ ...this.getSettings(), llm: { ...this.getSettings().llm, timeoutMs } });
        }),
      );

    new Setting(this.containerEl)
      .setName("Embedding provider")
      .setDesc("For future semantic retrieval. The deterministic test provider is the default.")
      .addDropdown((dropdown) => {
        for (const option of EMBEDDING_PROVIDER_OPTIONS) dropdown.addOption(option, option);
        dropdown.setValue(settings.embedding.provider).onChange(async (value) => {
          await this.onSave({ ...this.getSettings(), embedding: { ...this.getSettings().embedding, provider: value } });
          this.display();
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

    const embeddingProviderId = settings.embedding.provider;
    const embeddingIsExternal = isExternalEmbeddingProvider(embeddingProviderId);

    new Setting(this.containerEl)
      .setName("Embedding dimensions")
      .setDesc("Required for an external embedding provider: the vector length the model returns.")
      .addText((text) =>
        text.setPlaceholder("e.g. 1536").setValue(settings.embedding.dimensions != null ? String(settings.embedding.dimensions) : "").onChange(async (value) => {
          const parsed = Number(value.trim());
          const dimensions = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
          await this.onSave({ ...this.getSettings(), embedding: { ...this.getSettings().embedding, dimensions } });
        }),
      );

    new Setting(this.containerEl)
      .setName("Embedding base URL")
      .setDesc("Optional. Override the OpenAI-compatible endpoint for the external embedding provider.")
      .addText((text) =>
        text.setPlaceholder("https://api.openai.com/v1").setValue(settings.embedding.baseUrl ?? "").onChange(async (value) => {
          const baseUrl = value.trim().length > 0 ? value.trim() : undefined;
          await this.onSave({ ...this.getSettings(), embedding: { ...this.getSettings().embedding, baseUrl } });
        }),
      );

    new Setting(this.containerEl)
      .setName("Embedding request timeout (ms)")
      .setDesc("Optional. Applied only to the external embedding HTTP transport.")
      .addText((text) =>
        text.setPlaceholder("e.g. 30000").setValue(settings.embedding.timeoutMs != null ? String(settings.embedding.timeoutMs) : "").onChange(async (value) => {
          const parsed = Number(value.trim());
          const timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
          await this.onSave({ ...this.getSettings(), embedding: { ...this.getSettings().embedding, timeoutMs } });
        }),
      );

    new Setting(this.containerEl)
      .setName("Embedding API key")
      .setDesc(
        embeddingIsExternal
          ? `Stored for "${embeddingProviderId}": ${redactApiKey(settings.apiKeys[embeddingProviderId])}. Type a new key to replace it; leave blank to keep the existing one.`
          : "The selected embedding provider runs locally and needs no API key.",
      )
      .addText((text) => {
        text.inputEl.type = "password";
        // Never prefill the input with the stored secret; only accept new values.
        text.setPlaceholder("Enter API key").onChange(async (value) => {
          if (!embeddingIsExternal) return;
          const trimmed = value.trim();
          if (!trimmed) return;
          await this.onSave(setApiKey(this.getSettings(), embeddingProviderId, trimmed));
        });
      })
      .addButton((button) =>
        button.setButtonText("Clear").onClick(async () => {
          if (!embeddingIsExternal) return;
          await this.onSave(setApiKey(this.getSettings(), embeddingProviderId, ""));
          this.display();
        }),
      );

    const llmProviderId = settings.llm.provider;
    const llmKeyStatus = redactApiKey(settings.apiKeys[llmProviderId]);
    new Setting(this.containerEl)
      .setName("LLM API key")
      .setDesc(
        llmProviderId === "none"
          ? "Select an LLM provider to set its API key."
          : `Stored for "${llmProviderId}": ${llmKeyStatus}. Type a new key to replace it; leave blank to keep the existing one.`,
      )
      .addText((text) => {
        text.inputEl.type = "password";
        // Never prefill the input with the stored secret; only accept new values.
        text.setPlaceholder("Enter API key").onChange(async (value) => {
          if (llmProviderId === "none") return;
          const trimmed = value.trim();
          if (!trimmed) return;
          await this.onSave(setApiKey(this.getSettings(), llmProviderId, trimmed));
        });
      })
      .addButton((button) =>
        button.setButtonText("Clear").onClick(async () => {
          if (llmProviderId === "none") return;
          await this.onSave(setApiKey(this.getSettings(), llmProviderId, ""));
          this.display();
        }),
      );

    this.containerEl.createEl("h3", { text: "Status" });
    new Setting(this.containerEl).setName("Plugin status").setDesc(health.status);
    new Setting(this.containerEl).setName("API key").setDesc(health.apiKeyConfigured ? "configured" : "not configured");
    new Setting(this.containerEl).setName("AI (LLM)").setDesc(
      isLlmConfigured(settings)
        ? `Configured: ${settings.llm.provider}${settings.llm.model ? ` / ${settings.llm.model}` : ""} (external).`
        : "Not configured. Ask AI and AI memory extraction are disabled until you set an LLM provider, model, and API key.",
    );
    new Setting(this.containerEl).setName("Embedding index").setDesc(
      health.reindexNeeded === undefined
        ? "Status unavailable until the database is ready."
        : health.reindexNeeded
          ? `Reindex needed — run the "Rebuild Embedding Index" command. ${health.reindexSummary ?? ""}`.trim()
          : `Up to date. ${health.reindexSummary ?? ""}`.trim(),
    );
    if (health.embeddingUsedFallback) {
      new Setting(this.containerEl).setName("Embedding fallback").setDesc("The configured external embedding provider is not fully set up; using local token-hash-v1.");
    }
    new Setting(this.containerEl).setName("Database location").setDesc(health.databasePath ?? "Unavailable");
    new Setting(this.containerEl).setName("SQLite storage").setDesc(health.realSqliteStorage ? "Connected to real local SQLite storage" : "Not connected");
    new Setting(this.containerEl).setName("Migration status").setDesc(`${health.migrationStatus}: ${health.appliedMigrationCount}/${health.packagedMigrationCount} applied`);
    new Setting(this.containerEl).setName("Last initialization error").setDesc(health.lastInitializationError ?? "None");
    new Setting(this.containerEl).setName("Native binding target").setDesc(health.nativeBindingTarget ?? "Unresolved");
    new Setting(this.containerEl).setName("Packaged native targets").setDesc(health.packagedNativeTargets.join(", ") || "None");
    new Setting(this.containerEl).setName("Dashboard").addButton((button) => button.setButtonText("Open dashboard").onClick(() => void this.navigation.openDashboard()));
  }
}
