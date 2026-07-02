export type ExtractionMemoryObjectType = "topic" | "quote" | "question" | "decision" | "action_item" | "objection" | "advice_idea";
export type ExtractionMemoryObjectStatus = "active" | "weak" | "needs_review" | "rejected" | "superseded";
export type ConfidenceLabel = "high" | "medium" | "low";
export type ExtractorKind = "llm" | "deterministic" | "test";

export interface TranscriptSpanForExtraction {
  transcriptId: string; turnId: string | null; spanId: string; speaker: string | null;
  startOffset: number; endOffset: number; text: string; startTimeMs: number | null; endTimeMs: number | null;
}
export interface ExtractionWindow { transcriptId: string; windowId: string; spans: TranscriptSpanForExtraction[]; text: string; }
export interface ExtractedMemoryCandidate {
  type: ExtractionMemoryObjectType; title: string; body: string; evidenceSpanIds: string[]; confidence: number; reason?: string;
}
export interface ValidatedMemoryCandidate extends ExtractedMemoryCandidate {
  transcriptId: string; normalizedText: string; fingerprint: string; confidenceLabel: ConfidenceLabel;
  status: "active" | "weak" | "needs_review"; finalConfidence: number; evidenceSpans: TranscriptSpanForExtraction[];
  /** WHY a non-active status was chosen (tentative/medium/low/unsupported-body/conflict/duplicate). Persisted to metadata for the Review queue. */
  statusReason?: string;
}
export interface MemoryExtractor {
  kind?: ExtractorKind; model?: string | null;
  /** Prompt version recorded on the extraction run/objects. Defaults to the deterministic prompt version. */
  promptVersion?: string;
  extract(window: ExtractionWindow): Promise<ExtractedMemoryCandidate[]>;
}
export interface ExtractionRunResult {
  extractionRunId: string; transcriptId: string; windowsProcessed: number; candidatesExtracted: number;
  objectsInserted: number; duplicatesSkipped: number; weakObjectsInserted: number; rejectedCandidates: number; errors: string[];
}
export interface StoredExtractedMemoryObject {
  id: string; extraction_type: ExtractionMemoryObjectType; title: string; generated_text: string;
  extraction_status: ExtractionMemoryObjectStatus; confidence: number; confidence_label: ConfidenceLabel;
  normalized_text: string; object_fingerprint: string; duplicate_of_id: string | null; user_corrected: number;
}
