// Pure adapter from plugin settings to an external embedding-provider config.
//
// This is the clean bridge between the settings foundation and the external embedding provider.
// It is PURE (no Obsidian runtime, no network, no Date/random) and only produces configuration —
// it never constructs a provider or makes a call. The returned config carries the API key only
// because that is its purpose (configuring the provider); the key is never logged here.

import type { SqliteDatabase } from "../db/index.js";
import {
  detectReindexNeeded, rebuildRetrievalIndex, resolveEmbeddingProvider, TOKEN_HASH_MODEL,
  type EmbeddingProviderResolution, type EmbeddingTransport, type ExternalEmbeddingConfig, type ReindexAssessment,
} from "../retrieval/index.js";
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

/** Non-secret summary of a provider resolution. Safe to surface in health/logs/notices. */
export interface EmbeddingResolutionSummary {
  requestedId: string;
  model: string;
  usedFallback: boolean;
  reason?: string;
}

const summarizeResolution = (resolution: EmbeddingProviderResolution): EmbeddingResolutionSummary => ({
  requestedId: resolution.requestedId,
  model: resolution.provider.model,
  usedFallback: resolution.usedFallback,
  reason: resolution.reason,
});

/**
 * Resolve the embedding provider implied by settings.
 *
 * Returns the LIVE provider (for an external provider it holds the API key), so callers must not
 * serialize the returned object — use embeddingReindexStatus/runEmbeddingReindex, which return a
 * non-secret summary instead. A mock transport may be injected for tests; production passes the
 * Obsidian requestUrl transport. When external is selected but not fully configured, falls back to
 * local token-hash-v1 with a clear reason.
 */
export function resolveEmbeddingProviderFromSettings(
  settings: TranscriptMemorySettings,
  options: { transport?: EmbeddingTransport } = {},
): EmbeddingProviderResolution {
  const external = externalEmbeddingConfigFromSettings(settings);
  if (external) {
    const config: ExternalEmbeddingConfig = options.transport ? { ...external, transport: options.transport } : external;
    return resolveEmbeddingProvider(undefined, { external: config });
  }
  if (settings.mode === "external" && isExternalEmbeddingProvider(settings.embedding.provider)) {
    const fallback = resolveEmbeddingProvider();
    return {
      ...fallback,
      requestedId: settings.embedding.provider,
      usedFallback: true,
      reason: `External embedding provider "${settings.embedding.provider}" is not fully configured (needs a non-blank API key and positive dimensions); using local ${TOKEN_HASH_MODEL}.`,
    };
  }
  return resolveEmbeddingProvider(settings.embedding.provider, { dimensions: settings.embedding.dimensions });
}

export interface EmbeddingReindexStatus {
  summary: EmbeddingResolutionSummary;
  assessment: ReindexAssessment;
}

/**
 * Read-only, network-free reindex status for the provider implied by settings. This function is
 * SYNCHRONOUS, so it cannot perform a network call — safe to run on startup and on every settings
 * change. (Resolving an external provider only constructs it; it never calls embedTexts here.)
 */
export function embeddingReindexStatus(db: SqliteDatabase, settings: TranscriptMemorySettings): EmbeddingReindexStatus {
  const resolution = resolveEmbeddingProviderFromSettings(settings);
  const assessment = detectReindexNeeded(db, resolution.provider);
  return { summary: summarizeResolution(resolution), assessment };
}

export interface EmbeddingReindexResult {
  summary: EmbeddingResolutionSummary;
  result: Awaited<ReturnType<typeof rebuildRetrievalIndex>>;
  assessment: ReindexAssessment;
}

/**
 * EXPLICIT reindex action — the only path that may make a network call (when an external provider
 * is configured). `rebuildRetrievalIndex` is intentionally NOT wrapped in a SQLite transaction,
 * because embedTexts may call the network and a network call must never run inside a transaction.
 * A mock transport is injected in tests.
 */
export async function runEmbeddingReindex(
  db: SqliteDatabase,
  settings: TranscriptMemorySettings,
  options: { transport?: EmbeddingTransport } = {},
): Promise<EmbeddingReindexResult> {
  const resolution = resolveEmbeddingProviderFromSettings(settings, options);
  const result = await rebuildRetrievalIndex(db, { embeddingProvider: resolution.provider });
  const assessment = detectReindexNeeded(db, resolution.provider);
  return { summary: summarizeResolution(resolution), result, assessment };
}
