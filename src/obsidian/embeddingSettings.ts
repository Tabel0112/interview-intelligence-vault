// Pure adapter from plugin settings to an external embedding-provider config.
//
// This is the clean bridge between the settings foundation and the external embedding provider.
// It is PURE (no Obsidian runtime, no network, no Date/random) and only produces configuration —
// it never constructs a provider or makes a call. The returned config carries the API key only
// because that is its purpose (configuring the provider); the key is never logged here.

import type { ExternalEmbeddingConfig } from "../retrieval/index.js";
import { isExternalEmbeddingProvider, type TranscriptMemorySettings } from "./settings.js";

/**
 * Returns a valid ExternalEmbeddingConfig only when the embedding provider is fully configured:
 *   - mode is "external",
 *   - the embedding provider is an external (OpenAI-compatible) provider,
 *   - a non-blank API key exists for that provider, and
 *   - dimensions is a positive integer.
 * Otherwise returns null, so callers fall back to the local deterministic provider.
 */
export function externalEmbeddingConfigFromSettings(settings: TranscriptMemorySettings): ExternalEmbeddingConfig | null {
  if (settings.mode !== "external") return null;
  const { provider, model, dimensions, baseUrl, timeoutMs } = settings.embedding;
  if (!isExternalEmbeddingProvider(provider)) return null;
  const apiKey = settings.apiKeys[provider];
  if (!apiKey || !apiKey.trim()) return null;
  if (typeof dimensions !== "number" || !Number.isInteger(dimensions) || dimensions <= 0) return null;

  const config: ExternalEmbeddingConfig = { provider, model, dimensions, apiKey: apiKey.trim() };
  if (baseUrl) config.baseUrl = baseUrl;
  if (typeof timeoutMs === "number" && timeoutMs > 0) config.timeoutMs = timeoutMs;
  return config;
}
