export interface ObsidianViewConfig {
  outputRoot: string;
  cleanBeforeWrite?: boolean;
  includeTranscriptNotes?: boolean;
  includeMemoryNotes?: boolean;
  includeEntityNotes?: boolean;
  includeAnswerNotes?: boolean;
  includeConflictNotes?: boolean;
  includeEvidenceNotes?: boolean;
  includeGraphJson?: boolean;
  includeGraphMarkdown?: boolean;
  maxQuoteLength?: number;
  now?: () => Date;
}
export type GeneratedFileLogicalType = "home" | "transcript_note" | "memory_note" | "person_note" | "topic_note" | "decision_note" | "evidence_note" | "answer_note" | "conflict_note" | "graph_markdown" | "graph_json" | "system_manifest";
export interface GeneratedFile { logicalType: GeneratedFileLogicalType; entityType?: string; entityId?: string; relativePath: string; content: string; contentHash: string; }
export type ObsidianGraphNodeType = "transcript" | "span" | "evidence" | "memory" | "person" | "topic" | "decision" | "answer" | "claim" | "conflict";
export type ObsidianGraphEdgeType = "cites" | "supports" | "contradicts" | "updates" | "mentions" | "belongs_to" | "about" | "decided_in" | "answered_by" | "derived_from";
export interface ObsidianGraphNode { id: string; type: ObsidianGraphNodeType; label: string; notePath?: string; sourceUri?: string; evidenceUri?: string; transcriptId?: string; spanId?: string; confidence?: number; supportStatus?: string; metadata?: Record<string, unknown>; }
export interface ObsidianGraphEdge { id: string; source: string; target: string; type: ObsidianGraphEdgeType; label?: string; evidencePointerId?: string; confidence?: number; metadata?: Record<string, unknown>; }
export interface ObsidianGraph { nodes: ObsidianGraphNode[]; edges: ObsidianGraphEdge[]; }
export interface ObsidianViewManifest { version: 1; generatedFrom: "sqlite"; contentHash: string; files: Array<Omit<GeneratedFile, "content">>; entityPaths: Record<string, string>; graphStats: { nodes: number; edges: number }; warnings: string[]; brokenPointerCount: number; }
export interface ObsidianViewResult { outputRoot: string; filesWritten: number; filesSkipped: number; graphNodeCount: number; graphEdgeCount: number; warnings: string[]; errors: string[]; manifestPath: string; contentHash: string; files: GeneratedFile[]; }
export interface ClickbackTarget { transcriptId: string; spanId: string; startOffset: number; endOffset: number; notePath: string; anchorId: string; }
