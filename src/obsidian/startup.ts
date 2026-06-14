import type { FrontendApi } from "../frontend/index.js";
import { PACKAGED_MIGRATION_COUNT } from "../db/migrations/index.js";
import { DEFAULT_SETTINGS, settingsHealthSummary, type ProviderMode } from "./settings.js";

export const DESKTOP_ONLY_MESSAGE = "Transcript Memory Vault is desktop-only right now because it uses local SQLite storage.";

export type PluginStartupStatus = "initializing" | "ready" | "unsupported" | "error";
export type MigrationHealthStatus = "pending" | "current" | "failed";

export interface PluginHealth {
  status: PluginStartupStatus;
  databaseConnected: boolean;
  migrationStatus: MigrationHealthStatus;
  packagedMigrationCount: number;
  appliedMigrationCount: number;
  databasePath: string | null;
  realSqliteStorage: boolean;
  firstRun: boolean;
  lastInitializationError: string | null;
  nativeBindingTarget: string | null;
  packagedNativeTargets: string[];
  // Non-secret provider/settings summary. Never contains API key material.
  providerMode?: ProviderMode;
  llmProvider?: string;
  llmModel?: string;
  embeddingProvider?: string;
  embeddingModel?: string;
  apiKeyConfigured?: boolean;
}

export const initialPluginHealth = (): PluginHealth => ({
  status: "initializing",
  databaseConnected: false,
  migrationStatus: "pending",
  packagedMigrationCount: PACKAGED_MIGRATION_COUNT,
  appliedMigrationCount: 0,
  databasePath: null,
  realSqliteStorage: false,
  firstRun: false,
  lastInitializationError: null,
  nativeBindingTarget: null,
  packagedNativeTargets: [],
  ...settingsHealthSummary(DEFAULT_SETTINGS),
});

export function startupSupport(input: { isDesktopApp: boolean; hasLocalFilesystem: boolean }): { supported: true } | { supported: false; message: string } {
  return input.isDesktopApp && input.hasLocalFilesystem ? { supported: true } : { supported: false, message: DESKTOP_ONLY_MESSAGE };
}

const unavailable = (health: PluginHealth): never => {
  throw new Error(health.lastInitializationError ?? DESKTOP_ONLY_MESSAGE);
};

export function createUnavailableFrontendApi(getHealth: () => PluginHealth): FrontendApi {
  return {
    async getDashboard() {
      return {
        totalTranscriptCount: 0, transcripts: [], recentAnswers: [], reviewCount: 0, weakCount: 0, conflictCount: 0, brokenCount: 0,
        health: getHealth(),
      };
    },
    async listTranscripts() { return []; },
    async uploadTranscript() { return unavailable(getHealth()); },
    async getTranscript() { return unavailable(getHealth()); },
    async ask() { return unavailable(getHealth()); },
    async askAI() { return unavailable(getHealth()); },
    async getAnswer() { return unavailable(getHealth()); },
    async getEvidence() { return unavailable(getHealth()); },
    async getMemory() { return unavailable(getHealth()); },
    async getMemoryObject() { return unavailable(getHealth()); },
    async getGraph() { return unavailable(getHealth()); },
    async search() { return unavailable(getHealth()); },
    async searchVault() { return unavailable(getHealth()); },
    async listReviewItems() { return unavailable(getHealth()); },
    async getReviewItem() { return unavailable(getHealth()); },
    async submitCorrection() { return unavailable(getHealth()); },
  };
}

export function readableStartupError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
