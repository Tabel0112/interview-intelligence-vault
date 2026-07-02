import { PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { ObsidianNavigation } from "../frontend/index.js";
import type { PluginHealth } from "./startup.js";
import {
  applyRecommendedEmbeddingDefaults, applyRecommendedLlmDefaults,
  EMBEDDING_PROVIDER_LABELS, EMBEDDING_PROVIDER_OPTIONS, isDevTestEmbeddingProvider, isEmbeddingConfigured,
  isExternalEmbeddingProvider, isLlmConfigured, LLM_PROVIDER_LABELS, LLM_PROVIDER_OPTIONS,
  redactApiKey, RECOMMENDED_EMBEDDING_DEFAULTS, RECOMMENDED_LLM_DEFAULTS, setApiKey, setupRequirement,
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

    // Ask AI (Obsidian + Claude Desktop / MCP) requires BOTH a configured LLM and a configured external
    // embedding provider — an LLM-only setup is incomplete. This single message reflects both requirements.
    const required = this.containerEl.createEl("p", { text: setupRequirement(settings).message });
    required.addClass("setting-item-description");

    new Setting(this.containerEl)
      .setName("LLM provider")
      .setDesc("Required for Ask AI. Grounded memory extraction and Ask AI answer synthesis use this external provider. Select \"none\" to disable AI features.")
      .addDropdown((dropdown) => {
        for (const option of LLM_PROVIDER_OPTIONS) dropdown.addOption(option, LLM_PROVIDER_LABELS[option] ?? option);
        dropdown.setValue(settings.llm.provider).onChange(async (value) => {
          // Selecting an external provider enables external mode; "none" disables AI features. There is
          // no user-facing local/deterministic mode.
          const mode = value !== "none" ? ("external" as const) : ("local" as const);
          await this.onSave({ ...this.getSettings(), mode, llm: { ...this.getSettings().llm, provider: value } });
          this.display();
        });
      });

    new Setting(this.containerEl)
      .setName("Recommended LLM setup")
      .setDesc(`One click fills provider "${RECOMMENDED_LLM_DEFAULTS.provider}" and model "${RECOMMENDED_LLM_DEFAULTS.model}". Your API key is never autofilled — add it below.`)
      .addButton((button) =>
        button.setButtonText("Use recommended LLM defaults").onClick(async () => {
          await this.onSave(applyRecommendedLlmDefaults(this.getSettings()));
          this.display();
        }),
      );

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
      .setDesc("Required for Ask AI retrieval, MCP ask_vault, and MCP evidence search. Choose the recommended external (OpenAI-compatible) provider and set its dimensions + API key below. The deterministic-test / noop providers are dev/test seams only and do NOT enable Ask AI.")
      .addDropdown((dropdown) => {
        for (const option of EMBEDDING_PROVIDER_OPTIONS) dropdown.addOption(option, EMBEDDING_PROVIDER_LABELS[option] ?? option);
        dropdown.setValue(settings.embedding.provider).onChange(async (value) => {
          await this.onSave({ ...this.getSettings(), embedding: { ...this.getSettings().embedding, provider: value } });
          this.display();
        });
      });

    new Setting(this.containerEl)
      .setName("Recommended embedding setup")
      .setDesc(`One click fills provider "${RECOMMENDED_EMBEDDING_DEFAULTS.provider}", model "${RECOMMENDED_EMBEDDING_DEFAULTS.model}", and dimensions ${RECOMMENDED_EMBEDDING_DEFAULTS.dimensions}. Your API key is never autofilled — add it below, then run "Rebuild Embedding Index".`)
      .addButton((button) =>
        button.setButtonText("Use recommended embedding defaults").onClick(async () => {
          await this.onSave(applyRecommendedEmbeddingDefaults(this.getSettings()));
          this.display();
        }),
      );

    // Make it impossible to mistake a dev/test seam for a production embedding setup.
    if (isDevTestEmbeddingProvider(settings.embedding.provider)) {
      const devWarning = this.containerEl.createEl("p", {
        text: `"${settings.embedding.provider}" is a dev/test seam: it produces non-semantic token-hash vectors and does NOT enable Ask AI or MCP ask_vault. Switch to the recommended external provider above (or click "Use recommended embedding defaults") and add an API key to enable Ask AI.`,
      });
      devWarning.addClass("setting-item-description");
      devWarning.addClass("mod-warning");
    }

    new Setting(this.containerEl)
      .setName("Embedding model")
      .setDesc("Model identifier (e.g. text-embedding-3-small). Required for an external embedding provider. Changing the model changes the vector space — run \"Rebuild Embedding Index\" afterward.")
      .addText((text) =>
        text.setPlaceholder("e.g. text-embedding-3-small").setValue(settings.embedding.model).onChange(async (value) => {
          await this.onSave({ ...this.getSettings(), embedding: { ...this.getSettings().embedding, model: value } });
        }),
      );

    const embeddingProviderId = settings.embedding.provider;
    const embeddingIsExternal = isExternalEmbeddingProvider(embeddingProviderId);

    new Setting(this.containerEl)
      .setName("Embedding dimensions")
      .setDesc("Required for an external embedding provider: the vector length the model returns. Changing it requires a \"Rebuild Embedding Index\".")
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
          ? `Stored for "${embeddingProviderId}": ${redactApiKey(settings.apiKeys[embeddingProviderId])} (the saved key is never displayed). Type a new key to replace it; leave blank to keep the existing one.`
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
          : `Stored for "${llmProviderId}": ${llmKeyStatus} (the saved key is never displayed). Type a new key to replace it; leave blank to keep the existing one.`,
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
    new Setting(this.containerEl).setName("AI retrieval (embeddings)").setDesc(
      isEmbeddingConfigured(settings)
        ? `Configured: ${settings.embedding.provider}${settings.embedding.model ? ` / ${settings.embedding.model}` : ""}${settings.embedding.dimensions ? ` / ${settings.embedding.dimensions}d` : ""} (external).`
        : "Not configured. Ask AI retrieval, MCP ask_vault, and MCP evidence search are disabled until you set an external embedding provider, model, dimensions, and API key. Required — not optional.",
    );
    new Setting(this.containerEl).setName("Embedding index").setDesc(
      health.reindexNeeded === undefined
        ? "Status unavailable until the database is ready."
        : health.reindexNeeded
          ? `Reindex needed — run the "Rebuild Embedding Index" command. ${health.reindexSummary ?? ""}`.trim()
          : `Up to date. ${health.reindexSummary ?? ""}`.trim(),
    );
    if (health.embeddingUsedFallback) {
      new Setting(this.containerEl)
        .setName("Embedding setup incomplete")
        .setDesc("An external embedding provider is selected but has no API key yet, so Ask AI and MCP stay disabled. A local token-hash index (dev/test only) is used for keyword search and never answers Ask AI. Add an API key above, then run \"Rebuild Embedding Index\".");
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
