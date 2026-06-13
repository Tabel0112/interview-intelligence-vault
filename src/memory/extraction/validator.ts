import { normalizeMemoryText, memoryFingerprint } from "./normalize.js";
import { scoreCandidateConfidence } from "./confidence.js";
import type { ExtractedMemoryCandidate, ExtractionMemoryObjectType, ExtractionWindow, ValidatedMemoryCandidate } from "./types.js";

const validTypes = new Set<ExtractionMemoryObjectType>(["topic", "quote", "question", "decision", "action_item", "objection", "advice_idea"]);
const genericTopics = new Set(["ai", "transcript", "discussion", "project"]);

export type CandidateValidationResult = { ok: true; candidate: ValidatedMemoryCandidate } | { ok: false; problem: string };

export function validateMemoryCandidate(candidate: ExtractedMemoryCandidate, window: ExtractionWindow): CandidateValidationResult {
  if (!validTypes.has(candidate.type)) return { ok: false, problem: `Invalid memory object type: ${String(candidate.type)}` };
  if (!candidate.title?.trim() || !candidate.body?.trim()) return { ok: false, problem: "Candidate title and body are required" };
  if (candidate.title.length > 300 || candidate.body.length > 4000) return { ok: false, problem: "Candidate title or body is too long" };
  if (!candidate.evidenceSpanIds?.length) return { ok: false, problem: "Candidate has no evidence spans" };
  const spanMap = new Map(window.spans.map((span) => [span.spanId, span]));
  const evidenceSpans = [...new Set(candidate.evidenceSpanIds)].map((id) => spanMap.get(id));
  if (evidenceSpans.some((span) => !span)) return { ok: false, problem: "Candidate references a span outside its extraction window" };
  const validSpans = evidenceSpans.filter((span) => span != null);
  if (validSpans.some((span) => span.transcriptId !== window.transcriptId)) return { ok: false, problem: "Evidence span belongs to another transcript" };
  if (candidate.type === "quote" && !validSpans.some((span) => span.text.includes(candidate.body))) return { ok: false, problem: "Quote body is not exact source text" };
  if (candidate.type === "topic" && genericTopics.has(candidate.title.trim().toLowerCase())) return { ok: false, problem: "Topic is too generic" };
  if (/\bthe transcript proves\b/i.test(candidate.body) && !validSpans.some((span) => /the transcript proves/i.test(span.text))) {
    return { ok: false, problem: "Candidate contains an unsupported meta-claim" };
  }
  const clamped = { ...candidate, confidence: Math.max(0, Math.min(1, Number.isFinite(candidate.confidence) ? candidate.confidence : 0)) };
  const normalizedText = normalizeMemoryText(clamped.title, clamped.body);
  const fingerprint = memoryFingerprint(clamped.type, normalizedText);
  const scored = scoreCandidateConfidence(clamped, validSpans);
  return { ok: true, candidate: { ...clamped, transcriptId: window.transcriptId, normalizedText, fingerprint, evidenceSpans: validSpans, ...scored } };
}
