import type { EvidenceBundleAssessment, ScoredEvidenceCandidate } from "../evidence/index.js";
import type { AskAIEvidenceItem, EvidenceSelection } from "./types.js";

const rank = { strong: 4, mixed: 3, weak: 2, conflicting: 1, no_evidence: 0 };
const sourceRank = { raw_transcript_span: 6, user_correction: 5, memory_object_with_pointers: 4, generated_summary_with_pointers: 3, graph_edge_with_pointers: 2, answer_claim_with_pointers: 1 };

export function scoredCandidateToEvidence(item: ScoredEvidenceCandidate): AskAIEvidenceItem | null {
  const candidate = item.candidate, spanId = candidate.spanIds[0];
  if (!candidate.evidencePointerId || !candidate.transcriptId || !spanId || !candidate.provenanceValidated || !candidate.quote) return null;
  return {
    evidencePointerId: candidate.evidencePointerId,
    sourcePointerId: typeof candidate.metadata?.sourcePointerId === "string" ? candidate.metadata.sourcePointerId : undefined,
    transcriptId: candidate.transcriptId, spanId, quotePreview: candidate.quote.slice(0, 500), speaker: candidate.speaker,
    timestampStart: candidate.turnTimestampStartMs == null ? undefined : String(candidate.turnTimestampStartMs),
    timestampEnd: candidate.turnTimestampEndMs == null ? undefined : String(candidate.turnTimestampEndMs),
    relevanceScore: item.components.relevance, evidenceScore: item.finalScore, evidenceConfidence: item.strength,
    scoringExplanation: item.reasons.join("; ") || `Evidence classified as ${item.strength}.`,
    clickbackUri: `mv://evidence/${encodeURIComponent(candidate.evidencePointerId)}`, stance: item.stance, sourceKind: candidate.sourceKind,
  };
}

export function selectEvidenceForAnswer(
  assessment: EvidenceBundleAssessment,
  options: { maxEvidenceItems?: number; materializedEvidence?: AskAIEvidenceItem[] } = {},
): EvidenceSelection {
  const max = Math.max(1, options.maxEvidenceItems ?? 8);
  const validSpans = new Set(assessment.usableEvidence.flatMap((item) => item.candidate.spanIds));
  const materialized = (options.materializedEvidence ?? assessment.scoredEvidence.map(scoredCandidateToEvidence).filter((item) => item != null))
    .filter((item) => validSpans.has(item.spanId));
  const seenSpans = new Set<string>(), seenQuotes = new Set<string>();
  const evidence = [...materialized].sort((a, b) =>
    rank[b.evidenceConfidence] - rank[a.evidenceConfidence]
    || sourceRank[b.sourceKind] - sourceRank[a.sourceKind]
    || b.evidenceScore - a.evidenceScore
    || a.spanId.localeCompare(b.spanId))
    .filter((item) => {
      const quote = item.quotePreview.toLowerCase().replace(/\s+/g, " ").trim();
      if (!item.evidencePointerId || !item.transcriptId || !item.spanId || seenSpans.has(item.spanId) || seenQuotes.has(quote)) return false;
      seenSpans.add(item.spanId); seenQuotes.add(quote); return true;
    }).slice(0, max);
  return { evidence, confidence: evidence.length ? assessment.strength : "no_evidence", assessment };
}
