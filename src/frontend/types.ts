import type { AskAIResponse } from "../ask-ai/index.js";
import type { ConflictAssessment } from "../conflicts/index.js";
import type { CanonicalMemoryObject } from "../memory/index.js";
import type { ObsidianGraph } from "../obsidian/index.js";
import type { EvidencePointer } from "../provenance/index.js";
import type { PluginHealth } from "../obsidian/startup.js";

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

export interface DashboardView {
  totalTranscriptCount: number;
  transcripts: TranscriptListItem[];
  recentAnswers: Array<{ id: string; question: string; confidence: TrustState; createdAt: string }>;
  reviewCount: number;
  weakCount: number;
  conflictCount: number;
  brokenCount: number;
  health?: PluginHealth;
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
  ask(question: string, options?: { transcriptIds?: string[] }): Promise<AskAIResponse>;
  askAI(question: string, options?: { transcriptIds?: string[] }): Promise<AskAIResponse>;
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
