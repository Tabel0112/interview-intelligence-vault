import { ValidationError } from "../db/errors.js";
import { renderCitation } from "./citations.js";
import type { AskAIClaim, AskAICitation, EvidenceConfidence } from "./types.js";

export function renderAnswer(input: { confidence: EvidenceConfidence; claims: AskAIClaim[]; citations: AskAICitation[] }): string {
  if (input.confidence === "no_evidence" || !input.claims.length) return "I don't have enough transcript-backed evidence to answer that.";
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
