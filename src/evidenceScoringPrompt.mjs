export const SCORE_REASON_KEYS = [
  "specific_quote",
  "product_user_market_strategy_related",
  "future_decision_useful",
  "supports_or_challenges_theme",
  "non_obvious_insight",
];

const scoreReasonsSchema = {
  type: "object",
  additionalProperties: false,
  required: SCORE_REASON_KEYS,
  properties: Object.fromEntries(
    SCORE_REASON_KEYS.map((key) => [key, { type: "boolean" }]),
  ),
};

export const EVIDENCE_SCORING_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["candidate_id", "score_reasons", "score_rationale"],
        properties: {
          candidate_id: { type: "string" },
          score_reasons: scoreReasonsSchema,
          score_rationale: { type: "string" },
        },
      },
    },
  },
};

export function buildEvidenceScoringPrompt({
  agentInstructions = "",
  transcriptId,
  candidates,
}) {
  return `${agentInstructions}

Score every supplied Part 8 evidence candidate exactly once.

Transcript ID: ${transcriptId}
Candidates:
${JSON.stringify(candidates, null, 2)}

Return strict structured JSON only. Return one result for every supplied
candidate_id and no others. Judge only the five required boolean score reasons
and provide a short, auditable score_rationale. Do not return a numeric score,
filter decision, ranking, duplicate decision, rewritten quote, new candidate,
or omitted candidate. Deterministic code handles those decisions.`;
}
