import { createHash } from "node:crypto";
import { SynthesisFailedError, SynthesisSetupRequiredError } from "./errors.js";
import { intentPrefersEvidenceSynthesis } from "./queryUnderstanding.js";
import type { AskAILanguageModel, AskAIClaim, AskAICitation, AskAIEvidenceItem, ClaimKind, ClaimSupportStatus, EvidenceConfidence, QueryUnderstanding } from "./types.js";

const stableId = (value: string) => `aiclaim_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
const supportStatus = (confidence: EvidenceConfidence): ClaimSupportStatus =>
  confidence === "strong" || confidence === "mixed" ? "supported" : confidence === "conflicting" ? "conflicting" : confidence === "weak" ? "weakly_supported" : "unsupported";

function defaultClaimText(kind: ClaimKind, evidence: AskAIEvidenceItem[]): string {
  const quote = evidence[0]?.quotePreview.replace(/^[^:]{1,80}:\s*/, "").trim() ?? "";
  if (kind === "inference") return `Inference: ${quote}`;
  if (kind === "recommendation") return `Recommendation based on the available transcript evidence: ${quote}`;
  if (kind === "pattern") return evidence.length > 1 ? `Pattern across the selected evidence: ${quote}` : `Tentative pattern from limited evidence: ${quote}`;
  return quote;
}

export async function generateClaimsFromEvidence(
  query: QueryUnderstanding,
  evidence: AskAIEvidenceItem[],
  citations: AskAICitation[],
  options: { confidence: EvidenceConfidence; llm?: AskAILanguageModel; requireLlm?: boolean; onSynthesis?: (mode: "llm" | "deterministic" | "conflict") => void } ,
): Promise<AskAIClaim[]> {
  if (!evidence.length || options.confidence === "no_evidence") return [];
  const citationByPointer = new Map(citations.map((item) => [item.evidencePointerId, item]));
  const selectedPointers = new Set(evidence.map((item) => item.evidencePointerId));
  const kinds = query.requestedClaimKinds.length ? query.requestedClaimKinds : ["fact" as const];
  const conflictEvidence = [
    evidence.find((item) => item.stance === "supports" || item.stance === "updates"),
    evidence.find((item) => item.stance === "opposes"),
  ].filter((item): item is AskAIEvidenceItem => item != null);
  const deterministicClaims = (): Array<{ kind: ClaimKind; text: string; evidencePointerIds: string[]; explanation?: string }> =>
    kinds.map((kind) => ({ kind, text: defaultClaimText(kind, evidence), evidencePointerIds: evidence.map((item) => item.evidencePointerId) }));
  let proposed: Array<{ kind: ClaimKind; text: string; evidencePointerIds: string[]; explanation?: string }>;
  if (options.confidence === "conflicting") {
    // Conflict handling stays deterministic and preserves both sides; the LLM never overrides it.
    options.onSynthesis?.("conflict");
    proposed = conflictEvidence.map((item) => ({ kind: kinds[0] ?? "fact", text: defaultClaimText(kinds[0] ?? "fact", [item]), evidencePointerIds: [item.evidencePointerId] }));
  } else if (options.llm) {
    // Grounded LLM synthesis. When requireLlm (the live app), there is NO deterministic fallback: a
    // failure/timeout/empty result throws a typed error so the UI shows a generic failure instead of
    // fabricating local output. When NOT required (injected dev/test seam), it falls back deterministically.
    // Refusal stays evidence-driven (no_evidence / empty evidence handled above), never LLM-driven.
    try {
      const llmClaims = await options.llm.generateClaims({ query, evidence });
      if (llmClaims.length) { options.onSynthesis?.("llm"); proposed = llmClaims; }
      else if (options.requireLlm) {
        // The LLM CALL SUCCEEDED but produced no grounded claims — it declined because the selected
        // evidence does not actually support a confident answer, or every proposed claim failed the
        // grounding gate (e.g. fabricated/ungrounded quotes were discarded). That is a legitimate,
        // evidence-driven NO-EVIDENCE refusal, NOT a synthesis failure: return no claims so the pipeline
        // renders a safe refusal (never a fabricated answer). Only an ACTUAL call failure — a thrown
        // LlmSynthesisError from a malformed response/HTTP error/timeout, caught below — is `llm_failed`.
        options.onSynthesis?.("llm");
        return [];
      }
      else { options.onSynthesis?.("deterministic"); proposed = deterministicClaims(); }
    } catch (error) {
      if (error instanceof SynthesisFailedError) throw error;
      if (options.requireLlm) throw new SynthesisFailedError();
      options.onSynthesis?.("deterministic");
      proposed = deterministicClaims();
    }
  } else if (options.requireLlm) {
    // Evidence exists but no LLM is configured: the live app does not produce deterministic answers.
    throw new SynthesisSetupRequiredError();
  } else {
    options.onSynthesis?.("deterministic");
    proposed = deterministicClaims();
  }
  return proposed.flatMap((claim, index): AskAIClaim[] => {
    const pointers = [...new Set(claim.evidencePointerIds)].filter((id) => selectedPointers.has(id));
    if (!claim.text.trim() || !pointers.length) return [];
    const claimEvidence = evidence.filter((item) => pointers.includes(item.evidencePointerId));
    const kind = claim.kind;
    let status = supportStatus(options.confidence);
    let explanation = claim.explanation;
    if (kind === "pattern" && claimEvidence.length < 2 && !/\b(always|usually|often|repeatedly|consistently)\b/i.test(claimEvidence[0]?.quotePreview ?? "")) {
      status = "weakly_supported"; explanation = explanation ?? "Pattern is tentative because only one independent span supports it.";
    }
    // Evidence-synthesis intents (Phase 2): default explanations state the current limitation honestly —
    // conclusions/explanations are constrained to cited evidence (no entailment-level grounding yet).
    // Copy only: support status, grounding, and citations are computed exactly as before.
    const constrained = intentPrefersEvidenceSynthesis(query.intent);
    if (kind === "pattern" && constrained) explanation = explanation ?? "This takeaway is constrained to the cited transcript evidence; a broader conclusion would require additional evidence.";
    if (kind === "inference") explanation = explanation ?? (constrained
      ? "This is an inference constrained to the cited transcript evidence; broader interpretation is not available."
      : "This is an inference derived from the cited transcript evidence.");
    if (kind === "recommendation") explanation = explanation ?? "This recommendation is based only on the cited goals, constraints, or preferences.";
    const citationIds = pointers.map((id) => citationByPointer.get(id)?.id).filter((id): id is string => id != null);
    if (!citationIds.length) return [];
    return [{ id: stableId(`${index}:${kind}:${claim.text}:${pointers.join(",")}`), kind, text: claim.text.trim(), supportStatus: status, evidencePointerIds: pointers, citationIds, explanation }];
  });
}
