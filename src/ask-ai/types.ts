import type { SqliteDatabase } from "../db/connection.js";
import type { EvidenceBundleAssessment, EvidenceCandidate, EvidenceStrength, ScoredEvidenceCandidate } from "../evidence/index.js";
import type { ConflictAssessment } from "../conflicts/types.js";

export type AskAIAnswerMode = "direct" | "exploratory" | "summary" | "recommendation";
export type ClaimKind = "fact" | "pattern" | "inference" | "recommendation";

/**
 * Internally-detected task type for a question. Deterministic, derived from the prompt — the user never
 * selects this. Used (in later steps) to pick the answer contract; Step 1 only classifies and exposes it.
 */
export type AskAIQueryIntent =
  | "factual_lookup" | "decision_lookup" | "evidence_check" | "advice_strategy"
  | "planning_draft" | "conflict_risk" | "comparison" | "summary" | "mixed";

/**
 * What the answer is allowed to do for a given intent. Step 1 ONLY computes and returns this metadata;
 * nothing downstream consumes it yet, so factual lookup, refusal, scoring, and MCP/UI output are unchanged.
 * `requireEvidenceForFactualClaims` is always true: a vault factual claim must trace to transcript evidence,
 * regardless of intent. The other flags gate behavior that later steps will implement.
 */
export interface AskAIAnswerContract {
  /** A claim about what the vault/transcripts say must be evidence-backed. Always true. */
  requireEvidenceForFactualClaims: boolean;
  /** May add general (clearly-labeled, uncited) reasoning beyond the transcript evidence. */
  allowGeneralReasoning: boolean;
  /** May produce recommendations (labeled as analysis, not transcript facts). */
  allowRecommendations: boolean;
  /** Refuse when there is no/insufficient transcript evidence (preserves factual-lookup refusal). */
  refuseIfNoEvidence: boolean;
  /** May surface review-only / tentative memories, labeled unconfirmed. */
  includeReviewOnlyItems: boolean;
  /** Should surface conflicts/contradictions among the evidence. */
  includeConflicts: boolean;
  /** May draft artifacts (plan, email, outline) from the evidence + assumptions. */
  allowDrafting: boolean;
}
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
  /** Internally-detected task type (deterministic). Step 1 metadata; not yet consumed downstream. */
  intent: AskAIQueryIntent;
  /** Per-intent behavior contract. Step 1 metadata; not yet consumed downstream. */
  answerContract: AskAIAnswerContract;
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

/** Non-secret description of how the answer's claims were synthesized. No keys/prompts/provider objects. */
export type SynthesisActualMode = "external_llm" | "deterministic" | "conflict";

/** Configured synthesis intent, supplied by the wiring layer (non-secret). */
export interface SynthesisInfo {
  /** Whether an external LLM was configured for synthesis ("external_llm") or local mode ("deterministic"). */
  mode: "external_llm" | "deterministic";
  provider?: string; // provider id only, e.g. "openai" or "local-deterministic"
  model?: string; // model id only
  /** Resolution-level fallback: settings asked for external but were incomplete (no key/model). */
  usedFallback?: boolean;
}

/** Runtime-accurate synthesis result persisted with the answer (non-secret). */
export interface AnswerSynthesis {
  mode: SynthesisActualMode;
  provider?: string;
  model?: string;
  /** True when an external LLM was configured but the actual path was deterministic (resolution or runtime fallback). */
  usedFallback: boolean;
  reason?: string;
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
  synthesis?: AnswerSynthesis;
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
  /** Non-secret configured-synthesis summary, recorded with the answer. */
  synthesisInfo?: SynthesisInfo;
  /** Live app: require an LLM for synthesis (no deterministic fallback). Throws typed errors instead. */
  requireLlm?: boolean;
  now?: () => Date;
  db?: SqliteDatabase;
}

export interface EvidenceSelection {
  evidence: AskAIEvidenceItem[];
  confidence: EvidenceConfidence;
  assessment: EvidenceBundleAssessment;
}
