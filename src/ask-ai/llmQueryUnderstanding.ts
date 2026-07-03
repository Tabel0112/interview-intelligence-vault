// LLM-backed query understanding (Phase 1): a retrieval/classification PLANNER, never an answerer.
//
// Implements the AskAIQueryUnderstandingModel seam on top of a transport-level LlmProvider. The model
// sees ONLY the user's question and may propose ONLY QueryUnderstandingProposal fields (intent label,
// claim kinds, entities, topics, time hints). Everything else stays deterministic:
//   - the answer contract is ALWAYS recomputed via contractForIntent (the LLM cannot author contract,
//     trust, scoring, citation, or evidence-sufficiency flags — unknown JSON fields are stripped);
//   - enum values are clamped to the existing AskAIQueryIntent / ClaimKind unions (invalid -> dropped);
//   - strings are normalized, empties stripped, arrays deduped and length-capped.
//
// Failure policy: malformed JSON / provider failure / timeout throws QueryUnderstandingError, and the
// caller (understandQuestionWithModel) falls back to the deterministic understandQuestion result — the
// seam can improve routing and retrieval hints but can never crash Ask AI or persist partial output.
// Errors are generic and key-free; provider internals/API keys are never logged, persisted, or surfaced.
//
// Fail-closed gates are untouched: this seam is resolved from the SAME configured external LLM as
// synthesis, and the llmRequired / embedding gates run before Ask AI regardless of this seam.

import type { LlmProvider, LlmRequestOptions } from "../llm/index.js";
import { contractForIntent, intentPrefersEvidenceSynthesis, preferredClaimKindsForIntent, understandQuestion } from "./queryUnderstanding.js";
import type { AskAIQueryIntent, AskAIQueryUnderstandingModel, AskAIRequest, ClaimKind, QueryUnderstanding, QueryUnderstandingProposal } from "./types.js";

export class QueryUnderstandingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "QueryUnderstandingError";
  }
}

// v2: adds the Phase 2 evidence-synthesis intents (synthesis_conclusion / why_explanation) with
// classification hints, including Chinese examples. The contract for a proposed intent label is still
// computed deterministically (contractForIntent) — the prompt/parser change only widens the label set.
export const QUERY_UNDERSTANDING_PROMPT_VERSION = "mvp-query-understanding-llm-v2";

const QUERY_INTENTS: readonly AskAIQueryIntent[] = [
  "factual_lookup", "decision_lookup", "evidence_check", "advice_strategy",
  "planning_draft", "conflict_risk", "comparison", "summary", "mixed",
  "synthesis_conclusion", "why_explanation",
];
const CLAIM_KINDS: readonly ClaimKind[] = ["fact", "pattern", "inference", "recommendation"];

/** Bounds on sanitized proposal content, so a bad/adversarial completion cannot bloat the pipeline. */
const MAX_PROPOSED_ITEMS = 8;
const MAX_MERGED_ITEMS = 16;
const MAX_ITEM_LENGTH = 200;

export const QUERY_UNDERSTANDING_SYSTEM = [
  "You plan retrieval for a personal transcript-memory vault. You are NOT answering the user's question;",
  "you only classify it and extract retrieval hints. Do not invent facts. Do not create claims or answers.",
  "Do not cite, select, or evaluate evidence, and do not decide whether evidence is sufficient.",
  "Do not set trust, scoring, citation, contract, or refusal fields — any such fields are ignored.",
  "Preserve uncertainty: omit any field you are not confident about (a deterministic classifier fills the gaps).",
  "The question may be in any language; keep entities and topics in the question's own language.",
  "Respond with JSON only.",
].join(" ");

export function buildQueryUnderstandingPrompt(question: string): string {
  return [
    `Question: ${question}`,
    "",
    "Classify the question and extract retrieval hints for searching the user's own transcripts.",
    `Return JSON of the form: {"intent":"${QUERY_INTENTS.join("|")}","claimKinds":["${CLAIM_KINDS.join("|")}"],"entities":["..."],"topics":["..."],"timeHints":["..."]}`,
    'Takeaway/conclusion/pattern questions (e.g. "what is the takeaway", "what does all this tell us", "得出什么结论", "这说明了什么") are synthesis_conclusion. Why/reason/explanation questions (e.g. "why is this happening", "what explains this", "为什么", "原因是什么") are why_explanation. Both still answer ONLY from the user\'s transcript evidence — they are not advice.',
    "Every field is optional — omit anything uncertain. entities are people/organizations/products named in the question; topics are its subject phrases; timeHints are time expressions.",
  ].join("\n");
}

const normalizeItem = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= MAX_ITEM_LENGTH ? normalized : normalized ? normalized.slice(0, MAX_ITEM_LENGTH) : null;
};

const sanitizeStrings = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = [...new Set(value.map(normalizeItem).filter((item): item is string => item != null))].slice(0, MAX_PROPOSED_ITEMS);
  return items.length ? items : undefined;
};

/**
 * Strictly validate the LLM JSON into a safe proposal. Throws QueryUnderstandingError on malformed JSON
 * or a non-object payload. Everything else is clamped, not trusted: unknown fields (including any
 * contract/trust/scoring keys the model may emit) are stripped, enum values outside the known unions are
 * dropped, strings are normalized and deduped, and arrays are length-capped.
 */
