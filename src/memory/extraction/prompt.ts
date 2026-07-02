import type { ExtractionWindow } from "./types.js";

export const MEMORY_EXTRACTION_PROMPT_VERSION = "mvp-memory-extraction-v1";

export function buildMemoryExtractionPrompt(window: ExtractionWindow): string {
  return `Extract only useful source-backed memory objects from the provided spans.
Return JSON only: {"objects":[{"type":"topic|quote|question|decision|action_item|objection|advice_idea","title":"...","body":"...","evidenceSpanIds":["..."],"confidence":0.0,"reason":"..."}]}
Do not invent facts. Use only provided span IDs. Prefer fewer high-quality objects. Do not duplicate ideas.
Every object needs evidence. Generic filler is invalid. Quote bodies must use exact source wording.

${window.text}`;
}

// Grounded LLM extraction prompt: every object must carry a verbatim supportingQuote from a cited span.
// v2: bodies must stay close to the transcript's own wording (no added scope/entities/numbers), so that
// faithful extractions pass the deterministic body-quote support gate instead of landing in review.
export const MEMORY_EXTRACTION_LLM_PROMPT_VERSION = "mvp-memory-extraction-llm-v2";

export const MEMORY_EXTRACTION_LLM_SYSTEM =
  "You extract source-backed memory objects strictly from the transcript spans provided. Use ONLY the listed spans; never invent facts or cite span_ids that are not listed. Every object must include a supportingQuote copied verbatim from one of the spans it cites. Write each body using the speaker's own wording as closely as possible — do not add names, entities, numbers, quantifiers (all/every/always/only), or commitments the cited span does not state, and do not soften or strengthen what was said. Prefer fewer high-quality objects. Respond with JSON only.";

export function buildLlmMemoryExtractionPrompt(window: ExtractionWindow): string {
  return [
    'Extract memory objects as JSON: {"objects":[{"type":"topic|quote|question|decision|action_item|objection|advice_idea","title":"...","body":"...","evidenceSpanIds":["<span_id>"],"supportingQuote":"<verbatim substring of a cited span>"}]}',
    'Cite only the span_ids below. Each object must include a supportingQuote copied verbatim from one cited span. Keep each body close to the span\'s own wording — no added scope, entities, numbers, or stronger/weaker commitments. If nothing is well supported, return {"objects":[]}.',
    "",
    "Spans:",
    window.text,
  ].join("\n");
}
