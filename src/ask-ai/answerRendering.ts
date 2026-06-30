import { ValidationError } from "../db/errors.js";
import { renderCitation } from "./citations.js";
import type { AskAIAnalysisClaim, AskAIClaim, AskAICitation, EvidenceConfidence } from "./types.js";

const REFUSAL = "I don't have enough transcript-backed evidence to answer that.";

/** Render the transcript-backed (cited) claims. Throws if a factual/supported claim has no citation. */
function renderFactual(input: { confidence: EvidenceConfidence; claims: AskAIClaim[]; citations: AskAICitation[] }): string {
  const citations = new Map(input.citations.map((item) => [item.id, item]));
  const lines = input.claims.map((claim) => {
    const links = claim.citationIds.map((id) => citations.get(id)).filter((item) => item != null).map(renderCitation);
    if (!links.length) throw new ValidationError(`Ask AI claim has no selected citation: ${claim.id}`);
    const label = claim.kind === "fact" ? "" : `**${claim.kind[0].toUpperCase()}${claim.kind.slice(1)}:** `;
    return `${label}${claim.text} ${links.join(" ")}`;
  });
  const intro = input.confidence === "weak"
    ? "The evidence I found is weak, so this should be treated cautiously."
    : input.confidence === "conflicting"
      ? "The evidence conflicts, so I can't give one clean answer. Both sides are shown below."
      : input.confidence === "mixed"
        ? "The transcript evidence supports a qualified answer."
        : "Based on the transcript evidence:";
  return `${intro}\n\n${lines.join("\n\n")}`;
}

/** Render an uncited AI-analysis item. Analysis is never cited and is always labeled by the section header. */
function renderAnalysisClaim(claim: AskAIAnalysisClaim): string {
  const label = `**${claim.kind[0].toUpperCase()}${claim.kind.slice(1)}:** `;
  return `${label}${claim.text}`;
}

/**
 * Render the answer markdown. Transcript-backed claims render exactly as before (with the no-evidence
 * refusal and the uncited-claim guard intact). When LIVE-ONLY `analysis` is present, it is appended under a
 * clearly-labeled "AI analysis — not from your transcripts" section; if there are no transcript-backed
 * claims, a missing-evidence lead replaces the bare refusal. Analysis claims are never cited.
 */
export function renderAnswer(input: { confidence: EvidenceConfidence; claims: AskAIClaim[]; citations: AskAICitation[]; analysis?: AskAIAnalysisClaim[] }): string {
  const analysis = input.analysis ?? [];
  const hasFactual = input.confidence !== "no_evidence" && input.claims.length > 0;
  const factual = hasFactual ? renderFactual(input) : "";

  if (!analysis.length) {
    // Behavior unchanged: cited factual answer, or the no-evidence refusal.
    return hasFactual ? factual : REFUSAL;
  }
  const lead = hasFactual
    ? factual
    : "I don't have transcript-backed evidence for this, so the following is AI analysis, not from your transcripts.";
  const analysisBlock = `## AI analysis — not from your transcripts\n\n${analysis.map(renderAnalysisClaim).join("\n\n")}`;
  return `${lead}\n\n${analysisBlock}`;
}
