// Grounded LLM-backed memory extractor.
//
// Wraps a transport-level LlmProvider as a MemoryExtractor. It does the grounding the deterministic
// pipeline does NOT do for free-text LLM output:
//   - every candidate must cite span_ids that are inside the extraction window (LLM cannot invent or
//     cite spans it was not given), and
//   - every candidate must include a supportingQuote that normalize-matches a substring of a cited
//     span's text. Ungrounded candidates are discarded.
//
// Trust rules upheld here:
//   - LLM output cannot create source spans or cite spans outside the window.
//   - The LLM's self-reported confidence is IGNORED (set to 0); the pipeline additionally caps every
//     LLM candidate to needs_review, so LLM output can never auto-promote to trusted/active memory.
//   - On malformed JSON, provider/transport/timeout failure, empty output, or all-discarded output,
//     extraction falls back to the deterministic extractor FOR THAT WINDOW.
//   - The grounded supportingQuote (a substring of immutable transcript text) is carried in `reason`
//     so the pipeline persists it to metadata_json for audit. No keys/prompts/headers/provider
//     internals/upstream errors are ever surfaced or stored — errors are key-free and swallowed into
//     the deterministic fallback.

import type { LlmProvider, LlmRequestOptions } from "../../llm/index.js";
import { buildLlmMemoryExtractionPrompt, MEMORY_EXTRACTION_LLM_SYSTEM } from "./prompt.js";
import type { ExtractedMemoryCandidate, ExtractionMemoryObjectType, ExtractionWindow, MemoryExtractor } from "./types.js";

export class MemoryExtractionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MemoryExtractionError";
  }
}

const VALID_TYPES: readonly ExtractionMemoryObjectType[] = ["topic", "quote", "question", "decision", "action_item", "objection", "advice_idea"];
const normalizeForMatch = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim();

interface RawObject {
  type?: unknown; title?: unknown; body?: unknown; evidenceSpanIds?: unknown; supportingQuote?: unknown;
}

/**
 * Parse the LLM JSON and return only grounded candidates. Throws MemoryExtractionError on malformed
 * output. A candidate survives only if: valid type, non-empty title/body, it cites at least one span
 * INSIDE the window, it includes a supportingQuote, and that quote normalize-matches a substring of a
 * cited span's text. The LLM-reported confidence is not used (set to 0); the grounded supportingQuote
 * is stored in `reason` for audit.
 */
export function parseAndGroundMemoryCandidates(rawText: string, window: ExtractionWindow): ExtractedMemoryCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new MemoryExtractionError("LLM memory extraction output was not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { objects?: unknown }).objects)) {
    throw new MemoryExtractionError("LLM memory extraction output did not contain an objects array");
  }
  const spanTextById = new Map(window.spans.map((span) => [span.spanId, normalizeForMatch(span.text)]));
  const grounded: ExtractedMemoryCandidate[] = [];
  for (const raw of (parsed as { objects: unknown[] }).objects) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as RawObject;

    if (typeof candidate.type !== "string" || !VALID_TYPES.includes(candidate.type as ExtractionMemoryObjectType)) continue;
    if (typeof candidate.title !== "string" || !candidate.title.trim()) continue;
    if (typeof candidate.body !== "string" || !candidate.body.trim()) continue;

    const ids = candidate.evidenceSpanIds;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) continue;
    const evidenceSpanIds = [...new Set(ids as string[])].filter((id) => spanTextById.has(id)); // only spans in the window
    if (!evidenceSpanIds.length) continue; // cites only out-of-window spans -> discard

    const quote = candidate.supportingQuote;
    if (typeof quote !== "string" || !quote.trim()) continue; // a supportingQuote is required

    const needle = normalizeForMatch(quote);
    const anchored = needle.length > 0 && evidenceSpanIds.some((id) => spanTextById.get(id)?.includes(needle));
    if (!anchored) continue; // supportingQuote not found in any cited span -> ungrounded -> discard

    grounded.push({
      type: candidate.type as ExtractionMemoryObjectType,
      title: candidate.title.trim(),
      body: candidate.body.trim(),
      evidenceSpanIds,
      confidence: 0, // LLM self-reported confidence is NOT trusted; the pipeline caps LLM candidates to needs_review
      reason: quote.trim(), // grounded supportingQuote -> persisted in metadata_json.extraction_reason for audit
    });
  }
  return grounded;
}

export interface LlmMemoryExtractorOptions {
  /** Deterministic extractor used per-window when the LLM fails, returns malformed/empty, or all candidates are discarded. */
  fallback: MemoryExtractor;
  timeoutMs?: number;
}

export function createLlmMemoryExtractor(provider: LlmProvider, options: LlmMemoryExtractorOptions): MemoryExtractor {
  const fallback = options.fallback;
  return {
    kind: "llm",
    model: provider.model,
    async extract(window) {
      const requestOptions: LlmRequestOptions = {};
      if (options.timeoutMs != null) requestOptions.timeoutMs = options.timeoutMs;
      let text: string;
      try {
        text = (await provider.complete({ system: MEMORY_EXTRACTION_LLM_SYSTEM, prompt: buildLlmMemoryExtractionPrompt(window), responseFormat: "json" }, requestOptions)).text;
      } catch {
        // Provider/transport/timeout failure -> deterministic fallback for this window. Never surface keys/internals.
        return fallback.extract(window);
      }
      let grounded: ExtractedMemoryCandidate[];
      try {
        grounded = parseAndGroundMemoryCandidates(text, window);
      } catch {
        return fallback.extract(window); // malformed JSON -> fallback
      }
      return grounded.length ? grounded : fallback.extract(window); // empty / all-discarded -> fallback
    },
  };
}
