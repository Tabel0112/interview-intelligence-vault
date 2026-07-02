import type { SqliteDatabase } from "../../db/connection.js";
import { classifyConflictCandidate } from "../../conflicts/rules.js";
import { assessBodyQuoteSupport } from "./bodyQuoteSupport.js";
import { MEMORY_EXTRACTION_PROMPT_VERSION } from "./prompt.js";
import { findDuplicateMemoryObject } from "./duplicateDetection.js";
import {
  attachEvidenceToMemory, buildExtractionWindows, completeExtractionRun, createExtractionRun, failExtractionRun,
  loadSpansForTranscript, markDuplicate, storeMemoryObjectWithEvidence,
} from "./repository.js";
import type { ExtractionRunResult, MemoryExtractor, ValidatedMemoryCandidate } from "./types.js";
import { validateMemoryCandidate } from "./validator.js";

/**
 * True when this candidate directly opposes an EXISTING ACTIVE memory (e.g. "use SQLite" vs "do not use
 * SQLite"). Such a statement must NOT auto-activate — it is routed to review so both sides are preserved
 * and a human (or downstream conflict detection) resolves it. Uses the deterministic conflict classifier;
 * only an evidence-backed, non-weak opposition with enough confidence blocks activation. Never deletes or
 * merges anything; it only decides whether the NEW candidate may be active.
 */
/**
 * Conservative auto-activation guard: the memory body must be STRONGLY supported by its quoted transcript
 * span(s). The quote is the candidate's evidence-span text (the immutable raw span), which carries the
 * full negation/commitment/entity context — safer than the LLM-chosen substring. `uncertain`/`unsupported`
 * blocks auto-activation (-> needs_review). See assessBodyQuoteSupport.
 */
function bodyIsStronglySupported(candidate: ValidatedMemoryCandidate): boolean {
  const quote = candidate.evidenceSpans.map((span) => span.text).join(" ");
  return assessBodyQuoteSupport(candidate.body, quote).status === "strong";
}

function conflictsWithActiveMemory(db: SqliteDatabase, candidate: ValidatedMemoryCandidate): boolean {
  const candidateText = `${candidate.title}. ${candidate.body}`;
  const candidateEvidenceIds = candidate.evidenceSpans.map((span) => span.spanId);
  const actives = db.prepare(`SELECT id, title, generated_text FROM memory_objects
    WHERE duplicate_of_id IS NULL AND (extraction_status='active' OR (extraction_status IS NULL AND status='active'))`)
    .all() as Array<{ id: string; title: string | null; generated_text: string }>;
  for (const active of actives) {
    const classification = classifyConflictCandidate({
      leftTargetId: "candidate", leftTargetType: "memory_object", leftText: candidateText, leftEvidenceIds: candidateEvidenceIds,
      rightTargetId: active.id, rightTargetType: "memory_object", rightText: `${active.title ?? ""}. ${active.generated_text}`, rightEvidenceIds: [active.id],
    });
    // weak_or_ambiguous never blocks; a real opposition (direct/tension/temporal/conditional) with
    // sufficient confidence does.
    if (classification.kind !== "weak_or_ambiguous" && classification.confidence >= 0.6) return true;
  }
  return false;
}

export async function extractMemoryObjectsForTranscript(db: SqliteDatabase, options: {
  transcriptId: string; extractor: MemoryExtractor; maxWindowChars?: number; overlapSpans?: number; force?: boolean;
}): Promise<ExtractionRunResult> {
  // Record the extractor's own prompt version (e.g. the LLM prompt version); deterministic is the default.
  const promptVersion = options.extractor.promptVersion ?? MEMORY_EXTRACTION_PROMPT_VERSION;
  const runId = createExtractionRun(db, {
    transcriptId: options.transcriptId, extractorKind: options.extractor.kind ?? "test", extractorModel: options.extractor.model,
    promptVersion, config: { maxWindowChars: options.maxWindowChars ?? 4000, overlapSpans: options.overlapSpans ?? 0, force: options.force ?? false },
  });
  const result: ExtractionRunResult = {
    extractionRunId: runId, transcriptId: options.transcriptId, windowsProcessed: 0, candidatesExtracted: 0,
    objectsInserted: 0, duplicatesSkipped: 0, weakObjectsInserted: 0, rejectedCandidates: 0, errors: [],
  };
  try {
    const spans = loadSpansForTranscript(db, options.transcriptId);
    const windows = buildExtractionWindows(spans, options.maxWindowChars, options.overlapSpans);
    for (const window of windows) {
      let candidates;
      try {
        candidates = await options.extractor.extract(window);
        result.windowsProcessed++;
      } catch (error) {
        result.errors.push(`Window ${window.windowId}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      result.candidatesExtracted += candidates.length;
      for (const extracted of candidates) {
        const validation = validateMemoryCandidate(extracted, window);
        if (!validation.ok) { result.rejectedCandidates++; result.errors.push(validation.problem); continue; }
        // Calibrated status (from scoreCandidateConfidence) decides active vs review by GROUNDING signals,
        // not the LLM's self-reported confidence. Both LLM and deterministic extraction flow through the
        // same policy; near-duplicate and active-conflict gating below can still demote to needs_review.
        const candidate = validation.candidate;
        const duplicate = findDuplicateMemoryObject(db, candidate);
        if (duplicate) {
          const canonical = duplicate.object;
          const blocked = canonical.extraction_status === "rejected" || canonical.extraction_status === "superseded";
          if (!blocked && duplicate.kind === "exact") {
            // EXACT duplicate (same type + identical normalized text = the same statement from another
            // source): consolidate this source's evidence onto the canonical; never create a competing
            // active memory. Idempotent, so re-running extraction does not create more duplicates.
            attachEvidenceToMemory(db, canonical.id, candidate);
            result.duplicatesSkipped++;
            continue;
          }
          if (!blocked) {
            // NEAR duplicate (similar wording, NOT identical): never auto-merge. Record a needs_review
            // possible-duplicate suggestion linked to the canonical so a human decides — it is surfaced in
            // the review queue, not hidden, and not promoted to an independent active memory.
            markDuplicate(db, candidate, canonical.id, runId, promptVersion);
            result.objectsInserted++;
            result.duplicatesSkipped++;
            result.weakObjectsInserted++;
            continue;
          }
          // Canonical is rejected/superseded: do not resurrect it into that lineage.
          result.duplicatesSkipped++;
          continue;
        }
        try {
          // Auto-activation requires ALL gates: the calibrated status is `active`, the body is strongly
          // supported by its quoted span (conservative; uncertain/unsupported -> review), and it does not
          // contradict an existing active memory. Any failure routes to needs_review (preserve both sides;
          // never silently auto-activate an unsupported or contradicting statement).
          const toStore = candidate.status === "active"
            && bodyIsStronglySupported(candidate)
            && !conflictsWithActiveMemory(db, candidate)
            ? candidate
            : candidate.status === "active" ? { ...candidate, status: "needs_review" as const } : candidate;
          storeMemoryObjectWithEvidence(db, runId, promptVersion, toStore);
          result.objectsInserted++;
          if (toStore.status !== "active") result.weakObjectsInserted++;
        } catch (error) {
          result.rejectedCandidates++;
          result.errors.push(`Store candidate "${candidate.title}": ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (windows.length > 0 && result.windowsProcessed === 0) failExtractionRun(db, runId, result.errors.join("\n") || "No extraction windows completed");
    else completeExtractionRun(db, runId);
    return result;
  } catch (error) {
    failExtractionRun(db, runId, error instanceof Error ? error.message : String(error));
    throw error;
  }
}
