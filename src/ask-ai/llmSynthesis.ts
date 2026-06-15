// Grounded LLM Ask AI synthesis adapter.
//
// Implements the existing AskAILanguageModel seam on top of a transport-level LlmProvider. It does
// the two things the downstream pipeline does NOT do for free-text LLM output:
//   1. structured-output shape validation (the LLM JSON is parsed and every claim is shape-checked), and
//   2. claim<->evidence grounding (each claim must include a supportingQuote that is a normalized
//      substring of one of the SELECTED evidence snippets it cites).
//
// Trust rules upheld here:
//   - LLM output cannot create evidence and cannot cite pointers that were not selected before
//     synthesis (subset check against the evidence passed in).
//   - Ungrounded claims (no supportingQuote, or a quote not found in a cited snippet) are discarded.
//   - On malformed output / provider failure / timeout, generateClaims throws LlmSynthesisError so the
//     caller (claimGeneration) falls back to deterministic claims. The error is key-free; provider
//     internals/API keys are never logged, persisted, or surfaced.
// The deterministic fallback, weak/conflict warnings, citation building, repository and DB provenance
// backstops all remain in their existing places — this adapter only produces grounded claim candidates.

import type { LlmProvider, LlmRequestOptions } from "../llm/index.js";
import type { AskAIEvidenceItem, AskAILanguageModel, ClaimKind, QueryUnderstanding } from "./types.js";

export class LlmSynthesisError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LlmSynthesisError";
  }
}

const CLAIM_KINDS: readonly ClaimKind[] = ["fact", "pattern", "inference", "recommendation"];

export interface GroundedLlmClaim {
  kind: ClaimKind;
  text: string;
  evidencePointerIds: string[];
  explanation?: string;
}

const normalizeForMatch = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim();

/** Build the grounded synthesis prompt. The model sees only the selected snippets it may cite. */
export function buildSynthesisPrompt(query: QueryUnderstanding, evidence: AskAIEvidenceItem[]): { system: string; prompt: string } {
  const items = evidence
    .map((item, index) => `${index + 1}. pointerId: ${item.evidencePointerId}\n   quote: ${item.quotePreview}`)
    .join("\n");
  const system = [
    "You answer questions strictly from the transcript evidence provided.",
    "Use ONLY the listed evidence; never use outside knowledge or invent facts.",
    "Cite evidence by its exact pointerId. Each claim must include a supportingQuote copied verbatim from one of the quotes you cite.",
    "If the evidence does not support an answer, return an empty claims array. Respond with JSON only.",
  ].join(" ");
  const prompt = [
    `Question: ${query.originalQuestion}`,
    "",
    "Evidence:",
    items,
    "",
    'Return JSON of the form: {"claims":[{"kind":"fact|pattern|inference|recommendation","text":"...","evidencePointerIds":["<pointerId>"],"supportingQuote":"<verbatim substring of a cited quote>","explanation":"<optional>"}]}',
  ].join("\n");
  return { system, prompt };
}

/**
 * Parse the LLM JSON and return only grounded claims. Throws LlmSynthesisError on malformed output.
 * A claim survives only if: kind is valid, text is a non-empty string, it cites at least one SELECTED
 * pointer, it includes a supportingQuote, and that quote normalize-matches a substring of a cited snippet.
 */
export function parseAndGroundClaims(rawText: string, evidence: AskAIEvidenceItem[]): GroundedLlmClaim[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new LlmSynthesisError("LLM synthesis output was not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { claims?: unknown }).claims)) {
    throw new LlmSynthesisError("LLM synthesis output did not contain a claims array");
  }
  const snippetByPointer = new Map(evidence.map((item) => [item.evidencePointerId, normalizeForMatch(item.quotePreview)]));
  const grounded: GroundedLlmClaim[] = [];
  for (const raw of (parsed as { claims: unknown[] }).claims) {
    if (!raw || typeof raw !== "object") continue;
    const candidate = raw as Record<string, unknown>;

    const kind = candidate.kind;
    if (typeof kind !== "string" || !CLAIM_KINDS.includes(kind as ClaimKind)) continue;

    const text = candidate.text;
    if (typeof text !== "string" || !text.trim()) continue;

    const ids = candidate.evidencePointerIds;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) continue;
    const pointerIds = [...new Set(ids as string[])].filter((id) => snippetByPointer.has(id));
    if (!pointerIds.length) continue; // cites only unselected evidence -> discard

    const quote = candidate.supportingQuote;
    if (typeof quote !== "string" || !quote.trim()) continue; // a supportingQuote is required

    const needle = normalizeForMatch(quote);
    const anchored = needle.length > 0 && pointerIds.some((id) => snippetByPointer.get(id)?.includes(needle));
    if (!anchored) continue; // supportingQuote not found in any cited snippet -> ungrounded -> discard

    const explanation = typeof candidate.explanation === "string" ? candidate.explanation : undefined;
    grounded.push({ kind: kind as ClaimKind, text: text.trim(), evidencePointerIds: pointerIds, explanation });
  }
  return grounded;
}

/** Adapt a transport-level LlmProvider to the AskAILanguageModel claim seam, with grounding validation. */
export function createLlmAskAILanguageModel(provider: LlmProvider, options: { timeoutMs?: number } = {}): AskAILanguageModel {
  return {
    async generateClaims({ query, evidence }) {
      const { system, prompt } = buildSynthesisPrompt(query, evidence);
      const requestOptions: LlmRequestOptions = {};
      if (options.timeoutMs != null) requestOptions.timeoutMs = options.timeoutMs;
      let text: string;
      try {
        text = (await provider.complete({ system, prompt, responseFormat: "json" }, requestOptions)).text;
      } catch {
        // Provider/transport/timeout failure. Never surface provider internals or keys; the caller
        // (claimGeneration) catches LlmSynthesisError and falls back to deterministic claims.
        throw new LlmSynthesisError("LLM synthesis request failed");
      }
      return parseAndGroundClaims(text, evidence);
    },
  };
}
