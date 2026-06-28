import type { TFile, Vault } from "obsidian";
import type { AskAILanguageModel, SynthesisInfo } from "../../ask-ai/index.js";
import type { SqliteDatabase } from "../../db/index.js";
import { createSqliteFrontendApi, validateTranscriptUpload, type FrontendApi, type GeneratedSyncResult } from "../../frontend/index.js";
import type { MemoryExtractor } from "../../memory/index.js";
import type { PluginHealth } from "../startup.js";

export interface ObsidianAppApi extends FrontendApi {
  uploadVaultFile(file: TFile): Promise<{ transcriptId: string; status: "imported" | "duplicate"; warning?: string }>;
}

export function createObsidianAppApi(
  db: SqliteDatabase,
  vault: Pick<Vault, "read">,
  health?: PluginHealth,
  getSynthesis?: () => { llm?: AskAILanguageModel; info: SynthesisInfo } | undefined,
  getMemoryExtractor?: () => MemoryExtractor | undefined,
  options?: { llmRequired?: boolean; getLlmReady?: () => boolean; syncGeneratedViews?: () => Promise<GeneratedSyncResult> },
): ObsidianAppApi {
  const api = createSqliteFrontendApi(db, { health, getSynthesis, getMemoryExtractor, llmRequired: options?.llmRequired, getLlmReady: options?.getLlmReady, syncGeneratedViews: options?.syncGeneratedViews });
  return {
    ...api,
    async uploadVaultFile(file) {
      const rawText = await vault.read(file);
      validateTranscriptUpload({ filename: file.name, rawText });
      return api.uploadTranscript({ filename: file.name, rawText });
    },
  };
}
