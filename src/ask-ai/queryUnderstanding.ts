import { ValidationError } from "../db/errors.js";
import type { AskAIAnswerContract, AskAIAnswerMode, AskAIQueryIntent, AskAIRequest, ClaimKind, QueryUnderstanding } from "./types.js";

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

// Deterministic intent detectors, evaluated in priority order. The FIRST family-level match wins for the
// primary intent; `mixed` is chosen only when an analysis ask (advice/planning) co-occurs with a lookup ask
// (decision/evidence). Patterns are intentionally narrow — e.g. planning matches a request to DRAFT/BUILD an
// artifact, not a bare mention of "plan" ("...risks with this plan" stays conflict_risk).
const EVIDENCE_CHECK = /\b(evidence|support\w*|backs? (this|that|it)|what backs|substantiat\w*|corroborat\w*|proof|prove[sd]?)\b/i;
const CONFLICT_RISK = /\b(conflict\w*|contradict\w*|disagree\w*|tension\w*|risk\w*|problem\w*|issue\w*|concern\w*|blocker\w*|pitfall\w*|drawback\w*|downside\w*|gap\w*)\b|\bwhat'?s wrong\b/i;
const COMPARISON = /\b(compare\w*|comparison\w*|versus|vs\.?|difference between|which is better|trade-?offs?|better option)\b/i;
const SUMMARY = /\b(summar\w*|overview|recap\w*|tl;?dr|gist|high[- ]level)\b/i;
const PLANNING_DRAFT = /\b(draft\w*|outlin\w*|compos\w*)\b|\bmake me\b|\bplan for\b|\b(make|create|build|prepare|writ\w*|put together|generat\w*)\b[\s\w]{0,20}\b(plan\w*|email\w*|roadmap\w*|proposal\w*|agenda|checklist\w*|memo\w*|message\w*|doc\w*|document\w*|report\w*|letter\w*)\b/i;
const ADVICE_STRATEGY = /\bhow (do|can|should|might|would) (i|we|you)\b|\bhow to\b|\bwhat should (i|we)\b|\bshould (i|we)\b|\b(recommend\w*|advice|advis\w*|strateg\w*|best way|improv\w*|grow\w*|optimi[sz]\w*|increas\w*|scale up|next steps?)\b/i;
const DECISION_LOOKUP = /\b(decid\w*|decision\w*|agree\w*|chose|choos\w*|chosen|settled on|conclud\w*|opted? for)\b/i;
// Phase 2 evidence-synthesis intents. Checked LAST (after every existing family), so anything an
// existing pattern already routed (advice "why should we...", decision "why did we decide...",
// conflict "why is this a problem...") keeps its current intent — these only rescue prompts that
// previously fell through to factual_lookup. English uses \b word patterns; Chinese uses plain
// substring alternation (\b does not work across CJK).
const SYNTHESIS_CONCLUSION =
  /\btakeaways?\b|\bdraw\w*\s+(a\s+|any\s+)?conclusions?\b|\bwhat\s+conclusions?\b|\bconclusions?\s+(can|could|do|does|should|would|might)\b|\bwhat\s+(does|do)\s+(all\s+)?(this|these|that|those|it)\b[\w\s]{0,30}\b(tell|mean|say|suggest|show|imply)\w*|\bwhat\s+patterns?\b|\bkey\s+insights?\b/i;
const SYNTHESIS_CONCLUSION_CJK = /结论|说明了什么|说明什么|总结出|什么规律/u;
const WHY_EXPLANATION =
  /\bwhy\b|\bwhat\s+explains?\b|\bwhat\s+(is|was)\s+the\s+(likely\s+|main\s+|root\s+)?(reason|cause)s?\b|\breasons?\s+(for|behind|why)\b|\broot\s+causes?\b/i;
const WHY_EXPLANATION_CJK = /为什么|原因是什么|什么原因/u;

function classifyIntent(lower: string): AskAIQueryIntent {
  const analysis = PLANNING_DRAFT.test(lower) ? "planning_draft" : ADVICE_STRATEGY.test(lower) ? "advice_strategy" : null;
  const lookup = EVIDENCE_CHECK.test(lower) ? "evidence_check" : DECISION_LOOKUP.test(lower) ? "decision_lookup" : null;
  // Genuinely combined ask (e.g. "what did we decide and how should we improve it?").
  if (analysis && lookup) return "mixed";
  if (EVIDENCE_CHECK.test(lower)) return "evidence_check";
  if (CONFLICT_RISK.test(lower)) return "conflict_risk";
  if (COMPARISON.test(lower)) return "comparison";
  if (SUMMARY.test(lower)) return "summary";
  if (analysis) return analysis;
  if (DECISION_LOOKUP.test(lower)) return "decision_lookup";
  if (SYNTHESIS_CONCLUSION.test(lower) || SYNTHESIS_CONCLUSION_CJK.test(lower)) return "synthesis_conclusion";
  if (WHY_EXPLANATION.test(lower) || WHY_EXPLANATION_CJK.test(lower)) return "why_explanation";
  return "factual_lookup";
}

/**
 * Evidence-synthesis intents (Phase 2): conclusion/takeaway and why/reason questions. They answer by
 * synthesizing across SELECTED transcript evidence — never by uncited general reasoning — so they lean
 * on memory objects and the exploratory (multi-evidence) answer mode. Deterministic; exported so the
 * LLM query-understanding merge derives the SAME behavior when it proposes one of these intent labels.
 */
export function intentPrefersEvidenceSynthesis(intent: AskAIQueryIntent): boolean {
  return intent === "synthesis_conclusion" || intent === "why_explanation";
}

/**
 * Deterministic per-intent claim-kind preference. Conclusions are patterns/inferences across evidence;
 * explanations are inferences anchored by facts. Existing intents return undefined (keep current kinds).
 */
