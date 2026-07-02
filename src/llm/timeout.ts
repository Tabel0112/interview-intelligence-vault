// Timeout / cancellation shape for LLM calls.
//
// Establishes the contract a future network provider will use: callers pass an optional
// AbortSignal and/or timeoutMs; the operation receives a linked AbortSignal it can honor.
// The local/mock providers in this module use it to simulate hangs and cancellation.

import { LlmCancelledError, LlmTimeoutError, type LlmErrorContext } from "./errors.js";

export interface RunWithTimeoutOptions extends LlmErrorContext {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Run `operation` with an optional timeout and external cancellation.
 *  - A pre-aborted external signal throws LlmCancelledError before the operation starts.
 *  - Exceeding `timeoutMs` aborts the operation and throws LlmTimeoutError.
 *  - An external abort after start throws LlmCancelledError.
 * The operation is handed a linked AbortSignal so it can stop work promptly.
 */
export async function runWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: RunWithTimeoutOptions = {},
): Promise<T> {
  const context: LlmErrorContext = { provider: options.provider, model: options.model };
  if (options.signal?.aborted) throw new LlmCancelledError("LLM request was cancelled", context);

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = options.timeoutMs != null
    ? new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new LlmTimeoutError(`LLM request timed out after ${options.timeoutMs}ms`, context));
        }, options.timeoutMs);
      })
    : null;

  try {
    return await (timeout ? Promise.race([operation(controller.signal), timeout]) : operation(controller.signal));
  } catch (error) {
    if (timedOut) throw error instanceof LlmTimeoutError ? error : new LlmTimeoutError(`LLM request timed out after ${options.timeoutMs}ms`, context);
    if (options.signal?.aborted) throw new LlmCancelledError("LLM request was cancelled", context);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }
}
