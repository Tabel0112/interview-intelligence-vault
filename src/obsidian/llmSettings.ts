// Pure adapter from plugin settings to the external LLM used for generation.
//
// The live app is LLM-REQUIRED: there is no local/deterministic product mode and no live fallback.
// When settings do not fully configure an external (OpenAI-compatible) provider, these resolvers return
// `undefined`, and the frontend renders a setup-required state instead of fabricating local output.
//
// PURE: no Obsidian runtime, no network, no Date/random. Resolving only CONSTRUCTS the provider (which
// validates the key) — it never calls the network until synthesis/extraction actually runs. The API key
// is never logged here, and only non-secret summaries are exposed to health/UI.

import { createLlmAskAIAnalysisModel, createLlmAskAILanguageModel, type AskAIAnalysisModel, type AskAILanguageModel, type SynthesisInfo } from "../ask-ai/index.js";
import { ExternalLlmProvider, type ExternalLlmProviderConfig, type LlmTransport } from "../llm/index.js";
import { createLlmMemoryExtractor, type MemoryExtractor } from "../memory/index.js";
import { isExternalLlmProvider, type TranscriptMemorySettings } from "./settings.js";

/**
 * Returns a valid ExternalLlmProviderConfig only when the LLM provider is fully configured:
 *   - mode is "external",
 *   - the LLM provider is an external (OpenAI-compatible) provider,
 *   - the model is non-blank, and
 *   - a non-blank API key exists for that provider.
 * Otherwise returns null (the caller treats this as setup-required — never a deterministic fallback).
 */
export function externalLlmConfigFromSettings(settings: TranscriptMemorySettings): ExternalLlmProviderConfig | null {
  if (settings.mode !== "external") return null;
  const { provider, model, baseUrl, timeoutMs } = settings.llm;
  if (!isExternalLlmProvider(provider)) return null;
  if (!model || !model.trim()) return null;
  const apiKey = settings.apiKeys[provider];
  if (!apiKey || !apiKey.trim()) return null;

  const config: ExternalLlmProviderConfig = { id: provider, model: model.trim(), apiKey: apiKey.trim() };
  if (baseUrl) config.baseUrl = baseUrl;
  if (typeof timeoutMs === "number" && timeoutMs > 0) config.timeoutMs = timeoutMs;
  return config;
}

/** Construct the configured external LLM provider, or null when not fully configured. Network-free. */
function externalProviderFromSettings(settings: TranscriptMemorySettings, options: { transport?: LlmTransport }): ExternalLlmProvider | null {
  const external = externalLlmConfigFromSettings(settings);
  if (!external) return null;
  return new ExternalLlmProvider(options.transport ? { ...external, transport: options.transport } : external);
}

export interface AskAiSynthesis {
  /** The grounded LLM synthesis adapter. Present only when an external LLM is configured. */
  llm: AskAILanguageModel;
  /** Live-only AI-analysis adapter (Step 2), from the same provider. Used for advice/strategy/planning. */
  analysis: AskAIAnalysisModel;
  /** Non-secret configured-synthesis summary recorded with the answer. No keys/provider objects. */
  info: SynthesisInfo;
}

/**
 * Build the Ask AI synthesis dependency from settings, or `undefined` when no external LLM is configured.
 * The live wiring treats `undefined` as setup-required (no deterministic synthesis in the live app).
 * Resolving only constructs a provider — no network call happens here.
 */
export function askAiSynthesisFromSettings(settings: TranscriptMemorySettings, options: { transport?: LlmTransport } = {}): AskAiSynthesis | undefined {
  const provider = externalProviderFromSettings(settings, options);
  if (!provider) return undefined;
  return {
    llm: createLlmAskAILanguageModel(provider),
    analysis: createLlmAskAIAnalysisModel(provider),
    info: { mode: "external_llm", provider: provider.id, model: provider.model, usedFallback: false },
  };
}

/**
 * Resolve the memory extractor from settings, or `undefined` when no external LLM is configured.
 * The returned LLM extractor has NO deterministic fallback (the live app must not fabricate memory).
 * Resolving only constructs a provider — no network call happens here.
 */
export function memoryExtractorFromSettings(settings: TranscriptMemorySettings, options: { transport?: LlmTransport } = {}): MemoryExtractor | undefined {
  const provider = externalProviderFromSettings(settings, options);
  if (!provider) return undefined;
  return createLlmMemoryExtractor(provider);
}
