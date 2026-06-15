// Pure adapter from plugin settings to an LLM provider configuration / resolution.
//
// PURE: no Obsidian runtime, no network, no Date/random. Resolving an external provider only
// CONSTRUCTS it (which validates the key) — it never calls the network. The local deterministic
// provider is the default and the safe fallback. A future Ask AI wiring will pass the Obsidian
// requestUrl transport (src/obsidian/llmTransport.ts); nothing here makes a call.
//
// The returned config carries the API key only because that is its purpose (configuring the
// provider). The key is never logged here, and llmResolutionSummary is non-secret and contains
// no live provider object.

import { createLlmAskAILanguageModel, type AskAILanguageModel, type SynthesisInfo } from "../ask-ai/index.js";
import {
  ExternalLlmProvider, LocalDeterministicLlmProvider,
  type ExternalLlmProviderConfig, type LlmProvider, type LlmTransport,
} from "../llm/index.js";
import { isExternalLlmProvider, type TranscriptMemorySettings } from "./settings.js";

/**
 * Returns a valid ExternalLlmProviderConfig only when the LLM provider is fully configured:
 *   - mode is "external",
 *   - the LLM provider is an external (OpenAI-compatible) provider,
 *   - the model is non-blank, and
 *   - a non-blank API key exists for that provider.
 * Otherwise returns null, so callers fall back to the local deterministic provider.
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

export interface LlmProviderResolution {
  /** Live provider — holds the API key. Do not serialize; use llmResolutionSummary instead. */
  provider: LlmProvider;
  requestedId: string;
  usedFallback: boolean;
  reason?: string;
}

/**
 * Resolve the LLM provider implied by settings. Network-free (construction only). A mock transport
 * may be injected for tests; production passes the Obsidian requestUrl transport. When external is
 * selected but not fully configured, falls back to the local deterministic provider with a clear,
 * non-secret reason.
 */
export function resolveLlmProviderFromSettings(
  settings: TranscriptMemorySettings,
  options: { transport?: LlmTransport } = {},
): LlmProviderResolution {
  const external = externalLlmConfigFromSettings(settings);
  if (external) {
    const config: ExternalLlmProviderConfig = options.transport ? { ...external, transport: options.transport } : external;
    return { provider: new ExternalLlmProvider(config), requestedId: external.id, usedFallback: false };
  }
  if (settings.mode === "external" && isExternalLlmProvider(settings.llm.provider)) {
    return {
      provider: new LocalDeterministicLlmProvider(),
      requestedId: settings.llm.provider,
      usedFallback: true,
      reason: `External LLM provider "${settings.llm.provider}" is not fully configured (needs a model and a non-blank API key); using the local deterministic LLM provider.`,
    };
  }
  return {
    provider: new LocalDeterministicLlmProvider(),
    requestedId: settings.llm.provider || "local-deterministic",
    usedFallback: false,
  };
}

/** Non-secret summary of an LLM resolution. Safe for health/status: no key, no live provider object. */
export interface LlmResolutionSummary {
  requestedId: string;
  providerId: string;
  model: string;
  isLocal: boolean;
  usedFallback: boolean;
  reason?: string;
}

export function llmResolutionSummary(resolution: LlmProviderResolution): LlmResolutionSummary {
  return {
    requestedId: resolution.requestedId,
    providerId: resolution.provider.id,
    model: resolution.provider.model,
    isLocal: resolution.provider.isLocal,
    usedFallback: resolution.usedFallback,
    reason: resolution.reason,
  };
}

export interface AskAiSynthesis {
  /** Set ONLY when a valid external LLM is configured; otherwise undefined (deterministic path). */
  llm?: AskAILanguageModel;
  /** Non-secret configured-synthesis summary recorded with the answer. No keys/provider objects. */
  info: SynthesisInfo;
}

/**
 * Build the Ask AI synthesis dependency from settings. Resolving constructs a provider (no network);
 * the LLM is wrapped in the grounded synthesis adapter ONLY when the resolved provider is external.
 * For local/unconfigured/incomplete settings, llm is undefined so Ask AI uses deterministic synthesis.
 */
export function askAiSynthesisFromSettings(settings: TranscriptMemorySettings, options: { transport?: LlmTransport } = {}): AskAiSynthesis {
  const resolution = resolveLlmProviderFromSettings(settings, options);
  const external = !resolution.provider.isLocal;
  const info: SynthesisInfo = {
    mode: external ? "external_llm" : "deterministic",
    provider: resolution.provider.id,
    model: resolution.provider.model,
    usedFallback: resolution.usedFallback,
  };
  return { llm: external ? createLlmAskAILanguageModel(resolution.provider) : undefined, info };
}
