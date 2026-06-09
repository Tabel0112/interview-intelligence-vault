import { normalizeTranscriptId } from "./transcriptId.mjs";

export const EVIDENCE_CARD_GENERATOR = "evidence-card-writer.v1";
export const EVIDENCE_CARD_GENERATED_MARKER =
  "<!-- GENERATED_BY: evidence-card-writer.v1 -->";

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

export function evidenceTitle(card) {
  const source = card.meaning || card.quote;
  const compact = String(source).replace(/\s+/g, " ").trim();
  return compact.length <= 64 ? compact : `${compact.slice(0, 61).trim()}...`;
}

export function evidenceTitleSlug(card) {
  return (
    normalizeTranscriptId(evidenceTitle(card)).slice(0, 64) ||
    normalizeTranscriptId(card.evidence_id) ||
    "evidence"
  );
}

function quoteBlock(quote) {
  return String(quote)
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

export function renderEvidenceCardMarkdown(card) {
  return [
    "---",
    "type: evidence",
    `evidence_id: ${card.evidence_id}`,
    `source_candidate_id: ${card.candidate_id}`,
    `source_transcript_id: ${card.source_transcript_id}`,
    `source_transcript_title: ${yamlString(card.source_transcript_title)}`,
    `speaker: ${yamlString(card.speaker)}`,
    `topic_id: ${card.topic_id}`,
    `topic_title: ${yamlString(card.topic_title)}`,
    `confidence: ${card.confidence}`,
    `score: ${card.score}`,
    "status: unclassified",
    `created_by: ${EVIDENCE_CARD_GENERATOR}`,
    `input_sha256: ${card.input_sha256}`,
    "---",
    "",
    EVIDENCE_CARD_GENERATED_MARKER,
    "",
    `# Evidence - ${evidenceTitle(card)}`,
    "",
    "## Quote",
    "",
    quoteBlock(card.quote),
    "",
    "## Context",
    "",
    card.context.trim(),
    "",
    "## Meaning",
    "",
    card.meaning.trim(),
    "",
    "## Score Reason",
    "",
    card.score_reason.trim(),
    "",
    "## Source",
    "",
    `* [[${card.source_transcript_title}]]`,
    "",
    "## Related Topic",
    "",
    `* [[Topic Analysis - ${card.topic_title}]]`,
    "",
  ].join("\n");
}
