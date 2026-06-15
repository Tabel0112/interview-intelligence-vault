import { createHash } from "node:crypto";
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
  options: { confidence: EvidenceConfidence; llm?: AskAILanguageModel } ,
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
    proposed = conflictEvidence.map((item) => ({ kind: kinds[0] ?? "fact", text: defaultClaimText(kinds[0] ?? "fact", [item]), evidencePointerIds: [item.evidencePointerId] }));
  } else if (options.llm) {
    // Grounded LLM synthesis, with a deterministic fallback when it fails, errors, times out, or
    // produces no grounded claims. This never refuses on its own — refusal stays driven by the
    // evidence pipeline (no_evidence / empty evidence handled above).
    try {
      const llmClaims = await options.llm.generateClaims({ query, evidence });
      proposed = llmClaims.length ? llmClaims : deterministicClaims();
    } catch {
      proposed = deterministicClaims();
    }
  } else {
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
    if (kind === "inference") explanation = explanation ?? "This is an inference derived from the cited transcript evidence.";
    if (kind === "recommendation") explanation = explanation ?? "This recommendation is based only on the cited goals, constraints, or preferences.";
    const citationIds = pointers.map((id) => citationByPointer.get(id)?.id).filter((id): id is string => id != null);
    if (!citationIds.length) return [];
    return [{ id: stableId(`${index}:${kind}:${claim.text}:${pointers.join(",")}`), kind, text: claim.text.trim(), supportStatus: status, evidencePointerIds: pointers, citationIds, explanation }];
  });
}
