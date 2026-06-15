// Real external (OpenAI-compatible) LLM provider, behind the existing LlmProvider interface.
//
// Used ONLY when constructed with a non-blank API key. Network access goes through an injectable
// LlmTransport so tests never touch the network. The default HTTP transport
// (createHttpLlmTransport) is the only place real I/O happens.
//
// Timeout/cancellation are handled at the provider level via runWithTimeout (the LLM module's own
// helper), which yields precise LlmTimeoutError / LlmCancelledError. The HTTP transport stays a
// thin fetch+parse wrapper that just forwards the AbortSignal.
//
// KEY SAFETY (critical): the API key lives only in a true ECMAScript #private field and in the
// Authorization header we build. It must never appear in error messages, serialized errors,
// provider metadata, logs, JSON.stringify, object spread, or util.inspect. Errors carry only
// { provider, model }; redactSecret strips a known key from any upstream text.

import { LlmAuthError, LlmError, LlmProviderError, LlmRateLimitError, LlmResponseFormatError } from "./errors.js";
import { redactSecret } from "./redaction.js";
import { runWithTimeout } from "./timeout.js";
import type {
  LlmCompletion, LlmFinishReason, LlmProvider, LlmProviderConfig, LlmRequest, LlmRequestOptions,
} from "./types.js";

export interface LlmTransportRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export interface LlmTransportResponse {
  status: number;
  body: unknown; // parsed JSON when possible, otherwise raw text or null
}

export type LlmTransport = (request: LlmTransportRequest) => Promise<LlmTransportResponse>;

export interface ExternalLlmProviderConfig extends LlmProviderConfig {
  transport?: LlmTransport; // injectable; defaults to a real HTTP transport
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * Real HTTP transport. The ONLY place network I/O happens. fetchImpl is injectable purely so
 * transport behavior can be unit-tested without real network. Timeout/cancellation are owned by
 * the provider (runWithTimeout); this wrapper just forwards the signal to fetch.
 */
export function createHttpLlmTransport(fetchImpl: typeof fetch = globalThis.fetch): LlmTransport {
  return async (request) => {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: request.signal,
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      try {
        body = await response.text();
      } catch {
        body = null;
      }
    }
    return { status: response.status, body };
  };
}

interface ChatCompletionShape {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

const asTokenCount = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

export class ExternalLlmProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  readonly isLocal = false;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #transport: LlmTransport;
  readonly #timeoutMs?: number;

  constructor(config: ExternalLlmProviderConfig) {
    if (!config.apiKey || !config.apiKey.trim()) {
      throw new LlmAuthError("External LLM provider requires a non-blank API key", { provider: config.id, model: config.model });
    }
    this.id = config.id;
    this.model = config.model;
    this.#apiKey = config.apiKey.trim();
    this.#baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#transport = config.transport ?? createHttpLlmTransport();
    this.#timeoutMs = config.timeoutMs;
  }

  async complete(request: LlmRequest, options?: LlmRequestOptions): Promise<LlmCompletion> {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (request.system) messages.push({ role: "system", content: request.system });
    messages.push({ role: "user", content: request.prompt });
    const payload: Record<string, unknown> = { model: this.model, messages };
    if (request.maxOutputTokens != null) payload.max_tokens = request.maxOutputTokens;
    if (request.responseFormat === "json") payload.response_format = { type: "json_object" };
    const body = JSON.stringify(payload);

    let response: LlmTransportResponse;
    try {
      response = await runWithTimeout(
        (signal) => this.#transport({
          url: `${this.#baseUrl}/chat/completions`,
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.#apiKey}` },
          body,
          signal,
        }),
        { timeoutMs: options?.timeoutMs ?? this.#timeoutMs, signal: options?.signal, provider: this.id, model: this.model },
      );
    } catch (error) {
      // runWithTimeout already throws typed LlmTimeoutError / LlmCancelledError (both LlmError);
      // re-throw any LlmError unchanged, and wrap anything else (transport/network failure).
      if (error instanceof LlmError) throw error;
      const detail = redactSecret(error instanceof Error ? error.message : String(error), this.#apiKey);
      throw new LlmProviderError(`LLM request failed: ${detail}`, { provider: this.id, model: this.model });
    }

    if (response.status === 401 || response.status === 403) {
      throw new LlmAuthError("LLM provider rejected the API key", { provider: this.id, model: this.model });
    }
    if (response.status === 429) {
      throw new LlmRateLimitError("LLM provider rate limit exceeded", { provider: this.id, model: this.model });
    }
    if (response.status < 200 || response.status >= 300) {
      throw new LlmProviderError(`LLM provider returned status ${response.status}`, { provider: this.id, model: this.model });
    }

    const choice = (response.body as ChatCompletionShape | null)?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string") {
      throw new LlmResponseFormatError("LLM response did not contain a text completion", { provider: this.id, model: this.model });
    }
    const finishReason: LlmFinishReason = choice?.finish_reason === "length" ? "length" : "stop";
    const usageRaw = (response.body as ChatCompletionShape).usage;
    const inputTokens = asTokenCount(usageRaw?.prompt_tokens);
    const outputTokens = asTokenCount(usageRaw?.completion_tokens);
    const usage = inputTokens !== undefined || outputTokens !== undefined ? { inputTokens, outputTokens } : undefined;
    return { provider: this.id, model: this.model, text: content, finishReason, usage };
  }
}

export const createExternalLlmProvider = (config: ExternalLlmProviderConfig): ExternalLlmProvider =>
  new ExternalLlmProvider(config);
