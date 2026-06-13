import type { EvidenceBundleAssessment, EvidenceStrength } from "./types.js";

export function explanationForStrength(strength: EvidenceStrength, useType?: string): string {
  const subject = useType === "inference" ? "inference" : useType === "recommendation" ? "recommendation" : "claim";
  if (strength === "strong") return `Strong evidence: the ${subject} is supported by specific source-backed evidence with no meaningful unresolved opposition.`;
  if (strength === "mixed") return `Mixed evidence: the ${subject} has usable support, but some evidence qualifies or partially challenges it.`;
  if (strength === "conflicting") return `Conflicting evidence: there is strong support for the ${subject}, but other source-backed evidence directly opposes it.`;
  if (strength === "weak") return `Weak evidence: the available source-backed evidence is related, but it is not sufficient to support the ${useType === "pattern" ? "pattern" : subject} confidently.`;
  return `No evidence: no usable source-backed transcript spans or confirmed corrections were found for this ${subject}.`;
}

export function explainEvidenceScore(assessment: Pick<EvidenceBundleAssessment, "strength" | "useType">): string {
  return explanationForStrength(assessment.strength, assessment.useType);
}
