import type { AskAIResponse } from "../ask-ai/index.js";
import type { ConflictAssessment } from "../conflicts/index.js";
import type { DeleteTranscriptSummary } from "../db/index.js";
import type { CanonicalMemoryObject } from "../memory/index.js";
import type { ObsidianGraph } from "../obsidian/index.js";
import type { EvidencePointer } from "../provenance/index.js";
import type { PluginHealth } from "../obsidian/startup.js";

export type { DeleteTranscriptSummary };
/** Outcome of a transcript hard-delete: the transcript and its derived provenance are gone (irreversible). */
export interface DeleteTranscriptResult { status: "deleted"; summary: DeleteTranscriptSummary; }

export type TrustState = "strong" | "mixed" | "weak" | "conflicting" | "no_evidence" | "broken" | "needs_review" | "rejected" | "superseded";
export type RouteId = "dashboard" | "upload" | "transcript" | "ask" | "answer" | "evidence" | "memory" | "graph" | "search" | "review" | "review_detail" | "not_found";

export interface RouteMatch {
  id: RouteId;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
}

export interface TranscriptListItem {
  id: string;
  title: string;
  sourceType: string;
  createdAt: string;
  status: string;
  importedAt: string;
  spanCount: number;
  speakerCount: number;
  processingStatus: "ready" | "processing" | "failed" | "needs_review";
}

export interface TranscriptSpanView {
  id: string;
  transcriptId: string;
  ordinal: number;
  speaker: string | null;
  startTimeMs: number | null;
  endTimeMs: number | null;
  startChar: number;
  endChar: number;
  text: string;
}

export interface TranscriptView extends TranscriptListItem {
  rawText: string;
  spans: TranscriptSpanView[];
  immutable: true;
}

export interface EvidenceView {
  id: string;
  pointerUri: string;
  sourcePointerUri: string;
  targetType: string;
  targetId: string;
  role: string;
  strength: TrustState;
  confidence: number;
  finalScore: number | null;
  quotePreview: string;
  transcriptId: string;
  transcriptTitle: string;
  spanId: string;
  spanText: string;
  rawText: string;
  brokenReason: string | null;
}

export interface MemoryView {
  memory: CanonicalMemoryObject;
  trustState: TrustState;
  evidence: EvidenceView[];
  conflicts: ConflictAssessment[];
}

/** Status of the disposable generated-Markdown view layer that powers Obsidian's native (ribbon) graph. */
export interface GeneratedSyncStatus {
  /** False => never synced (no generated notes written yet). */
  synced: boolean;
  lastSyncedAt?: string;
  fileCount?: number;
  graphNodeCount?: number;
  graphEdgeCount?: number;
  status?: "completed" | "failed";
  error?: string;
}

/** Outcome of a generated-notes sync triggered from the UI. Navigation/view layer only — never truth. */
export type GeneratedSyncResult =
  | { status: "synced"; filesWritten: number; filesSkipped: number; graphNodeCount: number; graphEdgeCount: number; warnings: string[]; errors: string[] }
  | { status: "unavailable"; message: string }
  | { status: "failed"; message: string };

export interface DashboardView {
  totalTranscriptCount: number;
  transcripts: TranscriptListItem[];
  recentAnswers: Array<{ id: string; question: string; confidence: TrustState; createdAt: string }>;
  reviewCount: number;
  weakCount: number;
  conflictCount: number;
  brokenCount: number;
  health?: PluginHealth;
  /** Live app requires a configured LLM for generation. */
  llmRequired?: boolean;
  /** Whether a usable external LLM is currently configured. */
  llmReady?: boolean;
  /** Last generated-graph-notes sync (for Obsidian's native graph); omitted in unavailable-DB states. */
  generatedSync?: GeneratedSyncStatus;
  /** Top weak/broken/conflicting review items to surface on the viewer dashboard (read-only projection). */
  attention?: ReviewItemView[];
}

export interface SearchResultView {
  type: "transcript" | "span" | "memory_object" | "answer" | "graph_node" | "evidence";
  id: string;
  title: string;
  preview: string;
  href: string;
  trustState?: TrustState;
}

export type ReviewItemType = "weak_evidence" | "broken_pointer" | "memory_needs_review" | "conflict" | "user_correction";

