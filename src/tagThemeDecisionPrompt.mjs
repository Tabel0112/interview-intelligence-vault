export const TAG_THEME_DECISION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "evidence_id",
    "status",
    "matched_tag",
    "matched_theme",
    "candidate_tag",
    "suggested_theme",
    "confidence",
    "reason",
  ],
  properties: {
    evidence_id: { type: "string" },
    status: {
      type: "string",
      enum: ["matched", "candidate", "needs_review"],
    },
    matched_tag: { type: ["string", "null"] },
    matched_theme: { type: ["string", "null"] },
    candidate_tag: { type: ["string", "null"] },
    suggested_theme: { type: ["string", "null"] },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
};

export function buildTagThemeDecisionPrompt({
  agentInstructions,
  evidence,
  taxonomy,
}) {
  return `${agentInstructions}

Classify only this evidence card:
${JSON.stringify(evidence, null, 2)}

Official tags:
${JSON.stringify(taxonomy.officialTags, null, 2)}

Existing candidate tags:
${JSON.stringify(taxonomy.candidateTags, null, 2)}

Official themes:
${JSON.stringify(taxonomy.themes, null, 2)}

Return compact structured JSON only. First try one clear official tag. If no
official tag fits, reuse an existing candidate tag or suggest one new short,
specific lowercase kebab-case candidate tag. Use needs_review for weak,
ambiguous, or multi-tag evidence. Never invent an official tag or official
theme. Never copy long quotes or full evidence text into the output.`;
}
