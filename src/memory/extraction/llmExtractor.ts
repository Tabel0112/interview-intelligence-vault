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
//   - The LLM's SELF-REPORTED confidence number is IGNORED. A surviving candidate instead earns a fixed
//     grounding-based confidence (GROUNDED_CONFIDENCE) assessed by the PIPELINE — it is awarded only
//     because the candidate anchored to an exact substring of a cited in-window span, not because the
//     model claimed to be confident. The calibrated status policy (scoreCandidateConfidence) then
//     decides active vs needs_review from deterministic signals (specificity, type, tentative phrasing),
//     and the pipeline still routes near-duplicates and active-conflicting statements to review.
//   - On malformed JSON, provider/transport/timeout failure, empty output, or all-discarded output,
//     extraction falls back to the deterministic extractor FOR THAT WINDOW.
//   - The grounded supportingQuote (a substring of immutable transcript text) is carried in `reason`
//     so the pipeline persists it to metadata_json for audit. No keys/prompts/headers/provider
//     internals/upstream errors are ever surfaced or stored — errors are key-free and swallowed into
//     the deterministic fallback.

import type { LlmProvider, LlmRequestOptions } from "../../llm/index.js";
import { buildLlmMemoryExtractionPrompt, MEMORY_EXTRACTION_LLM_PROMPT_VERSION, MEMORY_EXTRACTION_LLM_SYSTEM } from "./prompt.js";
import type { ExtractedMemoryCandidate, ExtractionMemoryObjectType, ExtractionWindow, MemoryExtractor } from "./types.js";

export class MemoryExtractionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MemoryExtractionError";
  }
}

const VALID_TYPES: readonly ExtractionMemoryObjectType[] = ["topic", "quote", "question", "decision", "action_item", "objection", "advice_idea"];
const normalizeForMatch = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim();

// Pipeline-assessed confidence for a candidate that survived grounding (anchored to an exact substring
// of a cited in-window span). This is NOT the LLM's self-report — it is the trust the pipeline assigns
// to a grounded candidate. The calibrated status policy still gates active vs review from there.
const GROUNDED_CONFIDENCE = 0.9;

interface RawObject {
  type?: unknown; title?: unknown; body?: unknown; evidenceSpanIds?: unknown; supportingQuote?: unknown;
}

/**
 * Parse the LLM JSON and return only grounded candidates. Throws MemoryExtractionError on malformed
 * output. A candidate survives only if: valid type, non-empty title/body, it cites at least one span
 * INSIDE the window, it includes a supportingQuote, and that quote normalize-matches a substring of a
 * cited span's text. The LLM-reported confidence is not used; a surviving candidate gets the pipeline's
 * grounding confidence (GROUNDED_CONFIDENCE). The grounded supportingQuote is stored in `reason` for audit.
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
      confidence: GROUNDED_CONFIDENCE, // pipeline-assessed grounding confidence, NOT the LLM's self-report (see header)
      reason: quote.trim(), // grounded supportingQuote -> persisted in metadata_json.extraction_reason for audit
    });
  }
  return grounded;
}

export interface LlmMemoryExtractorOptions {
  /**
   * OPTIONAL deterministic extractor used per-window when the LLM fails or returns malformed output.
   * The live app does NOT pass a fallback — it must not fabricate deterministic memory; failures throw
   * (key-free) and the run is recorded as failed. Pass a fallback only from explicit dev/test seams.
   */
  fallback?: MemoryExtractor;
  timeoutMs?: number;
}

export function createLlmMemoryExtractor(provider: LlmProvider, options: LlmMemoryExtractorOptions = {}): MemoryExtractor {
  const fallback = options.fallback;
  return {
    kind: "llm",
    model: provider.model,
    promptVersion: MEMORY_EXTRACTION_LLM_PROMPT_VERSION,
    async extract(window) {
      const requestOptions: LlmRequestOptions = {};
      if (options.timeoutMs != null) requestOptions.timeoutMs = options.timeoutMs;
      let text: string;
      try {
        text = (await provider.complete({ system: MEMORY_EXTRACTION_LLM_SYSTEM, prompt: buildLlmMemoryExtractionPrompt(window), responseFormat: "json" }, requestOptions)).text;
      } catch {
        // Provider/transport/timeout failure. Never surface keys/internals.
        if (fallback) return fallback.extract(window);
        throw new MemoryExtractionError("LLM memory extraction request failed");
      }
      let grounded: ExtractedMemoryCandidate[];
      try {
        grounded = parseAndGroundMemoryCandidates(text, window);
      } catch {
        if (fallback) return fallback.extract(window); // malformed JSON -> fallback (test seam only)
        throw new MemoryExtractionError("LLM memory extraction output was not valid");
      }
      // Empty / all-discarded is a legitimate "nothing groundable in this window" -> no memory (not an error).
      return grounded.length ? grounded : fallback ? fallback.extract(window) : grounded;
    },
  };
}
