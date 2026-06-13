export type TranscriptFormat = "txt" | "md" | "srt" | "vtt";
export type TranscriptImportSourceType = "upload" | "paste" | "vault_file" | "test";

export interface TranscriptImportInput {
  filename: string;
  rawText: string;
  sourceType?: TranscriptImportSourceType;
  importedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface TranscriptImportResult {
  status: "imported" | "duplicate";
  transcriptId: string;
  rawSha256: string;
  duplicateOfTranscriptId?: string;
  warning?: string;
  turnsCreated: number;
  spansCreated: number;
}

export interface ParsedTurn {
  turnIndex: number;
  speakerLabel: string | null;
  speakerNormalized: string | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
  rawText: string;
}

export interface ParsedSpan {
  spanIndex: number;
  kind: "turn";
  speakerLabel: string | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  startLine: number;
  endLine: number;
  startChar: number;
  endChar: number;
  text: string;
}
