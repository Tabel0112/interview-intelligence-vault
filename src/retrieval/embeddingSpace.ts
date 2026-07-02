// Embedding-space descriptors, compatibility helpers, and the provider registry/default-resolver.
//
// This formalizes the metadata that already governs retrieval: an embedding "space" is the
// (provider, model, dimensions) triple. Vectors may only be compared within the same space —
// see assertCompatibleEmbeddingSpace. This module builds on the existing EmbeddingProvider
// interface (it does not introduce a parallel one) and changes no retrieval behavior.

import { ValidationError } from "../db/errors.js";
import { DeterministicTestEmbeddingProvider, NoopEmbeddingProvider, type EmbeddingProvider } from "./embeddingProvider.js";
import { createExternalEmbeddingProvider, type ExternalEmbeddingConfig } from "./externalEmbeddingProvider.js";

export interface EmbeddingSpace {
  provider: string; // EmbeddingProvider.name
  model: string;
  dimensions: number;
}

export const embeddingSpaceOf = (provider: EmbeddingProvider): EmbeddingSpace => ({
  provider: provider.name,
  model: provider.model,
  dimensions: provider.dimensions,
});

export const sameEmbeddingSpace = (a: EmbeddingSpace, b: EmbeddingSpace): boolean =>
  a.provider === b.provider && a.model === b.model && a.dimensions === b.dimensions;

export const describeEmbeddingSpace = (space: EmbeddingSpace): string =>
  `${space.provider}/${space.model}@${space.dimensions}`;

/** Vectors from different providers/models/dimensions must never be compared. */
export function assertCompatibleEmbeddingSpace(a: EmbeddingSpace, b: EmbeddingSpace): void {
  if (!sameEmbeddingSpace(a, b)) {
    throw new ValidationError(
      `Incompatible embedding spaces: ${describeEmbeddingSpace(a)} vs ${describeEmbeddingSpace(b)}; vectors from different providers/models/dimensions must not be compared.`,
    );
  }
}

export const isVectorCapable = (space: EmbeddingSpace): boolean => space.dimensions > 0;

// --- Provider registry / default resolver -------------------------------------------------
// token-hash-v1 is the default local fallback. No real/network providers exist yet; an unknown
// id resolves to the deterministic default with usedFallback=true so callers always get a
// working offline provider rather than an error.

export const DEFAULT_EMBEDDING_PROVIDER_ID = "deterministic-test";
export const TOKEN_HASH_MODEL = "token-hash-v1";

export interface EmbeddingProviderResolution {
  provider: EmbeddingProvider;
  requestedId: string;
  usedFallback: boolean;
  reason?: string;
}

export function resolveEmbeddingProvider(
  id: string = DEFAULT_EMBEDDING_PROVIDER_ID,
  options?: { dimensions?: number; external?: ExternalEmbeddingConfig },
): EmbeddingProviderResolution {
  // External provider is used ONLY when explicitly configured with a non-blank API key.
  if (options?.external) {
    const external = options.external;
    if (external.apiKey && external.apiKey.trim().length > 0) {
      return { provider: createExternalEmbeddingProvider(external), requestedId: external.provider, usedFallback: false };
    }
    return {
      provider: new DeterministicTestEmbeddingProvider(options?.dimensions),
      requestedId: external.provider,
      usedFallback: true,
      reason: `Embedding provider "${external.provider}" has no API key configured; using local deterministic ${TOKEN_HASH_MODEL}.`,
    };
  }
  if (id === "noop" || id === "disabled") {
    return { provider: new NoopEmbeddingProvider(), requestedId: id, usedFallback: false };
  }
  if (id === DEFAULT_EMBEDDING_PROVIDER_ID || id === TOKEN_HASH_MODEL) {
    return { provider: new DeterministicTestEmbeddingProvider(options?.dimensions), requestedId: id, usedFallback: false };
  }
  return {
    provider: new DeterministicTestEmbeddingProvider(options?.dimensions),
    requestedId: id,
    usedFallback: true,
    reason: `Embedding provider "${id}" is not available yet; using local deterministic ${TOKEN_HASH_MODEL}.`,
  };
}

export const createEmbeddingProvider = (id?: string, options?: { dimensions?: number }): EmbeddingProvider =>
  resolveEmbeddingProvider(id, options).provider;
