// Obsidian requestUrl-based LLM transport seam.
//
// Lives in the obsidian layer (it imports the Obsidian runtime) so the pure adapter in
// llmSettings.ts stays testable without Obsidian. This is NOT consumed yet — Ask AI synthesis is
// not wired. It exists so that, when synthesis is wired later, the LLM provider can be driven via
// requestUrl (not fetch) to avoid renderer CORS. It must never be invoked from settings, startup,
// saveSettings, or the settings screen.
//
// The API key travels only in the Authorization header that the external provider builds; nothing
// here logs it. Note: requestUrl has no AbortSignal, so the provider's runWithTimeout-based
// timeout/cancellation (which forwards a signal to the transport) cannot abort an in-flight
// requestUrl call — the timeout still rejects the caller; the request itself completes in the
// background.

import { requestUrl } from "obsidian";
import type { LlmTransport } from "../llm/index.js";

export function createObsidianLlmTransport(): LlmTransport {
  return async (request) => {
    const response = await requestUrl({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body,
      throw: false,
    });
    let body: unknown = null;
    try {
      body = response.json;
    } catch {
      body = response.text ?? null;
    }
    return { status: response.status, body };
  };
}
