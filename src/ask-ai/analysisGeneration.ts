// LIVE-ONLY AI analysis generation (Step 2 Option A).
//
// Produces clearly-labeled, NON-transcript analysis/recommendations/frameworks for advice/strategy/planning
// prompts whose answer contract permits general reasoning. This is deliberately NOT grounded in transcript
// evidence and is NEVER persisted:
//   - every item is built by buildAnalysisClaim() with supportStatus "ai_analysis", empty evidence pointers
//     and empty citation ids, and the fixed AI_ANALYSIS_WARNING disclaimer;
//   - the LLM is instructed to NOT present recommendations as transcript facts, NOT invent vault facts, and
//     cite nothing. Selected evidence is passed only as non-citable context.
// Trust: analysis can never be cited, supported, or promoted into memory/evidence. Provider failure / bad
// output degrades to NO analysis (best-effort enrichment) — it never fabricates transcript facts and never
// breaks the evidence-first factual answer.

import { createHash } from "node:crypto";
import type { LlmProvider, LlmRequestOptions } from "../llm/index.js";
import { AI_ANALYSIS_WARNING, type AskAIAnalysisClaim, type AskAIAnalysisModel, type AskAIEvidenceItem, type ClaimKind, type QueryUnderstanding } from "./types.js";

const ANALYSIS_KINDS: readonly ClaimKind[] = ["recommendation", "inference", "pattern", "fact"];
const stableId = (value: string) => `aianalysis_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;

/** Build a trust-safe analysis claim. Pointers/citations are ALWAYS empty; status is the fixed marker. */
export function buildAnalysisClaim(index: number, item: { kind: ClaimKind; text: string; explanation?: string }): AskAIAnalysisClaim {
  return {
    id: stableId(`${index}:${item.kind}:${item.text}`),
    kind: item.kind,
    text: item.text.trim(),
    supportStatus: "ai_analysis",
    evidencePointerIds: [],
    citationIds: [],
    warning: AI_ANALYSIS_WARNING,
    explanation: item.explanation,
  };
}

export const ANALYSIS_SYSTEM = [
  "You provide general analysis, recommendations, and frameworks based on reasoning — NOT facts from the user's transcripts or vault.",
  "Do NOT claim anything comes from the transcripts. Do NOT invent specific vault facts, names, numbers, decisions, or quotes.",
  "Cite nothing. The provided evidence is non-citable background only; if it is missing or weak, say so plainly.",
  "Keep items concise and clearly actionable. Label them as recommendation or inference. Respond with JSON only.",
].join(" ");

/** The analysis prompt. Selected evidence is summarized as NON-CITABLE context, never as facts to repeat. */
export function buildAnalysisPrompt(query: QueryUnderstanding, evidence: AskAIEvidenceItem[]): string {
  const context = evidence.length
    ? evidence.slice(0, 5).map((item, index) => `${index + 1}. ${item.quotePreview}`).join("\n")
    : "(no transcript evidence was found for this question)";
  return [
    `Question: ${query.originalQuestion}`,
    "",
    "Non-citable background context (do NOT repeat as fact, do NOT cite):",
    context,
    "",
    'Return JSON: {"analysis":[{"kind":"recommendation|inference","text":"...","explanation":"<optional>"}]}',
    "Provide a few high-value recommendations or framings. If transcript evidence is missing or weak, note that the analysis is reasoning, not transcript-backed.",
  ].join("\n");
}

/** Parse the analysis JSON into trust-safe claims. Returns [] on malformed/empty output (never throws). */
export function parseAnalysisClaims(rawText: string): AskAIAnalysisClaim[] {
  let parsed: unknown;
  try { parsed = JSON.parse(rawText); } catch { return []; }
  const items = (parsed as { analysis?: unknown })?.analysis;
  if (!Array.isArray(items)) return [];
  const claims: AskAIAnalysisClaim[] = [];
  items.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const candidate = raw as Record<string, unknown>;
    const text = candidate.text;
    if (typeof text !== "string" || !text.trim()) return;
    const kind = typeof candidate.kind === "string" && ANALYSIS_KINDS.includes(candidate.kind as ClaimKind) ? candidate.kind as ClaimKind : "recommendation";
    const explanation = typeof candidate.explanation === "string" ? candidate.explanation : undefined;
    claims.push(buildAnalysisClaim(index, { kind, text, explanation }));
  });
  return claims;
}

/** Adapt a transport-level LlmProvider to the live AI-analysis seam. Best-effort: errors -> no analysis. */
export function createLlmAskAIAnalysisModel(provider: LlmProvider, options: { timeoutMs?: number } = {}): AskAIAnalysisModel {
  return {
    async analyze({ query, evidence }) {
      const requestOptions: LlmRequestOptions = {};
      if (options.timeoutMs != null) requestOptions.timeoutMs = options.timeoutMs;
      let text: string;
      try {
        text = (await provider.complete({ system: ANALYSIS_SYSTEM, prompt: buildAnalysisPrompt(query, evidence), responseFormat: "json" }, requestOptions)).text;
      } catch {
        return []; // provider/transport/timeout failure -> no analysis (never fabricate; never break the answer)
      }
      // Return raw shape; the pipeline owns trust normalization via buildAnalysisClaim.
      return parseAnalysisClaims(text).map((claim) => ({ kind: claim.kind, text: claim.text, explanation: claim.explanation }));
    },
  };
}
