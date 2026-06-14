// Real external (OpenAI-compatible) embedding provider, behind the existing EmbeddingProvider
// interface. It is used ONLY when explicitly configured with a non-blank API key (the resolver
// in embeddingSpace.ts otherwise falls back to local token-hash-v1).
//
// Network access goes through an injectable EmbeddingTransport so tests never touch the network.
// The default HTTP transport (createHttpEmbeddingTransport) is the only place that performs real
// I/O and the only place timeoutMs is honored.
//
// KEY SAFETY (critical): the API key lives only in the Authorization header we build. It must
// never appear in error messages, serialized errors, provider metadata, or logs. indexer.ts
// persists error.message into retrieval_index_status.error, so every error here is key-free by
// construction (errors carry only { provider, model, status }), and redactSecret strips a known
// secret from any upstream text before it is ever included.

import type { EmbeddingProvider } from "./embeddingProvider.js";

export interface EmbeddingTransportRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface EmbeddingTransportResponse {
  status: number;
  body: unknown; // parsed JSON when possible, otherwise raw text or null
}

export type EmbeddingTransport = (request: EmbeddingTransportRequest) => Promise<EmbeddingTransportResponse>;

export interface ExternalEmbeddingConfig {
  provider: string; // becomes EmbeddingProvider.name, e.g. "openai"
  model: string;
  dimensions: number;
  apiKey?: string;
  baseUrl?: string; // default "https://api.openai.com/v1"
  transport?: EmbeddingTransport; // injectable; defaults to a real HTTP transport
  timeoutMs?: number; // optional; applied in the HTTP transport only
}

export interface EmbeddingErrorContext {
  provider?: string;
  model?: string;
  status?: number;
}

export class EmbeddingError extends Error {
  readonly context?: EmbeddingErrorContext;
  constructor(message: string, context?: EmbeddingErrorContext, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.context = context;
  }
}
/** Missing/invalid API key, or an upstream 401/403. */
export class EmbeddingAuthError extends EmbeddingError {}
/** Upstream 429. */
export class EmbeddingRateLimitError extends EmbeddingError {}
/** Other non-2xx response, or a transport-level failure. */
export class EmbeddingProviderError extends EmbeddingError {}
/** The response body was malformed or returned vectors of the wrong dimension. */
export class EmbeddingResponseError extends EmbeddingError {}

const REDACTED = "[redacted]";

/** Strip a known secret from arbitrary text before it is surfaced or stored. No-op when blank. */
export function redactSecret(text: string, secret: string | null | undefined): string {
  if (!secret || !secret.trim()) return text;
  return text.split(secret).join(REDACTED);
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * Real HTTP transport. The ONLY place network I/O happens and the ONLY place timeoutMs is honored.
 * fetchImpl is injectable purely so the timeout path can be unit-tested without real network.
 */
export function createHttpEmbeddingTransport(fetchImpl: typeof fetch = globalThis.fetch): EmbeddingTransport {
  return async (request) => {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    request.signal?.addEventListener("abort", onExternalAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (request.timeoutMs != null) timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
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
    } finally {
      if (timer) clearTimeout(timer);
      request.signal?.removeEventListener("abort", onExternalAbort);
    }
  };
}

interface EmbeddingResponseShape {
  data?: Array<{ embedding?: unknown; index?: number }>;
}

export class ExternalEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly transport: EmbeddingTransport;
  private readonly timeoutMs?: number;

  constructor(config: ExternalEmbeddingConfig) {
    if (!config.apiKey || !config.apiKey.trim()) {
      throw new EmbeddingAuthError("External embedding provider requires a non-blank API key", { provider: config.provider, model: config.model });
    }
    if (!Number.isInteger(config.dimensions) || config.dimensions <= 0) {
      throw new EmbeddingResponseError("External embedding provider requires positive integer dimensions", { provider: config.provider, model: config.model });
    }
    this.name = config.provider;
    this.model = config.model;
    this.dimensions = config.dimensions;
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.transport = config.transport ?? createHttpEmbeddingTransport();
    this.timeoutMs = config.timeoutMs;
  }

  private context(status?: number): EmbeddingErrorContext {
    return { provider: this.name, model: this.model, status };
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    let response: EmbeddingTransportResponse;
    try {
      response = await this.transport({
        url: `${this.baseUrl}/embeddings`,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, input: texts }),
        timeoutMs: this.timeoutMs,
      });
    } catch (error) {
      // Transport/network failure. Strip the key in case an upstream message echoed it.
      const detail = redactSecret(error instanceof Error ? error.message : String(error), this.apiKey);
      throw new EmbeddingProviderError(`Embedding request failed: ${detail}`, this.context());
    }

    if (response.status === 401 || response.status === 403) {
      throw new EmbeddingAuthError("Embedding provider rejected the API key", this.context(response.status));
    }
    if (response.status === 429) {
      throw new EmbeddingRateLimitError("Embedding provider rate limit exceeded", this.context(response.status));
    }
    if (response.status < 200 || response.status >= 300) {
      throw new EmbeddingProviderError(`Embedding provider returned status ${response.status}`, this.context(response.status));
    }

    const data = (response.body as EmbeddingResponseShape | null)?.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new EmbeddingResponseError("Embedding response did not contain one vector per input", this.context(response.status));
    }
    const ordered = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return ordered.map((item) => {
      const vector = item.embedding;
      if (!Array.isArray(vector) || vector.length !== this.dimensions || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
        throw new EmbeddingResponseError(`Embedding response vector did not match expected ${this.dimensions} finite dimensions`, this.context(response.status));
      }
      return vector as number[];
    });
  }
}

export const createExternalEmbeddingProvider = (config: ExternalEmbeddingConfig): ExternalEmbeddingProvider =>
  new ExternalEmbeddingProvider(config);
