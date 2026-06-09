export const EVIDENCE_CATEGORIES = [
  "user_need",
  "pain_point",
  "behavior_or_workflow",
  "barrier_or_concern",
  "decision_factor",
  "motivation",
  "emotion_or_attitude",
  "workaround",
  "product_expectation",
  "design_opportunity",
  "business_or_market_insight",
  "contradiction_or_tension",
  "background_context",
  "other",
];

export const EVIDENCE_STRENGTHS = ["strong", "medium", "weak"];

export const EVIDENCE_CANDIDATE_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "quote",
          "source_refs",
          "context",
          "meaning",
          "evidence_category",
          "suggested_tags",
          "strength",
        ],
        properties: {
          quote: { type: "string" },
          source_refs: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["turn_id", "start_char", "end_char"],
              properties: {
                turn_id: { type: "string" },
                start_char: { type: "integer" },
                end_char: { type: "integer" },
              },
            },
          },
          context: { type: "string" },
          meaning: { type: "string" },
          evidence_category: {
            type: "string",
            enum: EVIDENCE_CATEGORIES,
          },
          suggested_tags: {
            type: "array",
            items: { type: "string" },
          },
          strength: { type: "string", enum: EVIDENCE_STRENGTHS },
        },
      },
    },
  },
};

export function buildEvidenceCandidatePrompt({
  agentInstructions = "",
  topic,
  turns,
}) {
  return `${agentInstructions}

Extract evidence candidates only from the supplied topic turns.

Topic ID: ${topic.topic_id}
Topic title: ${topic.title}
Topic summary: ${topic.summary ?? ""}

Selected turns:
${JSON.stringify(turns, null, 2)}

Return structured JSON only. Return zero to five candidates, usually zero to
three. Each candidate must be a meaningful, self-contained exact quote from
one selected turn. Provide exactly one source_ref whose start_char is inclusive
and end_char is exclusive, relative to that turn's text. The quote must exactly
equal the referenced character slice. Do not normalize, paraphrase, combine
turns, invent evidence, or use outside knowledge. Use only the allowed evidence
categories and strength values. Suggested tags are temporary lowercase
snake_case labels, not official tags. Official tag decisions happen later.`;
}
