// Pure adapter from plugin settings to an external embedding-provider config.
//
// This is the clean bridge between the settings foundation and the external embedding provider.
// It is PURE (no Obsidian runtime, no network, no Date/random) and only produces configuration —
// it never constructs a provider or makes a call. The returned config carries the API key only
// because that is its purpose (configuring the provider); the key is never logged here.

import type { SqliteDatabase } from "../db/index.js";
import {
  detectReindexNeeded, rebuildRetrievalIndex, resolveEmbeddingProvider, TOKEN_HASH_MODEL,
  type EmbeddingProvider, type EmbeddingProviderResolution, type EmbeddingTransport, type ExternalEmbeddingConfig, type ReindexAssessment,
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
 * Obsidian requestUrl transport.
 *
 * Three resolution cases, kept distinct:
 *  1. External provider fully configured (mode external + key + positive dims) → the LIVE external provider
 *     (`usedFallback: false`).
 *  2. External provider SELECTED but not fully configured (missing key/dims, or mode not yet "external") →
 *     the local token-hash provider for the keyword index, flagged `usedFallback: true` with an "awaiting
 *     key" reason. Production Ask AI/MCP stay fail-closed (productionEmbeddingProvider returns undefined).
 *  3. An explicit dev/test seam (`deterministic-test` / `noop`) → that provider directly (`usedFallback:
 *     false`) — an intentional selection, never treated as a fallback.
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
  // Case 2: an external provider is selected but not fully configured (missing API key and/or dimensions, or
  // mode not yet "external"). This is a setup-incomplete "awaiting key" state — NOT an explicit dev/test seam.
  // The local token-hash index still serves keyword search, but Ask AI/MCP stay fail-closed via usedFallback.
  if (isExternalEmbeddingProvider(settings.embedding.provider)) {
    const fallback = resolveEmbeddingProvider();
    return {
      ...fallback,
      requestedId: settings.embedding.provider,
      usedFallback: true,
      reason: `Embedding provider "${settings.embedding.provider}" needs an API key (and positive dimensions) before it can power Ask AI. The local ${TOKEN_HASH_MODEL} index is dev/test only and does not answer Ask AI — add a key in Settings and run "Rebuild Embedding Index".`,
    };
  }
  // Case 3: explicit dev/test seam (deterministic-test / noop) — an intentional selection, not a fallback.
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

export type AskAiEmbeddingHealthState = "ok" | "setup_required" | "reindex_required";
export interface AskAiEmbeddingHealth { state: AskAiEmbeddingHealthState; reason: string; }

/**
 * Read-only PRODUCTION-readiness check for Ask AI embeddings. Uses the EXTERNAL config directly (never the
 * token-hash fallback), so a vault with no API embeddings is `setup_required` and a vault still indexed under
 * a different/stale space (e.g. token-hash-v1, or a changed provider/model/dimensions) is `reindex_required`.
 * Never constructs a live provider, never calls the network, never reindexes, never writes anything.
 */
export function askAiEmbeddingHealth(db: SqliteDatabase, settings: TranscriptMemorySettings): AskAiEmbeddingHealth {
  const external = externalEmbeddingConfigFromSettings(settings);
  if (!external) {
    return { state: "setup_required", reason: "No API embedding provider is configured. token-hash-v1 is dev/test only and is not used for production Ask AI answers." };
  }
  // Decide against the external SPACE only (no provider construction / no transport / no network).
  const assessment = detectReindexNeeded(db, { provider: external.provider, model: external.model, dimensions: external.dimensions });
  if (assessment.needsReindex) {
    return { state: "reindex_required", reason: assessment.reasons.join(" ") || "The embedding index does not match the configured API embedding provider. Rebuild the embedding index." };
  }
  return { state: "ok", reason: "Embedding index matches the configured API embedding provider." };
}

/**
 * The LIVE external embedding provider for production Ask AI retrieval, or `undefined` when none is configured.
 * NEVER returns the token-hash-v1 fallback (so token-hash is never passed as a production provider). A mock
 * transport may be injected in tests; production passes the Obsidian requestUrl transport.
 */
export function productionEmbeddingProvider(settings: TranscriptMemorySettings, options: { transport?: EmbeddingTransport } = {}): EmbeddingProvider | undefined {
  const resolution = resolveEmbeddingProviderFromSettings(settings, options);
  return resolution.usedFallback ? undefined : resolution.provider;
}