export function preferredClaimKindsForIntent(intent: AskAIQueryIntent): ClaimKind[] | undefined {
  if (intent === "synthesis_conclusion") return ["pattern", "inference"];
  if (intent === "why_explanation") return ["inference", "fact"];
  return undefined;
}

/**
 * Per-intent answer contract — the ONLY source of contract flags. The pipeline consumes it to gate the
 * (uncited) analysis branch and unconfirmed context; factual refusal/scoring stay evidence-driven.
 * `requireEvidenceForFactualClaims` is always true. Lookup-style intents keep refuse-if-no-evidence;
 * analysis-style intents flip it off. Exported so LLM-proposed intents get the SAME deterministic
 * contract — an LLM proposal can pick an intent label, never author contract flags.
 */
export function contractForIntent(intent: AskAIQueryIntent): AskAIAnswerContract {
  const base: AskAIAnswerContract = {
    requireEvidenceForFactualClaims: true, allowGeneralReasoning: false, allowRecommendations: false,
    refuseIfNoEvidence: true, includeReviewOnlyItems: false, includeConflicts: false, allowDrafting: false,
  };
  switch (intent) {
    case "decision_lookup": return { ...base, includeConflicts: true };
    case "evidence_check": return { ...base, includeConflicts: true };
    case "comparison": return { ...base, includeConflicts: true };
    case "conflict_risk": return { ...base, allowGeneralReasoning: true, refuseIfNoEvidence: false, includeReviewOnlyItems: true, includeConflicts: true };
    case "advice_strategy": return { ...base, allowGeneralReasoning: true, allowRecommendations: true, refuseIfNoEvidence: false, includeReviewOnlyItems: true, includeConflicts: true };
    case "planning_draft": return { ...base, allowGeneralReasoning: true, allowRecommendations: true, refuseIfNoEvidence: false, includeReviewOnlyItems: true, includeConflicts: true, allowDrafting: true };
    case "mixed": return { ...base, allowGeneralReasoning: true, allowRecommendations: true, refuseIfNoEvidence: false, includeReviewOnlyItems: true, includeConflicts: true };
    // Phase 2 evidence-synthesis intents: strictly evidence-bounded (refuse with no evidence, no uncited
    // general reasoning/recommendations/drafting — the AI-analysis branch never runs), with conflicts
    // surfaced so a conclusion/explanation never hides opposing evidence. NOT the advice path.
    case "synthesis_conclusion": return { ...base, includeConflicts: true };
    case "why_explanation": return { ...base, includeConflicts: true };
    case "summary": return base;
    case "factual_lookup": default: return base;
  }
}

export function understandQuestion(question: string, options: Omit<AskAIRequest, "question"> = {}): QueryUnderstanding {
  const normalizedQuestion = question.trim().replace(/\s+/g, " ");
  if (!normalizedQuestion) throw new ValidationError("Ask AI question must not be empty");
  const lower = normalizedQuestion.toLowerCase();
  const needsRecommendation = options.mode === "recommendation" || /\b(should|recommend|what should|best option|what do i do)\b/.test(lower);
  const needsComparison = /\b(compare|compared|comparison|versus|vs\.?|difference|both sides)\b/.test(lower);
  const needsChronology = /\b(timeline|chronology|before|after|when|sequence)\b/.test(lower);
  const isSummary = options.mode === "summary" || /\b(summarize|summary|overview|recap)\b/.test(lower);
  const isPattern = /\b(pattern|often|usually|repeated|trend)\b/.test(lower);
  const isInference = /\b(why|infer|suggest|imply|likely)\b/.test(lower);
  const intent = classifyIntent(lower);
  // Evidence-synthesis intents answer across multiple pieces of evidence: exploratory mode (unless the
  // caller set one explicitly) and intent-preferred claim kinds. Both derivations are deterministic.
  const synthesisIntent = intentPrefersEvidenceSynthesis(intent);
  const answerMode: AskAIAnswerMode = options.mode ?? (needsRecommendation ? "recommendation" : isSummary ? "summary" : synthesisIntent || needsComparison || needsChronology ? "exploratory" : "direct");
  const requestedClaimKinds: ClaimKind[] = preferredClaimKindsForIntent(intent) ?? unique([
    needsRecommendation ? "recommendation" : "",
    isPattern ? "pattern" : "",
    isInference ? "inference" : "",
    !needsRecommendation && !isPattern && !isInference ? "fact" : "",
  ]) as ClaimKind[];
  const detectedEntities = unique([
    ...(normalizedQuestion.match(/\b[A-Z][\p{L}\p{N}_'-]*(?:\s+[A-Z][\p{L}\p{N}_'-]*)*/gu) ?? []).filter((value) => !/^(What|Why|When|How|Do|Does|Is|Are)$/i.test(value)),
    ...(options.entityIds ?? []),
  ]);
  const quoted = [...normalizedQuestion.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
  const timeHints = unique(normalizedQuestion.match(/\b(?:recently|today|yesterday|last week|last month|before|after|20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december)\b/gi) ?? []);
  return {
    originalQuestion: question, normalizedQuestion, answerMode, intent, answerContract: contractForIntent(intent),
    detectedEntities, detectedTopics: quoted, timeHints,
    requestedClaimKinds, needsRecommendation, needsComparison, needsChronology,
    shouldUseMemoryObjects: answerMode !== "direct" || isPattern || synthesisIntent, shouldUseRawTranscriptSpans: true,
    transcriptIds: [...(options.transcriptIds ?? [])], entityIds: [...(options.entityIds ?? [])],
    memoryObjectIds: [...(options.memoryObjectIds ?? [])], timeRange: options.timeRange,
    understandingSource: "deterministic",
  };
}
