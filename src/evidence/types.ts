export type EvidenceUseType = "direct_fact" | "pattern" | "inference" | "recommendation";
export type EvidenceStance = "supports" | "opposes" | "qualifies" | "updates" | "neutral" | "unknown";
export type EvidenceStrength = "strong" | "mixed" | "weak" | "conflicting" | "no_evidence";
export type EvidenceSourceKind =
  | "raw_transcript_span"
  | "user_correction"
  | "generated_summary_with_pointers"
  | "memory_object_with_pointers"
  | "graph_edge_with_pointers"
  | "answer_claim_with_pointers";

export interface EvidenceCandidate {
  id: string;
  evidencePointerId?: string;
  transcriptId?: string;
  spanIds: string[];
  quote?: string;
  speaker?: string;
  sourceKind: EvidenceSourceKind;
  createdAt?: string;
  transcriptRecordedAt?: string;
  turnTimestampStartMs?: number | null;
  turnTimestampEndMs?: number | null;
  retrievalScore?: number;
  vectorScore?: number;
  keywordScore?: number;
  stance?: EvidenceStance;
  sourceConfidence?: number;
  extractionConfidence?: number;
  isUserCorrection?: boolean;
  userCorrectionStatus?: "confirmed" | "rejected" | "superseded" | "none";
  /** True only when generated-object evidence was dereferenced to a real raw transcript span. */
  provenanceValidated?: boolean;
  metadata?: Record<string, unknown>;
}

export interface EvidenceScoringInput {
  claimText: string;
  useType: EvidenceUseType;
  candidates: EvidenceCandidate[];
  now?: string;
  knownOppositionCandidateIds?: string[];
  knownDuplicateCandidateIds?: string[];
  requiredSpecificityTerms?: string[];
  metadata?: Record<string, unknown>;
}

export interface EvidenceComponentScores {
  relevance: number;
  directness: number;
  specificity: number;
  sourceStrength: number;
  repetition: number;
  recency: number;
  correctionWeight: number;
  confidence: number;
  oppositionPenalty: number;
}

export interface EvidenceScoreCaps {
  maxStrength?: EvidenceStrength;
  reasons: string[];
}

export interface ScoredEvidenceCandidate {
  candidate: EvidenceCandidate;
  stance: EvidenceStance;
  components: EvidenceComponentScores;
  finalScore: number;
  strength: EvidenceStrength;
  caps: EvidenceScoreCaps;
  reasons: string[];
}

export interface EvidenceBundleAssessment {
  claimText: string;
  useType: EvidenceUseType;
  strength: EvidenceStrength;
  supportScore: number;
  oppositionScore: number;
  qualificationScore: number;
  bestSupportingEvidence: ScoredEvidenceCandidate[];
  bestOpposingEvidence: ScoredEvidenceCandidate[];
  qualifyingEvidence: ScoredEvidenceCandidate[];
  usableEvidence: ScoredEvidenceCandidate[];
  scoredEvidence: ScoredEvidenceCandidate[];
  hasConflict: boolean;
  hasWeakEvidenceOnly: boolean;
  hasNoEvidence: boolean;
  explanation: string;
  reasons: string[];
  scorerVersion: string;
}

export interface CandidateScoringContext {
  claimText: string;
  useType: EvidenceUseType;
  allCandidates: EvidenceCandidate[];
  now?: string;
  knownOppositionCandidateIds?: string[];
  requiredSpecificityTerms?: string[];
}
