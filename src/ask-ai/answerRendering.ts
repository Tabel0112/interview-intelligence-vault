import { ValidationError } from "../db/errors.js";
import { renderCitation } from "./citations.js";
import { UNCONFIRMED_DISCLAIMER, type AskAIAnalysisClaim, type AskAIClaim, type AskAICitation, type AskAIUnconfirmedItem, type EvidenceConfidence } from "./types.js";

const REFUSAL = "I don't have enough transcript-backed evidence to answer that.";

/** Render one uncited unconfirmed item: label + text, with a context link or a missing-evidence note. */
function renderUnconfirmedItem(item: AskAIUnconfirmedItem): string {
  const suffix = item.evidenceUri ? ` [context](${item.evidenceUri})` : item.missingEvidence ? " _(evidence missing or deleted)_" : "";
  return `**${item.label}:** ${item.text}${suffix}`;
}

/** Render the unconfirmed-context sections (Conflicts / Review-only / Tentative), each clearly labeled. */
function renderUnconfirmedSections(unconfirmed: AskAIUnconfirmedItem[]): string[] {
  const groups: Array<[string, AskAIUnconfirmedItem["kind"][]]> = [
    ["Conflicts / tensions", ["conflict"]],
    ["Unconfirmed / review-only findings", ["review_only", "degraded"]],
    ["Tentative ideas", ["tentative", "possible_duplicate"]],
  ];
  const blocks: string[] = [];
  for (const [heading, kinds] of groups) {
    const group = unconfirmed.filter((item) => kinds.includes(item.kind));
    if (group.length) blocks.push(`## ${heading}\n\n${group.map(renderUnconfirmedItem).join("\n\n")}`);
  }
  return blocks;
}

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
export function renderAnswer(input: { confidence: EvidenceConfidence; claims: AskAIClaim[]; citations: AskAICitation[]; analysis?: AskAIAnalysisClaim[]; unconfirmed?: AskAIUnconfirmedItem[] }): string {
  const analysis = input.analysis ?? [];
  const unconfirmed = input.unconfirmed ?? [];
  const hasFactual = input.confidence !== "no_evidence" && input.claims.length > 0;
  const factual = hasFactual ? renderFactual(input) : "";
  const analysisBlock = analysis.length ? `## AI analysis — not from your transcripts\n\n${analysis.map(renderAnalysisClaim).join("\n\n")}` : "";

  if (!unconfirmed.length) {
    // Behavior unchanged from Step 2: cited factual answer; analysis (if any); else the no-evidence refusal.
    if (!analysis.length) return hasFactual ? factual : REFUSAL;
    const lead = hasFactual ? factual : "I don't have transcript-backed evidence for this, so the following is AI analysis, not from your transcripts.";
    return `${lead}\n\n${analysisBlock}`;
  }
  // Unconfirmed context present: confirmed facts (if any), then a labeled unconfirmed block, then analysis.
  const blocks: string[] = [];
  blocks.push(hasFactual ? factual : "I don't have confirmed transcript-backed evidence for this. The items below are unconfirmed or AI analysis — not established facts.");
  blocks.push(`> [!warning] Unconfirmed context\n> ${UNCONFIRMED_DISCLAIMER}`);
  blocks.push(...renderUnconfirmedSections(unconfirmed));
  if (analysisBlock) blocks.push(analysisBlock);
  return blocks.join("\n\n");
}
