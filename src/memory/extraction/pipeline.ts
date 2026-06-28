import type { SqliteDatabase } from "../../db/connection.js";
import { MEMORY_EXTRACTION_PROMPT_VERSION } from "./prompt.js";
import { findDuplicateMemoryObject } from "./duplicateDetection.js";
import {
  attachEvidenceToMemory, buildExtractionWindows, completeExtractionRun, createExtractionRun, failExtractionRun,
  loadSpansForTranscript, markDuplicate, storeMemoryObjectWithEvidence,
} from "./repository.js";
import type { ExtractionRunResult, MemoryExtractor } from "./types.js";
import { validateMemoryCandidate } from "./validator.js";

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
        // LLM-extracted memory is never auto-promoted to trusted/active: cap every LLM candidate to
        // needs_review (downgrade only). Deterministic extraction is unaffected.
        const candidate = options.extractor.kind === "llm"
          ? { ...validation.candidate, status: "needs_review" as const }
          : validation.candidate;
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
          storeMemoryObjectWithEvidence(db, runId, promptVersion, candidate);
          result.objectsInserted++;
          if (candidate.status !== "active") result.weakObjectsInserted++;
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
