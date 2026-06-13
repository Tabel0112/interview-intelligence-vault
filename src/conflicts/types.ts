import type { EvidenceTargetType } from "../provenance/index.js";

export type ConflictKind = "direct_contradiction" | "tension" | "temporal_update" | "conditional_difference" | "weak_or_ambiguous";
export type ConflictStatus = "active" | "needs_review" | "resolved" | "dismissed" | "superseded";
export type ConflictTargetType = Exclude<EvidenceTargetType, "answer"> | "evidence_pointer";
export type ConflictEvidenceSide = "left" | "right";
export type ConflictEvidenceRole = "supports_left" | "supports_right" | "opposes_left" | "opposes_right" | "conditional_context";
export type ConflictLogicalEdgeType = "contradicts" | "tensions_with" | "updates" | "conditionally_differs_from";
export type ConflictCorrectionAction =
  | "mark_left_correct" | "mark_right_correct" | "mark_both_contextual"
  | "mark_newer_supersedes_older" | "keep_both_as_tension" | "dismiss_not_conflict";

export interface ConflictCandidate {
  leftTargetId: string;
  leftTargetType: ConflictTargetType;
  rightTargetId: string;
  rightTargetType: ConflictTargetType;
  leftText: string;
  rightText: string;
  leftEvidenceIds: string[];
  rightEvidenceIds: string[];
  leftTimestamp?: string | null;
  rightTimestamp?: string | null;
  sharedEntities?: string[];
  sharedTopics?: string[];
  preferTemporalUpdate?: boolean;
}

export interface ConflictClassificationOptions {
  validatedEvidenceIds?: Iterable<string>;
  evidenceScores?: Record<string, number>;
  userCorrectionTargetIds?: Iterable<string>;
  preferTemporalUpdate?: boolean;
}

export interface ConflictComponentScores {
  topicOverlap: number;
  polarityOpposition: number;
  conditionality: number;
  temporalDistance: number;
  evidenceCoverage: number;
}

export interface ConflictClassification {
  kind: ConflictKind;
  confidence: number;
  summary: string;
  explanation: string;
  componentScores: ConflictComponentScores;
  newerTargetId: string | null;
  olderTargetId: string | null;
}

export interface ConflictEvidenceLink {
  id: string;
  conflictAssessmentId: string;
  evidencePointerId: string;
  side: ConflictEvidenceSide;
  role: ConflictEvidenceRole;
  provenanceValidated: boolean;
  transcriptId?: string;
  spanId?: string;
  sourcePointerId?: string;
  quotePreview?: string;
  evidenceStrength?: string;
  confidence?: number;
  createdAt: string;
}

export interface ConflictAssessment extends ConflictClassification {
  id: string;
  status: ConflictStatus;
  leftTargetType: ConflictTargetType;
  leftTargetId: string;
  rightTargetType: ConflictTargetType;
  rightTargetId: string;
  pairKey: string;
  winningTargetId: string | null;
  resolutionNote: string | null;
  evidence: ConflictEvidenceLink[];
  evidenceLinks: ConflictEvidenceLink[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateConflictAssessmentInput {
  candidate: ConflictCandidate;
  classification?: ConflictClassification;
}

export interface ApplyConflictCorrectionInput {
  action: ConflictCorrectionAction;
  note?: string;
  createdBy?: string;
}
