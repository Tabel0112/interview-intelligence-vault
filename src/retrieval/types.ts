import type { EmbeddingProvider } from "./embeddingProvider.js";

export type RetrievalTargetType = "transcript_span" | "memory_object" | "evidence_pointer";
export type SearchScope = "transcript_spans" | "memory_objects" | "evidence_pointers" | "all";
export type RetrievalMode = "keyword" | "vector" | "hybrid";
export type SupportRole = "supporting" | "opposing" | "mixed" | "unknown";

export interface RetrievalFilters {
  transcriptIds?: string[]; sourceIds?: string[]; speakerIds?: string[]; speakerNames?: string[];
  topicIds?: string[]; topicNames?: string[]; entityIds?: string[]; memoryTypes?: string[]; memoryStatuses?: string[];
  createdAfter?: string; createdBefore?: string; updatedAfter?: string; updatedBefore?: string;
  minEvidenceScore?: number; includeGenerated?: boolean; includeUnsupportedMemory?: boolean;
}
export interface RetrievalQuery {
  query: string; mode?: RetrievalMode; scope?: SearchScope; filters?: RetrievalFilters; limit?: number;
  vectorLimit?: number; keywordLimit?: number; finalLimit?: number; recencyBoost?: boolean;
  requireEvidencePointers?: boolean; includeOpposition?: boolean; embeddingProvider?: EmbeddingProvider; now?: string;
}
export interface RetrievalCandidate {
  targetType: RetrievalTargetType; targetId: string; transcriptId?: string; sourceId?: string; speakerId?: string;
  speakerName?: string; title?: string; textPreview: string; quote?: string; createdAt?: string; updatedAt?: string;
  keywordScore?: number; vectorScore?: number; metadataScore?: number; recencyScore?: number; evidenceScore?: number;
  finalScore: number; matchReasons: string[]; evidencePointerIds: string[]; sourcePointerIds: string[]; supportRole?: SupportRole;
}
export interface RetrievalIndexOptions {
  embeddingProvider?: EmbeddingProvider; force?: boolean; batchSize?: number; targetTypes?: RetrievalTargetType[];
}
