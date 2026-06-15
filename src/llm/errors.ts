// LLM provider error hierarchy.
//
// Mirrors the project's existing error style (see src/db/errors.ts): a base class that sets
// `name = new.target.name`, with empty-bodied subclasses for instanceof-based handling.
//
// IMPORTANT: errors carry only non-secret context ({ provider, model }). They must NEVER be
// constructed with, or store, an API key or raw secret. Messages are key-free by construction;
// any upstream text that might echo a secret must be passed through redactSecret first.

export interface LlmErrorContext {
  provider?: string;
  model?: string;
}

export class LlmError extends Error {
  readonly context?: LlmErrorContext;
  constructor(message: string, context?: LlmErrorContext, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.context = context;
  }
}

/** The request exceeded its timeout budget. */
export class LlmTimeoutError extends LlmError {}
/** The request was cancelled by the caller (external AbortSignal). */
export class LlmCancelledError extends LlmError {}
/** Authentication/authorization failure (e.g. missing/invalid key). */
export class LlmAuthError extends LlmError {}
/** The provider rate-limited the request. */
export class LlmRateLimitError extends LlmError {}
/** Generic upstream/provider failure that doesn't map to a more specific type. */
export class LlmProviderError extends LlmError {}
/** The provider returned output that could not be parsed or had the wrong shape. */
export class LlmResponseFormatError extends LlmError {}
