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

/** Fixed disclaimer carried by every AI-analysis item. */
export const AI_ANALYSIS_WARNING = "AI analysis — not from transcript evidence";

/**
 * A LIVE-ONLY, non-transcript-backed analysis/recommendation item (Step 2 Option A). It is intentionally a
 * SEPARATE type from {@link AskAIClaim} and lives in {@link AskAIResponse.analysis}, never in `claims`, so it
 * can never be persisted as a supported answer claim, never carries citations/evidence pointers, and can
 * never be promoted into memory/evidence. `supportStatus` is the literal "ai_analysis" marker.
 */
export interface AskAIAnalysisClaim {
  id: string;
  kind: ClaimKind;
  text: string;
  supportStatus: "ai_analysis";
  /** Always empty — analysis is never grounded in transcript evidence. */
  evidencePointerIds: never[];
  /** Always empty — analysis is never cited. */
  citationIds: never[];
  warning: typeof AI_ANALYSIS_WARNING;
  explanation?: string;
}

/**
 * Live-only seam that produces non-transcript AI analysis. Requires an external LLM provider; the live
 * wiring only injects it when one is configured. Never fabricates or cites transcript facts.
 */
export interface AskAIAnalysisModel {
  analyze(input: { query: QueryUnderstanding; evidence: AskAIEvidenceItem[] }): Promise<Array<{ kind: ClaimKind; text: string; explanation?: string }>>;
}

/** Disclaimer shown above every unconfirmed-context section. */
export const UNCONFIRMED_DISCLAIMER = "These items are not confirmed transcript-backed facts. They are review-only, tentative, conflicting, or missing evidence.";

export type AskAIUnconfirmedKind = "review_only" | "tentative" | "possible_duplicate" | "conflict" | "degraded";

/**
 * A LIVE-ONLY unconfirmed-context item (sub-step A) surfaced for broad/advice/conflict prompts. It is a
 * SEPARATE field from {@link AskAIResponse.claims} — never a supported claim, never a normal citation. It
 * may reference an existing live evidence pointer (link/context only), but referencing it never promotes it
 * to a cited supported claim. Degraded items (evidence removed/deleted) carry `missingEvidence` and no link.
 * Not persisted in sub-step A (reconstruction omits it until sub-step B).
 */
export interface AskAIUnconfirmedItem {
  id: string;
  kind: AskAIUnconfirmedKind;
  /** The canonical memory this came from (for review_only/tentative/possible_duplicate/degraded). */
  memoryId?: string;
  /** The conflict assessment this came from (for kind="conflict"). */
  conflictId?: string;
  text: string;
  /** Short human label, e.g. "Review-only", "Tentative idea", "Possible duplicate", "Conflict / tension". */
  label: string;
  warning: string;
  /** A LIVE evidence pointer for context/linking only — NOT a supported citation. Omitted when none exists. */
  evidencePointerId?: string;
  evidenceUri?: string;
  /** True when this item's transcript evidence is missing/deleted (no link is shown). */
  missingEvidence?: boolean;
}

/** Live-only seam that retrieves unconfirmed/tentative/conflict context (DB-backed; no LLM, no new pointers). */
export interface AskAIUnconfirmedRetriever {
  (query: QueryUnderstanding): Promise<AskAIUnconfirmedItem[]>;
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
  /** True when there are no transcript-backed claims (unchanged meaning; analysis does NOT flip this). */
  notEnoughEvidence: boolean;
  createdAt: string;
  queryUnderstanding: QueryUnderstanding;
  conflicts: ConflictAssessment[];
  scoreRunId?: string;
  synthesis?: AnswerSynthesis;
  /**
   * LIVE-ONLY, non-transcript AI analysis (Step 2 Option A). Present only in the in-memory response of a
   * fresh `askAI` call when the answer contract permits reasoning; NEVER persisted, so a reconstructed
   * answer (`getAskAIResponse`) has this empty/undefined and is transcript-fact-only until Step 3.
   */
  analysis?: AskAIAnalysisClaim[];
  /** True when live AI analysis was produced for this response (live-only; not reconstructed). */
  hasAnalysis?: boolean;
  /**
   * LIVE-ONLY unconfirmed/tentative/conflict context (sub-step A). Surfaced only when the answer contract
   * allows; never a supported claim or normal citation. NOT persisted yet, so a reconstructed answer omits
   * it (the rendered markdown still carries the sections) until sub-step B adds a separate table.
   */
  unconfirmed?: AskAIUnconfirmedItem[];
  /** True when live unconfirmed context was surfaced for this response (live-only; not reconstructed). */
  hasUnconfirmed?: boolean;
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
  /** Live-only AI-analysis seam (Step 2). Injected only when an external LLM is configured. */
  analysis?: AskAIAnalysisModel;
  /** Live-only unconfirmed/tentative/conflict retrieval seam (sub-step A). DB-backed; no LLM required. */
  retrieveUnconfirmed?: AskAIUnconfirmedRetriever;
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
