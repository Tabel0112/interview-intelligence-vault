import { ValidationError } from "../db/errors.js";
import type { AskAIAnswerMode, AskAIRequest, ClaimKind, QueryUnderstanding } from "./types.js";

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

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
  const answerMode: AskAIAnswerMode = options.mode ?? (needsRecommendation ? "recommendation" : isSummary ? "summary" : needsComparison || needsChronology ? "exploratory" : "direct");
  const requestedClaimKinds: ClaimKind[] = unique([
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
    originalQuestion: question, normalizedQuestion, answerMode, detectedEntities, detectedTopics: quoted, timeHints,
    requestedClaimKinds, needsRecommendation, needsComparison, needsChronology,
    shouldUseMemoryObjects: answerMode !== "direct" || isPattern, shouldUseRawTranscriptSpans: true,
    transcriptIds: [...(options.transcriptIds ?? [])], entityIds: [...(options.entityIds ?? [])],
    memoryObjectIds: [...(options.memoryObjectIds ?? [])], timeRange: options.timeRange,
  };
}
