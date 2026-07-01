// Pure builder for the non-secret dashboard setup summary.
//
// It composes the EXISTING non-secret helpers (settings readiness + embedding health) into the
// display-only `SetupSummary` the Claude/MCP dashboard card renders. It is PURE: no DB writes, no
// network, no Date/random. It NEVER copies API key material into its output — only key PRESENCE
// (the `*Configured` booleans) and non-secret provider/model/dimension/path metadata.

import { dirname, join } from "node:path";
import type { SqliteDatabase } from "../db/index.js";
import type { SetupSummary } from "../frontend/types.js";
import { askAiEmbeddingHealth, externalEmbeddingConfigFromSettings } from "./embeddingSettings.js";
import { isLlmConfigured, type TranscriptMemorySettings } from "./settings.js";

export function buildSetupSummary(db: SqliteDatabase, settings: TranscriptMemorySettings, databasePath?: string): SetupSummary {
  const health = askAiEmbeddingHealth(db, settings);
  const external = externalEmbeddingConfigFromSettings(settings); // null unless an external provider + key + dims are set
  const llmConfigured = isLlmConfigured(settings);
  return {
    llmConfigured,
    // Provider/model are non-secret selections; only surface them when actually configured.
    llmProvider: llmConfigured ? settings.llm.provider : undefined,
    llmModel: llmConfigured && settings.llm.model.trim() ? settings.llm.model : undefined,
    embeddingConfigured: external != null,
    embeddingProvider: external?.provider ?? (settings.embedding.provider || undefined),
    embeddingModel: external?.model ?? (settings.embedding.model || undefined),
    embeddingDimensions: external?.dimensions ?? settings.embedding.dimensions,
    embeddingHealth: health.state,
    reindexNeeded: health.state === "reindex_required",
    databasePath,
    // The plugin's data.json lives next to the SQLite database (same plugin directory).
    settingsPath: databasePath ? join(dirname(databasePath), "data.json") : undefined,
  };
}