export function parseQueryUnderstandingProposal(rawText: string): QueryUnderstandingProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new QueryUnderstandingError("LLM query-understanding output was not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new QueryUnderstandingError("LLM query-understanding output was not a JSON object");
  }
  const candidate = parsed as Record<string, unknown>;
  const proposal: QueryUnderstandingProposal = {};
  if (typeof candidate.intent === "string" && QUERY_INTENTS.includes(candidate.intent as AskAIQueryIntent)) {
    proposal.intent = candidate.intent as AskAIQueryIntent;
  }
  if (Array.isArray(candidate.claimKinds)) {
    const kinds = [...new Set(candidate.claimKinds.filter((kind): kind is ClaimKind => typeof kind === "string" && CLAIM_KINDS.includes(kind as ClaimKind)))];
    if (kinds.length) proposal.requestedClaimKinds = kinds;
  }
  const entities = sanitizeStrings(candidate.entities);
  if (entities) proposal.detectedEntities = entities;
  const topics = sanitizeStrings(candidate.topics);
  if (topics) proposal.detectedTopics = topics;
  const timeHints = sanitizeStrings(candidate.timeHints);
  if (timeHints) proposal.timeHints = timeHints;
  return proposal;
}

const mergeHints = (base: string[], proposed: string[] | undefined): string[] =>
  [...new Set([...base, ...(proposed ?? [])])].slice(0, MAX_MERGED_ITEMS);

/**
 * Deterministically apply a validated proposal on top of the deterministic base understanding.
 * The proposal can refine the intent LABEL, claim kinds, and retrieval hints; the answer contract is
 * ALWAYS recomputed here via contractForIntent, and every trust/evidence/scope field (answer mode,
 * shouldUse* flags, transcript/entity/memory filters, time range) is kept from the deterministic base.
 */
export function applyQueryUnderstandingProposal(base: QueryUnderstanding, proposal: QueryUnderstandingProposal): QueryUnderstanding {
  const intent = proposal.intent ?? base.intent;
  const synthesisIntent = intentPrefersEvidenceSynthesis(intent);
  return {
    ...base,
    intent,
    // Contract ownership stays deterministic: the proposal cannot carry contract flags (type + parser
    // both strip them), and even its intent label only selects among the fixed deterministic contracts.
    answerContract: contractForIntent(intent),
    // Claim kinds: explicit proposal wins; otherwise a rerouted intent gets its deterministic
    // preference (evidence-synthesis intents prefer pattern/inference), else the base kinds stand.
    requestedClaimKinds: proposal.requestedClaimKinds?.length ? proposal.requestedClaimKinds : preferredClaimKindsForIntent(intent) ?? base.requestedClaimKinds,
    // Evidence-synthesis intents get the SAME deterministic derivations the regex path produces:
    // exploratory (multi-evidence) mode — only ever upgrading a default "direct", never overriding an
    // explicit/summary/recommendation mode — and memory-object retrieval preference.
    answerMode: synthesisIntent && base.answerMode === "direct" ? "exploratory" : base.answerMode,
    shouldUseMemoryObjects: base.shouldUseMemoryObjects || synthesisIntent,
    detectedEntities: mergeHints(base.detectedEntities, proposal.detectedEntities),
    detectedTopics: mergeHints(base.detectedTopics, proposal.detectedTopics),
    timeHints: mergeHints(base.timeHints, proposal.timeHints),
    understandingSource: "llm",
  };
}

/**
 * Resolve the query understanding for a request: deterministic base first (still throws ValidationError
 * on an empty question), then — when a model is provided — refine it with the model's validated proposal.
 * ANY model failure (transport error, timeout, malformed/invalid JSON) falls back to the deterministic
 * base: Ask AI never crashes on, and never persists, bad query-understanding output.
 */
export async function understandQuestionWithModel(
  question: string,
  options: Omit<AskAIRequest, "question"> = {},
  model?: AskAIQueryUnderstandingModel,
): Promise<QueryUnderstanding> {
  const base = understandQuestion(question, options);
  if (!model) return base;
  try {
    return applyQueryUnderstandingProposal(base, await model.understand({ question: base.normalizedQuestion }));
  } catch {
    return base;
  }
}

/** Adapt a transport-level LlmProvider to the query-understanding seam, with strict validation. */
export function createLlmQueryUnderstandingModel(provider: LlmProvider, options: { timeoutMs?: number } = {}): AskAIQueryUnderstandingModel {
  return {
    async understand({ question }) {
      const requestOptions: LlmRequestOptions = {};
      if (options.timeoutMs != null) requestOptions.timeoutMs = options.timeoutMs;
      let text: string;
      try {
        text = (await provider.complete({ system: QUERY_UNDERSTANDING_SYSTEM, prompt: buildQueryUnderstandingPrompt(question), responseFormat: "json" }, requestOptions)).text;
      } catch {
        // Provider/transport/timeout failure. Never surface provider internals or keys; the caller
        // (understandQuestionWithModel) catches QueryUnderstandingError and uses the deterministic base.
        throw new QueryUnderstandingError("LLM query-understanding request failed");
      }
      return parseQueryUnderstandingProposal(text);
    },
  };
}
