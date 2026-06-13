import type { SqliteDatabase } from "../db/connection.js";
import type { RetrievalCandidate } from "../retrieval/types.js";
import { createHermesRepository } from "./repository.js";
import type { HermesDefaultFilters, HermesPersonalizationSummary, HermesProfile } from "./types.js";

const summary = (): HermesPersonalizationSummary => ({ personalizationOnly: true, styleHints: [], filterHints: [], rankingHints: [], followupHints: [] });
export const buildHermesContext = (userId: string, db: SqliteDatabase): HermesProfile => createHermesRepository(db).getHermesProfile(userId) ?? createHermesRepository(db).createDefaultHermesProfile(userId);

export function applyHermesQueryHints(query: string, profile: HermesProfile) {
  const topics = profile.topics.filter((topic) => topic.weight >= 0.7 && !query.toLowerCase().includes(topic.topic.toLowerCase())).slice(0, 2).map((topic) => topic.topic);
  const personalizationSummary = summary();
  if (topics.length) personalizationSummary.rankingHints.push(`Query expansion hints: ${topics.join(", ")}`);
  return { query, expansionHints: topics, personalizationSummary };
}

export function applyHermesDefaultFilters(request: HermesDefaultFilters, profile: HermesProfile) {
  const filters: HermesDefaultFilters = {
    transcriptIds: request.transcriptIds ?? profile.defaultFilters.transcriptIds,
    dateRange: request.dateRange ?? profile.defaultFilters.dateRange,
    speakerIds: request.speakerIds ?? profile.defaultFilters.speakerIds,
    labels: request.labels ?? profile.defaultFilters.labels,
  };
  const personalizationSummary = summary();
  for (const key of Object.keys(filters)) if ((request as Record<string, unknown>)[key] == null) personalizationSummary.filterHints.push(`Applied default ${key}`);
  return { filters, personalizationSummary };
}

export function applyHermesRankingHints(candidates: RetrievalCandidate[], profile: HermesProfile) {
  const preferred = new Set([...(profile.rankingPreferences.preferredTopics ?? []), ...profile.topics.filter((topic) => topic.weight >= 0.7).map((topic) => topic.topic)].map((item) => item.toLowerCase()));
  const originalIndex = new Map(candidates.map((item, index) => [item.targetId, index]));
  const reordered = [...candidates].sort((a, b) => {
    if (Math.abs(a.finalScore - b.finalScore) > 0.05) return b.finalScore - a.finalScore;
    const matches = (item: RetrievalCandidate) => [...preferred].some((topic) => `${item.title ?? ""} ${item.textPreview}`.toLowerCase().includes(topic)) ? 1 : 0;
    return matches(b) - matches(a) || originalIndex.get(a.targetId)! - originalIndex.get(b.targetId)!;
  });
  const personalizationSummary = summary();
  if (reordered.some((item, index) => item.targetId !== candidates[index]?.targetId)) personalizationSummary.rankingHints.push("Reordered close-score candidates using preferred topics; scores unchanged.");
  return { candidates: reordered, personalizationSummary };
}

export function formatAnswerWithHermesStyle(answer: string, profile: HermesProfile) {
  const personalizationSummary = summary();
  personalizationSummary.styleHints.push(`Tone=${profile.answerStyle.tone}; verbosity=${profile.answerStyle.verbosity}`);
  const prefix = profile.answerStyle.tone === "technical" ? "**Technical view**\n\n" : profile.answerStyle.tone === "explanatory" ? "**Explanation**\n\n" : "";
  return { answer: `${prefix}${answer}`, personalizationSummary };
}

export function buildSuggestedFollowups(answer: string, evidence: unknown[], profile: HermesProfile) {
  const preferences = profile.suggestedFollowupPreferences, personalizationSummary = summary();
  if (!preferences.includeSuggestedFollowups) return { followups: [], personalizationSummary };
  const topics = profile.topics.slice(0, preferences.maxFollowups).map((topic) => `Explore how ${topic.topic} relates to this answer.`);
  const fallback = evidence.length ? ["Show the exact supporting transcript spans.", "Review opposing or conditional evidence."] : ["Broaden the evidence search."];
  const followups = [...topics, ...fallback].slice(0, preferences.maxFollowups);
  personalizationSummary.followupHints.push(`Limited suggested follow-ups to ${preferences.maxFollowups}.`);
  return { followups, personalizationSummary };
}
