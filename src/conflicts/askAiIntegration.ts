import type { AskAIEvidenceItem, AskAIResponse, EvidenceConfidence } from "../ask-ai/types.js";
import { renderConflictContext } from "./render.js";
import type { ConflictAssessment } from "./types.js";

export function confidenceWithConflicts(confidence: EvidenceConfidence, conflicts: ConflictAssessment[]): EvidenceConfidence {
  const active = conflicts.filter((conflict) => conflict.status === "active");
  if (active.some((conflict) => conflict.kind === "direct_contradiction")) return "conflicting";
  if (confidence === "strong" && active.some((conflict) =>
    conflict.kind === "tension" || conflict.kind === "conditional_difference" || conflict.kind === "temporal_update")) return "mixed";
  return confidence;
}

export function addConflictContext(answerMarkdown: string, conflicts: ConflictAssessment[]): string {
  const context = renderConflictContext(conflicts);
  return context ? `${answerMarkdown}\n\n${context}` : answerMarkdown;
}

export function conflictEvidenceForAnswer(conflicts: ConflictAssessment[]): AskAIEvidenceItem[] {
  const items = conflicts.filter((conflict) => conflict.status === "active").flatMap((conflict) =>
    conflict.evidenceLinks.flatMap((link): AskAIEvidenceItem[] => {
      if (!link.provenanceValidated || !link.transcriptId || !link.spanId || !link.quotePreview) return [];
      const stance = conflict.kind === "direct_contradiction"
        ? link.side === "left" ? "supports" : "opposes"
        : conflict.kind === "temporal_update" && link.side === (conflict.newerTargetId === conflict.leftTargetId ? "left" : "right")
          ? "updates" : "qualifies";
      const strength = link.evidenceStrength;
      const evidenceConfidence: EvidenceConfidence = strength === "strong" || strength === "mixed" || strength === "weak" || strength === "conflicting"
        ? strength : "weak";
      return [{
        evidencePointerId: link.evidencePointerId, sourcePointerId: link.sourcePointerId, transcriptId: link.transcriptId,
        spanId: link.spanId, quotePreview: link.quotePreview, evidenceScore: link.confidence ?? conflict.confidence,
        evidenceConfidence, scoringExplanation: conflict.explanation, clickbackUri: `mv://evidence/${link.evidencePointerId}`,
        stance, sourceKind: "raw_transcript_span",
      }];
    }));
  return [...new Map(items.map((item) => [item.evidencePointerId, item])).values()];
}

export function augmentAskAIResponseWithConflicts(response: AskAIResponse, conflicts: ConflictAssessment[]): AskAIResponse {
  const evidenceConfidence = confidenceWithConflicts(response.evidenceConfidence, conflicts);
  return {
    ...response, conflicts, evidenceConfidence,
    answerMarkdown: addConflictContext(response.answerMarkdown, conflicts),
    notEnoughEvidence: evidenceConfidence === "no_evidence",
  };
}
