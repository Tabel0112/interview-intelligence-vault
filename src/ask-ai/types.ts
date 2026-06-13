import type { SqliteDatabase } from "../db/connection.js";
import type { EvidenceBundleAssessment, EvidenceCandidate, EvidenceStrength, ScoredEvidenceCandidate } from "../evidence/index.js";
import type { ConflictAssessment } from "../conflicts/types.js";

export type AskAIAnswerMode = "direct" | "exploratory" | "summary" | "recommendation";
export type ClaimKind = "fact" | "pattern" | "inference" | "recommendation";
export type EvidenceConfidence = EvidenceStrength;
export type ClaimSupportStatus = "supported" | "weakly_supported" | "conflicting" | "unsupported";

export interface AskAIRequest {
  question: string;
  mode?: AskAIAnswerMode;
  transcriptIds?: string[];
  entityIds?: string[];
  memoryObjectIds?: string[];
  timeRange?: { start?: string; end?: string };
  maxEvidenceItems?: number;
  includeSuggestedFollowups?: boolean;
}

export interface QueryUnderstanding {
  originalQuestion: string;
  normalizedQuestion: string;
  answerMode: AskAIAnswerMode;
  detectedEntities: string[];
  detectedTopics: string[];
  timeHints: string[];
  requestedClaimKinds: ClaimKind[];
  needsRecommendation: boolean;
  needsComparison: boolean;
  needsChronology: boolean;
  shouldUseMemoryObjects: boolean;
  shouldUseRawTranscriptSpans: boolean;
  transcriptIds: string[];
  entityIds: string[];
  memoryObjectIds: string[];
  timeRange?: AskAIRequest["timeRange"];
}

export interface AskAIEvidenceItem {
  evidencePointerId: string;
  sourcePointerId?: string;
  transcriptId: string;
  spanId: string;
  quotePreview: string;
  speaker?: string;
  timestampStart?: string;
  timestampEnd?: string;
  relevanceScore?: number;
  evidenceScore: number;
  evidenceConfidence: EvidenceConfidence;
  scoringExplanation: string;
  clickbackUri: string;
  stance: ScoredEvidenceCandidate["stance"];
  sourceKind: EvidenceCandidate["sourceKind"];
}

export interface AskAIClaim {
  id: string;
  kind: ClaimKind;
  text: string;
  supportStatus: ClaimSupportStatus;
  evidencePointerIds: string[];
  citationIds: string[];
  explanation?: string;
}

export interface AskAICitation {
  id: string;
  label: string;
  evidencePointerId: string;
  sourcePointerId?: string;
  transcriptId: string;
  spanId: string;
  quotePreview: string;
  clickbackUri: string;
}

export interface AskAIResponse {
  id: string;
  question: string;
  answerMarkdown: string;
  evidenceConfidence: EvidenceConfidence;
  claims: AskAIClaim[];
  citations: AskAICitation[];
  evidence: AskAIEvidenceItem[];
  suggestedFollowups: string[];
  notEnoughEvidence: boolean;
  createdAt: string;
  queryUnderstanding: QueryUnderstanding;
  conflicts: ConflictAssessment[];
  scoreRunId?: string;
}

export interface AskAILanguageModel {
  generateClaims(input: { query: QueryUnderstanding; evidence: AskAIEvidenceItem[] }): Promise<Array<{ kind: ClaimKind; text: string; evidencePointerIds: string[]; explanation?: string }>>;
}

export interface AskAIDependencies {
  retrieveCandidates: (query: QueryUnderstanding) => Promise<EvidenceCandidate[]>;
  scoreEvidence?: (question: string, candidates: EvidenceCandidate[], query: QueryUnderstanding) => Promise<EvidenceBundleAssessment>;
  createEvidencePointers?: (items: ScoredEvidenceCandidate[]) => Promise<AskAIEvidenceItem[]>;
  findConflicts?: (evidence: AskAIEvidenceItem[]) => Promise<ConflictAssessment[]>;
  persistAnswer?: (answer: AskAIResponse) => Promise<void>;
  llm?: AskAILanguageModel;
  now?: () => Date;
  db?: SqliteDatabase;
}

export interface EvidenceSelection {
  evidence: AskAIEvidenceItem[];
  confidence: EvidenceConfidence;
  assessment: EvidenceBundleAssessment;
}
