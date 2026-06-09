export const TOPIC_ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "key_points",
    "design_implications",
    "confidence",
    "warnings",
  ],
  properties: {
    summary: { type: "string" },
    key_points: { type: "array", items: { type: "string" } },
    design_implications: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    warnings: { type: "array", items: { type: "string" } },
  },
};

export function buildTopicAnalysisPrompt({
  agentInstructions,
  topic,
  transcriptMetadata,
  turns,
}) {
  return `${agentInstructions}

Analyze only the supplied topic and selected turns.

Topic title: ${topic.title}
Topic ID: ${topic.topic_id}
Turn range: ${topic.start_turn} - ${topic.end_turn}
Transcript metadata:
${JSON.stringify(transcriptMetadata, null, 2)}

Selected turns:
${JSON.stringify(turns, null, 2)}

Return structured JSON only. Summarize only from these selected turns. Do not
use outside knowledge. Do not invent unsupported claims. Do not quote or copy
transcript passages. Synthesize related ideas into compact key points of 1-3
sentences each. Include design implications only when directly supported by
the selected turns.`;
}

