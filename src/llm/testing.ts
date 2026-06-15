// Programmable mock LLM provider for tests. This is a TEST DOUBLE and is intentionally NOT
// re-exported from ./index.ts, so production code can never import it. Test files import it
// directly from "../src/llm/testing.js".

import { LlmCancelledError } from "./errors.js";
import type { LlmCompletion, LlmProvider, LlmRequest, LlmRequestOptions } from "./types.js";

export interface MockLlmBehavior {
  /** Fixed completion, or a function of the request. */
  completion?: LlmCompletion | ((request: LlmRequest) => LlmCompletion);
  /** Reject with this error instead of completing. */
  error?: Error;
  /** Never resolve until the request is aborted (drives timeout/cancellation tests). */
  hang?: boolean;
}

export interface MockLlmMeta {
  id?: string;
  model?: string;
  isLocal?: boolean;
}

export class MockLlmProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  readonly isLocal: boolean;
  readonly calls: LlmRequest[] = [];

  constructor(private behavior: MockLlmBehavior = {}, meta: MockLlmMeta = {}) {
    this.id = meta.id ?? "mock";
    this.model = meta.model ?? "mock-model";
    this.isLocal = meta.isLocal ?? false;
  }

  setBehavior(behavior: MockLlmBehavior): void {
    this.behavior = behavior;
  }

  complete(request: LlmRequest, options?: LlmRequestOptions): Promise<LlmCompletion> {
    this.calls.push(request);
    if (this.behavior.error) return Promise.reject(this.behavior.error);
    if (this.behavior.hang) {
      return new Promise<LlmCompletion>((_resolve, reject) => {
        if (options?.signal?.aborted) {
          reject(new LlmCancelledError("LLM request was cancelled", { provider: this.id, model: this.model }));
          return;
        }
        options?.signal?.addEventListener(
          "abort",
          () => reject(new LlmCancelledError("LLM request was cancelled", { provider: this.id, model: this.model })),
          { once: true },
        );
      });
    }
    const completion = typeof this.behavior.completion === "function" ? this.behavior.completion(request) : this.behavior.completion;
    return Promise.resolve(completion ?? { provider: this.id, model: this.model, text: "", finishReason: "stop" });
  }
}
