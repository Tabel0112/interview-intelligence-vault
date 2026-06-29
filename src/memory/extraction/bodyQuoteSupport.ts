// Deterministic body-to-quote support guard.
//
// A generated memory body may auto-activate ONLY if it is strongly supported by its quoted transcript
// span. This is a CONSERVATIVE gate, not a proof of semantic entailment: when in doubt it returns
// "uncertain" (-> needs_review). False negatives (sending a fine memory to review) are acceptable;
// false positives (auto-activating an unsupported body) are not.
//
// No embeddings, no LLM judgement, no broad synonym logic (e.g. SQL != SQLite). Only a couple of tiny,
// explicitly-safe paraphrase normalizations are allowed.

export type BodyQuoteSupportStatus = "strong" | "uncertain" | "unsupported";
export interface BodyQuoteSupport { status: BodyQuoteSupportStatus; reasons: string[]; }

// Common empty words. Negations, tentative words, commitment words, and entities are deliberately NOT
// here — they must survive tokenization because they drive the hard blockers and coverage.
const STOPWORDS = new Set([
  "a", "an", "and", "the", "to", "of", "in", "on", "for", "is", "are", "be", "was", "were", "been",
  "it", "its", "this", "that", "these", "those", "as", "at", "by", "with", "from", "into", "after",
  "before", "we", "i", "you", "they", "he", "she", "our", "their", "your", "his", "her", "them", "us", "me",
  "but", "or", "so", "then", "up", "out", "about", "over", "back", "also", "just", "there", "here",
]);

const NEGATIONS = new Set(["not", "no", "never", "cannot", "without"]);
const TENTATIVE = new Set(["maybe", "might", "could", "consider", "considered", "considering", "discuss", "discussed", "discussing", "proposed", "propose", "possibly", "thinking"]);
const COMMITMENT = new Set(["decided", "decide", "agreed", "agree", "confirmed", "confirm", "will", "must", "needs", "need", "final"]);

// Lowercase tokens that must always be treated as entities (so a lowercase "sqlite" still counts), in
// addition to acronyms and capitalized words detected from the original text.
const KNOWN_TECH = new Set(["sqlite", "sql", "postgresql", "postgres", "mysql", "mongodb", "markdown", "mcp", "obsidian", "claude", "redis", "duckdb"]);

// Tiny, explicitly-safe paraphrase normalizations (applied to BOTH body and quote, lowercased). These
// are the ONLY allowances — do not grow this into a synonym engine.
const SAFE_EQUIVALENCES: Array<[RegExp, string]> = [
  [/\bcannot be edited\b/g, "immutable"],
  [/\bcan ?not be edited\b/g, "immutable"],
  [/\bshould be immutable\b/g, "immutable"],
  [/\bmust be immutable\b/g, "immutable"],
  [/\b(?:is|are) immutable\b/g, "immutable"],
  [/\bonly a disposable view\b/g, "disposable"],
  [/\bdisposable view\b/g, "disposable"],
];

const NEG_CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bcan't\b/g, "cannot"], [/\bcannot\b/g, "cannot"], [/\bwon't\b/g, "will not"], [/\bdon't\b/g, "do not"],
  [/\bdoesn't\b/g, "does not"], [/\bdidn't\b/g, "did not"], [/\bshouldn't\b/g, "should not"],
  [/\bisn't\b/g, "is not"], [/\baren't\b/g, "are not"], [/\bwasn't\b/g, "was not"], [/\bweren't\b/g, "were not"],
];

function normalize(text: string): string {
  let value = text.toLowerCase();
  for (const [pattern, replacement] of NEG_CONTRACTIONS) value = value.replace(pattern, replacement);
  for (const [pattern, replacement] of SAFE_EQUIVALENCES) value = value.replace(pattern, replacement);
  return value;
}

const tokenize = (normalizedText: string): string[] => normalizedText.split(/[^a-z0-9]+/).filter(Boolean);

/** Entity-like tokens (lowercased): known tech names, acronyms, or capitalized words in the ORIGINAL text. */
function entityTokens(originalText: string): Set<string> {
  const set = new Set<string>();
  for (const raw of originalText.split(/[^A-Za-z0-9]+/).filter(Boolean)) {
    const lower = raw.toLowerCase();
    const isAcronym = /[A-Z]/.test(raw) && /^[A-Z0-9]{2,}$/.test(raw);
    const isCapitalized = /^[A-Z][a-zA-Z0-9]+$/.test(raw) && raw.length > 1;
    if (KNOWN_TECH.has(lower) || isAcronym || isCapitalized) set.add(lower);
  }
  return set;
}

/**
 * Decide whether `body` is supported by `quote` (the memory's quoted transcript span). See thresholds
 * below; the result gates auto-activation in the extraction pipeline.
 */
export function assessBodyQuoteSupport(body: string, quote: string): BodyQuoteSupport {
  const reasons: string[] = [];
  const bodyNorm = normalize(body);
  const quoteNorm = normalize(quote);
  const bodyTokens = tokenize(bodyNorm);
  const quoteTokens = tokenize(quoteNorm);
  const bodySet = new Set(bodyTokens);
  const quoteSet = new Set(quoteTokens);

  if (!bodyTokens.length || !quoteTokens.length) {
    return { status: "unsupported", reasons: ["empty body or quote"] };
  }

  // --- Hard blockers -------------------------------------------------------------------------------
  // 1. Negation mismatch: one side negates and the other does not.
  const bodyHasNeg = [...NEGATIONS].some((token) => bodySet.has(token));
  const quoteHasNeg = [...NEGATIONS].some((token) => quoteSet.has(token));
  if (bodyHasNeg !== quoteHasNeg) reasons.push("negation mismatch between body and quote");

  // 2. Commitment-strength mismatch: quote is tentative/discussion-only but the body asserts a commitment.
  const quoteTentative = [...TENTATIVE].some((token) => quoteSet.has(token));
  const quoteCommitment = [...COMMITMENT].some((token) => quoteSet.has(token));
  const bodyCommitment = [...COMMITMENT].some((token) => bodySet.has(token));
  if (quoteTentative && !quoteCommitment && bodyCommitment) reasons.push("body asserts a commitment the quote only discusses tentatively");

  // 3/4. Entity / unsupported-key-term: an entity the body introduces is absent from the quote.
  const bodyEntities = entityTokens(body);
  const missingEntities = [...bodyEntities].filter((token) => !quoteSet.has(token));
  if (missingEntities.length) reasons.push(`body introduces entities absent from the quote: ${missingEntities.join(", ")}`);

  // --- Soft coverage -------------------------------------------------------------------------------
  // Body key tokens = content tokens (stopwords removed; negation/tentative/commitment/entities kept).
  const bodyKeyTokens = bodyTokens.filter((token) => !STOPWORDS.has(token));
  const keyTokens = bodyKeyTokens.length ? bodyKeyTokens : bodyTokens;
  const covered = keyTokens.filter((token) => quoteSet.has(token)).length;
  const coverage = covered / keyTokens.length;

  if (reasons.length || coverage < 0.5) {
    if (coverage < 0.5) reasons.push(`body-key-token coverage ${coverage.toFixed(2)} below 0.50`);
    return { status: "unsupported", reasons };
  }
  if (coverage >= 0.75) return { status: "strong", reasons: [] };
  return { status: "uncertain", reasons: [`body-key-token coverage ${coverage.toFixed(2)} between 0.50 and 0.75`] };
}