export interface ReviewItemView {
  id: string;
  type: ReviewItemType;
  title: string;
  detail: string;
  targetType: string;
  targetId: string;
  trustState: TrustState;
  href: string;
  createdAt: string;
  severity: "low" | "medium" | "high";
  status: "open" | "resolved" | "dismissed";
  relatedTranscriptIds: string[];
  relatedEvidenceIds: string[];
}

export interface CorrectionDraft {
  targetType: "memory_object" | "answer_claim" | "citation" | "graph_node" | "graph_edge" | "evidence" | "speaker" | "answer" | "span" | "transcript";
  targetId: string;
  correctionText: string;
  reason?: string;
}

export interface UploadInput {
  filename: string;
  rawText: string;
}

export interface FrontendApi {
  getDashboard(): Promise<DashboardView>;
  listTranscripts(): Promise<TranscriptListItem[]>;
  uploadTranscript(input: UploadInput): Promise<{ transcriptId: string; status: "imported" | "duplicate"; warning?: string }>;
  getTranscript(id: string): Promise<TranscriptView | null>;
  ask(question: string, options?: { transcriptIds?: string[]; maxEvidence?: number }): Promise<AskAIResponse>;
  askAI(question: string, options?: { transcriptIds?: string[]; maxEvidence?: number }): Promise<AskAIResponse>;
  getAnswer(id: string): Promise<FrontendAnswerView | null>;
  getEvidence(id: string): Promise<EvidenceView>;
  getMemory(id: string): Promise<MemoryView | null>;
  getMemoryObject(id: string): Promise<MemoryView | null>;
  getGraph(options?: { query?: string; limit?: number; nodeTypes?: string[] }): Promise<{ graph: ObsidianGraph; warnings: string[] }>;
  search(query: string, filters?: { type?: "all" | "transcripts" | "memory" | "answers" | "evidence"; evidenceStrength?: TrustState }): Promise<SearchResultView[]>;
  searchVault(query: string, filters?: { type?: "all" | "transcripts" | "memory" | "answers" | "evidence"; evidenceStrength?: TrustState }): Promise<{
    transcripts: SearchResultView[]; memoryObjects: SearchResultView[]; answers: SearchResultView[]; evidence: SearchResultView[];
  }>;
  listReviewItems(filter?: { type?: ReviewItemType; status?: ReviewItemView["status"] }): Promise<ReviewItemView[]>;
  getReviewItem(id: string): Promise<ReviewItemView | null>;
  submitCorrection(input: CorrectionDraft): Promise<{ correctionId: string; status: "received" }>;
  reviewMemoryObject(memoryId: string, decision: "approve" | "reject"): Promise<{ status: "approved" | "rejected"; warning?: string }>;
  /** Whether the live app requires an LLM and whether one is currently configured. */
  getLlmStatus(): Promise<{ required: boolean; ready: boolean }>;
  /** Run AI extraction for a transcript that has no completed run yet (e.g. imported before LLM setup). */
  runExtraction(transcriptId: string): Promise<{ status: "extracted" | "skipped" | "setup_required" | "failed"; warning?: string }>;
  /**
   * Hard-delete a whole transcript and its derived provenance (transactional, irreversible). Raw transcript
   * text is never edited — the wrong-import recovery flow is delete + re-import. Memories/conflicts/answers
   * are not deleted; they degrade via existing cleanup/downgrade triggers.
   */
  deleteTranscript(id: string): Promise<DeleteTranscriptResult>;
  /**
   * Write the disposable generated-Markdown view layer that powers Obsidian's native (ribbon) graph.
   * Optional: only the Obsidian plugin injects a real implementation (it needs the on-disk vault path).
   * Headless/MCP contexts return `{ status: "unavailable" }`. Never reads generated Markdown back as truth.
   */
  syncGeneratedGraphNotes?(): Promise<GeneratedSyncResult>;
}

export interface FrontendAnswerView extends AskAIResponse {
  brokenCitationIds?: string[];
}

export interface PageContext {
  api: FrontendApi;
  route: RouteMatch;
}

export interface RenderedPage {
  title: string;
  html: string;
}

export interface EvidencePointerRow extends EvidencePointer {
  transcript_title?: string;
}
