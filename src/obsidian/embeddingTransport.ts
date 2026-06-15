// Obsidian requestUrl-based embedding transport.
//
// Lives in the obsidian layer (it imports the Obsidian runtime) so the pure wiring in
// embeddingSettings.ts stays testable without Obsidian. Used ONLY by the explicit
// "Rebuild Embedding Index" command — never on startup or from the settings screen.
//
// requestUrl is used instead of fetch so requests are not subject to renderer CORS. The API key
// travels only in the Authorization header that the external provider builds; nothing here logs it.
//
// Note: requestUrl does not support AbortSignal, so the embedding config's `timeoutMs` applies only
// to the fetch-based createHttpEmbeddingTransport, not to this transport.

import { requestUrl } from "obsidian";
import type { EmbeddingTransport } from "../retrieval/index.js";

export function createObsidianEmbeddingTransport(): EmbeddingTransport {
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
