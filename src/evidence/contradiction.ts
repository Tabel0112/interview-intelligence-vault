import type { EvidenceBundleAssessment, ScoredEvidenceCandidate } from "./types.js";
import { aggregateSupportAndOpposition } from "./scoring.js";

export function assessContradiction(
  claimText: string,
  useType: EvidenceBundleAssessment["useType"],
  candidates: ScoredEvidenceCandidate[],
): Pick<EvidenceBundleAssessment, "hasConflict" | "supportScore" | "oppositionScore" | "qualificationScore" | "strength"> {
  const assessment = aggregateSupportAndOpposition({ claimText, useType }, candidates);
  return {
    hasConflict: assessment.hasConflict,
    supportScore: assessment.supportScore,
    oppositionScore: assessment.oppositionScore,
    qualificationScore: assessment.qualificationScore,
    strength: assessment.strength,
  };
}
