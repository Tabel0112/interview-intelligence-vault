import type { ExtractionWindow } from "./types.js";

export const MEMORY_EXTRACTION_PROMPT_VERSION = "mvp-memory-extraction-v1";

export function buildMemoryExtractionPrompt(window: ExtractionWindow): string {
  return `Extract only useful source-backed memory objects from the provided spans.
Return JSON only: {"objects":[{"type":"topic|quote|question|decision|action_item|objection|advice_idea","title":"...","body":"...","evidenceSpanIds":["..."],"confidence":0.0,"reason":"..."}]}
Do not invent facts. Use only provided span IDs. Prefer fewer high-quality objects. Do not duplicate ideas.
Every object needs evidence. Generic filler is invalid. Quote bodies must use exact source wording.

${window.text}`;
}
