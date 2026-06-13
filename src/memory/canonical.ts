import type { MemoryObjectStatus, MemoryObjectType } from "../db/schema.js";
import type { ConfidenceLabel, ExtractionMemoryObjectStatus, ExtractionMemoryObjectType } from "./extraction/types.js";

export type CanonicalMemoryObjectType = MemoryObjectType | ExtractionMemoryObjectType;
export type CanonicalMemoryObjectStatus = MemoryObjectStatus | "weak";

/**
 * Canonical downstream representation.
 *
 * Trust decisions must use `type` and `status` here, never raw
 * `memory_objects.type/status`. Extraction-specific fields override legacy
 * compatibility fields when present.
 */
export interface CanonicalMemoryObject {
  id: string;
  type: CanonicalMemoryObjectType;
  status: CanonicalMemoryObjectStatus;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  title: string;
  body: string;
  evidenceSpanIds: string[];
  duplicateOfId: string | null;
  userCorrected: boolean;
}

export interface RawMemoryObjectForCanonical {
  id: string;
  type: MemoryObjectType;
  status: MemoryObjectStatus;
  confidence: number;
  title: string | null;
  generated_text: string;
  extraction_type?: ExtractionMemoryObjectType | null;
  extraction_status?: ExtractionMemoryObjectStatus | null;
  confidence_label?: ConfidenceLabel | null;
  duplicate_of_id?: string | null;
  user_corrected?: number | boolean | null;
}

function confidenceLabel(confidence: number): ConfidenceLabel {
  return confidence >= 0.8 ? "high" : confidence >= 0.6 ? "medium" : "low";
}

export function getCanonicalMemoryObject(row: RawMemoryObjectForCanonical, evidenceSpanIds: string[]): CanonicalMemoryObject {
  return {
    id: row.id,
    type: row.extraction_type ?? row.type,
    status: row.extraction_status ?? row.status,
    confidence: row.confidence,
    confidenceLabel: row.confidence_label ?? confidenceLabel(row.confidence),
    title: row.title ?? "",
    body: row.generated_text,
    evidenceSpanIds: [...new Set(evidenceSpanIds)],
    duplicateOfId: row.duplicate_of_id ?? null,
    userCorrected: Boolean(row.user_corrected),
  };
}

export function isStrongMemoryObject(memory: CanonicalMemoryObject): boolean {
  return memory.status === "active"
    && memory.evidenceSpanIds.length > 0
    && memory.duplicateOfId == null
    && (memory.userCorrected || (memory.confidenceLabel === "high" && memory.confidence >= 0.8));
}

export function isReviewableMemoryObject(memory: CanonicalMemoryObject): boolean {
  return (memory.status === "weak" || memory.status === "needs_review")
    && memory.evidenceSpanIds.length > 0;
}

export function isUsableAsEvidence(memory: CanonicalMemoryObject, options: { includeWeak?: boolean; includeDuplicates?: boolean } = {}): boolean {
  if (memory.duplicateOfId != null && !options.includeDuplicates) return false;
  if (isStrongMemoryObject(memory) || (options.includeDuplicates === true && isStrongMemoryObject({ ...memory, duplicateOfId: null }))) return true;
  return options.includeWeak === true && isReviewableMemoryObject(memory);
}
