// Local deterministic LLM provider — the offline default/fallback.
//
// Fully offline and deterministic: same request always yields the same completion, with no
// network, no Date, and no randomness. This is a TRANSPORT placeholder that satisfies the
// LlmProvider contract; it is NOT semantic synthesis. The deterministic Ask AI claim fallback
// continues to live in src/ask-ai/claimGeneration.ts and is unaffected by this module.

import type { LlmCompletion, LlmProvider, LlmRequest, LlmRequestOptions } from "./types.js";

export class LocalDeterministicLlmProvider implements LlmProvider {
  readonly id = "local-deterministic";
  readonly isLocal = true;
  constructor(readonly model = "local-deterministic-v1") {}

  // Resolves instantly with no I/O, so signal/timeout are accepted (interface parity) but unused.
  async complete(request: LlmRequest, _options?: LlmRequestOptions): Promise<LlmCompletion> {
    const text =
      request.responseFormat === "json"
        ? JSON.stringify({ echo: request.prompt, system: request.system ?? null })
        : `[local-deterministic] ${request.prompt.trim()}`;
    return { provider: this.id, model: this.model, text, finishReason: "stop" };
  }
}
