// Typed Ask AI synthesis failures. The live app requires a configured LLM for synthesis; these let the
// frontend distinguish "set up an LLM" from "the LLM failed" — and guarantee we never fabricate a
// deterministic/local answer in the live runtime. Messages are generic and key-free.

/** No LLM is configured but Ask AI had evidence to synthesize. The live app requires an LLM. */
export class SynthesisSetupRequiredError extends Error {
  readonly code = "synthesis_setup_required" as const;
  constructor(message = "Ask AI requires a configured LLM provider. Add a provider, model, and API key in Settings.") {
    super(message);
    this.name = "SynthesisSetupRequiredError";
  }
}

/** An LLM is configured but synthesis could not produce grounded claims (failure, timeout, or empty). */
export class SynthesisFailedError extends Error {
  readonly code = "synthesis_failed" as const;
  constructor(message = "The AI could not generate an answer right now. Please try again.") {
    super(message);
    this.name = "SynthesisFailedError";
  }
}

/**
 * Production Ask AI requires an API embedding provider; none is configured. token-hash-v1 is a dev/test
 * seam only and must never serve production factual answers, so this blocks rather than silently falling back.
 */
export class EmbeddingSetupRequiredError extends Error {
  readonly code = "embedding_setup_required" as const;
  constructor(message = "Configure an API embedding provider before using Ask AI. Add an embedding provider, model, dimensions, and API key in Settings.") {
    super(message);
    this.name = "EmbeddingSetupRequiredError";
  }
}

/**
 * An API embedding provider is configured, but the index was built with a different/stale provider (e.g.
 * token-hash-v1 or a changed provider/model/dimensions). Block until the index is rebuilt.
 */
export class EmbeddingReindexRequiredError extends Error {
  readonly code = "embedding_reindex_required" as const;
  constructor(message = "Rebuild the embedding index after changing embedding provider/settings. Run \"Rebuild embedding index\".") {
    super(message);
    this.name = "EmbeddingReindexRequiredError";
  }
}
