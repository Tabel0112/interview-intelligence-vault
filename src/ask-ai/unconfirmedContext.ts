// LIVE-ONLY unconfirmed / tentative / conflict context retrieval (sub-step A).
//
// For broad/advice/conflict prompts (gated by the answer contract), surface review-only / weak / tentative
// / possible-duplicate / degraded memories and relevant active conflicts as clearly-labeled, NON-confirmed
// context. This NEVER:
//   - creates evidence_pointers or source_pointers (it only READS existing ones for an optional context link),
//   - promotes a memory to active or turns anything into a supported claim/citation,
//   - includes rejected/superseded/dismissed history.
// It reuses the existing retrieval engine (searchMemoryObjects) plus the conflict repository. Results are
// capped and relevance-filtered so broad prompts don't dump every review item.

import type { SqliteDatabase } from "../db/connection.js";
import { createConflictRepository } from "../conflicts/index.js";
import { createMemoryObjectsRepo } from "../db/repositories/memoryObjectsRepo.js";
import { searchMemoryObjects, type EmbeddingProvider } from "../retrieval/index.js";
import { UNCONFIRMED_DISCLAIMER, type AskAIUnconfirmedItem, type QueryUnderstanding } from "./types.js";

const MEMORY_CAP = 6;
const CONFLICT_CAP = 6;
const TENTATIVE = /\b(maybe|perhaps|possibly|probably|might|tentative\w*|consider(?:ing)?|proposed|propose|discussed?|i think|not sure|unsure)\b/i;
const STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "is", "are", "be", "we", "i", "it", "this", "that", "what", "should", "do", "does", "how", "with", "about", "our"]);

const tokens = (text: string): Set<string> =>
  new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((token) => token.length > 2 && !STOPWORDS.has(token)));
const sharesToken = (queryTokens: Set<string>, text: string): boolean => {
  for (const token of tokens(text)) if (queryTokens.has(token)) return true;
  return false;
};
const labelFor = (kind: AskAIUnconfirmedItem["kind"]): string =>
  kind === "conflict" ? "Conflict / tension" : kind === "tentative" ? "Tentative idea"
    : kind === "possible_duplicate" ? "Possible duplicate" : kind === "degraded" ? "Missing evidence" : "Review-only";

/**
 * Retrieve unconfirmed context for a query, honoring its answer contract:
 *   - includeReviewOnlyItems => review-only/weak/tentative/possible-duplicate/degraded memories
 *   - includeConflicts       => relevant active conflicts/tensions
 * Returns [] when the contract allows neither (the pipeline also gates the call).
 */
export async function retrieveUnconfirmedContext(db: SqliteDatabase, query: QueryUnderstanding, options: { embeddingProvider?: EmbeddingProvider } = {}): Promise<AskAIUnconfirmedItem[]> {
  const contract = query.answerContract;
  const items: AskAIUnconfirmedItem[] = [];

  if (contract.includeReviewOnlyItems) {
    const memoryRepo = createMemoryObjectsRepo(db);
    // conflict_risk ("what's uncertain/risky?") wants ALL review-only items (capped); other contracts use
    // keyword relevance so broad advice prompts don't dump every review item. Either way, needs_review/weak
    // only — rejected/superseded dismissed history is never surfaced.
    const memoryIds = query.intent === "conflict_risk"
      ? memoryRepo.listCanonicalMemoryObjects().filter((m) => m.status === "needs_review" || m.status === "weak").map((m) => m.id)
      : (await searchMemoryObjects(db, {
          query: query.normalizedQuestion, mode: "hybrid", finalLimit: MEMORY_CAP * 3, embeddingProvider: options.embeddingProvider,
          filters: { memoryStatuses: ["needs_review", "weak"], includeUnsupportedMemory: true },
        })).map((candidate) => candidate.targetId);
    for (const memoryId of memoryIds) {
      if (items.filter((item) => item.memoryId).length >= MEMORY_CAP) break;
      const canonical = memoryRepo.getCanonicalMemoryObject(memoryId);
      if (!canonical || (canonical.status !== "needs_review" && canonical.status !== "weak")) continue; // never rejected/superseded/active
      const hasSpan = canonical.evidenceSpanIds.length > 0;
      const tentative = TENTATIVE.test(`${canonical.title} ${canonical.body}`);
      const kind: AskAIUnconfirmedItem["kind"] = !hasSpan ? "degraded"
        : canonical.duplicateOfId ? "possible_duplicate" : tentative ? "tentative" : "review_only";
      // A live evidence pointer (rare for unbridged review-only memory) may be linked as CONTEXT only — never
      // a supported citation. Read-only; this never creates a pointer.
      const livePointer = hasSpan
        ? (db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id=? ORDER BY evidence_pointer_id LIMIT 1").get(memoryId) as { evidence_pointer_id: string } | undefined)?.evidence_pointer_id
        : undefined;
      items.push({
        id: `unc_mem_${memoryId}`, kind, memoryId,
        text: canonical.title || canonical.body, label: labelFor(kind), warning: UNCONFIRMED_DISCLAIMER,
        ...(livePointer ? { evidencePointerId: livePointer, evidenceUri: `mv://evidence/${livePointer}` } : {}),
        ...(hasSpan ? {} : { missingEvidence: true }),
      });
    }
  }

  if (contract.includeConflicts) {
    const queryTokens = tokens(query.normalizedQuestion);
    const repo = createConflictRepository(db);
    const conflicts = repo.listActiveConflicts();
    for (const conflict of conflicts) {
      if (items.filter((item) => item.conflictId).length >= CONFLICT_CAP) break;
      // A conflict/risk-seeking prompt wants all conflicts; otherwise require a shared content token so broad
      // advice/decision prompts don't dump unrelated conflicts.
      const haystack = `${conflict.summary} ${conflict.explanation}`;
      const relevant = query.intent === "conflict_risk" || queryTokens.size === 0 || sharesToken(queryTokens, haystack);
      if (!relevant) continue;
      const live = conflict.evidenceLinks.some((link) => link.evidencePointerId);
      items.push({
        id: `unc_conf_${conflict.id}`, kind: "conflict", conflictId: conflict.id,
        text: `${conflict.summary}. ${conflict.explanation}`, label: labelFor("conflict"), warning: UNCONFIRMED_DISCLAIMER,
        ...(live ? {} : { missingEvidence: true }),
      });
    }
  }
  return items;
}
