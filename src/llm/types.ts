// LLM provider abstraction — transport layer only.
//
// A low-level, provider-agnostic seam (text/JSON in, text out), deliberately decoupled from
// Ask AI: the Ask-AI claim seam (`AskAILanguageModel.generateClaims`) stays in src/ask-ai, and a
// future task will add a thin adapter from an LlmProvider to it. Grounded synthesis and structured
// extraction will both build on `complete()`; neither is implemented here.
//
// Nothing in this module makes a network call. The only concrete provider is the local
// deterministic one (offline, no secrets). The credential/config types exist now so that
// redaction and key-safety have a stable shape before any real network provider is added.
//
// FUTURE-PROVIDER REQUIREMENT (binding): when a real external (network) LLM provider is added, it
// MUST store its API key and other secret-bearing internals in true ECMAScript `#private` fields,
// exactly like `ExternalEmbeddingProvider` in src/retrieval/externalEmbeddingProvider.ts. TS
// `private` is compile-time only and remains enumerable at runtime; `#private` fields are excluded
// from JSON.stringify, object spread, Object.keys/getOwnPropertyNames, Reflect.ownKeys, and
// util.inspect, so the key cannot leak via serialization or inspection.

export type LlmResponseFormat = "text" | "json";
export type LlmFinishReason = "stop" | "length";

export interface LlmRequest {
  system?: string;
  prompt: string;
  responseFormat?: LlmResponseFormat; // default "text"
  maxOutputTokens?: number;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmCompletion {
  provider: string; // provider id
  model: string;
  text: string;
  finishReason: LlmFinishReason;
  usage?: LlmUsage;
}

export interface LlmRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  /** true => no network, fully offline and deterministic. */
  readonly isLocal: boolean;
  complete(request: LlmRequest, options?: LlmRequestOptions): Promise<LlmCompletion>;
}

// Defined now (no network provider uses it yet) so redaction + key-safety have a stable shape.
// Shape is intentionally compatible with the settings provider/model/apiKey selection, so a future
// settings -> LLM adapter is clean. No adapter is built in this task.
export interface LlmProviderConfig {
  id: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface RedactedLlmProviderConfig {
  id: string;
  model: string;
  hasApiKey: boolean;
  baseUrl?: string;
  timeoutMs?: number;
}
