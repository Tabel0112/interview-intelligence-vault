// Secret-safety helpers. The single chokepoint for turning provider config into something
// log-safe. API keys must never reach logs, errors, health, or persisted state.

import type { LlmProviderConfig, RedactedLlmProviderConfig } from "./types.js";

export const REDACTED = "[redacted]";

/** Log-safe view of a provider config: the key is replaced by a boolean. */
export function redactProviderConfig(config: LlmProviderConfig): RedactedLlmProviderConfig {
  const redacted: RedactedLlmProviderConfig = {
    id: config.id,
    model: config.model,
    hasApiKey: Boolean(config.apiKey && config.apiKey.trim().length > 0),
  };
  if (config.baseUrl !== undefined) redacted.baseUrl = config.baseUrl;
  if (config.timeoutMs !== undefined) redacted.timeoutMs = config.timeoutMs;
  return redacted;
}

/**
 * Defense-in-depth: strip a known secret from arbitrary text (e.g. an upstream error string)
 * before it is surfaced or logged. No-op when the secret is empty.
 */
export function redactSecret(text: string, secret: string | null | undefined): string {
  if (!secret || !secret.trim()) return text;
  return text.split(secret).join(REDACTED);
}
