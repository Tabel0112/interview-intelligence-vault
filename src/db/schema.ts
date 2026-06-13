export type JsonObject = Record<string, unknown>;
export type TranscriptSourceType = "imported_file" | "pasted_text" | "external_reference";
export type TranscriptStatus = "imported" | "chunked" | "processed" | "failed";
export type ProcessingRunType = "ingestion" | "chunking" | "extraction" | "embedding" | "retrieval" | "answering" | "graph_building" | "correction" | "reprocessing";
export type ProcessingRunStatus = "running" | "completed" | "failed";
export type MemoryObjectType = "claim" | "topic" | "person" | "question" | "decision" | "task" | "preference" | "event" | "concept" | "quote" | "summary";
export type MemoryObjectStatus = "active" | "needs_review" | "rejected" | "superseded";
export type EvidenceRole = "supports" | "contradicts" | "qualifies" | "source" | "context";
export type EvidenceBundlePurpose = "ask_ai" | "memory_extraction" | "graph_edge" | "correction_review" | "reprocessing";
export type EvidenceBundleStatus = "strong" | "mixed" | "weak" | "conflicting" | "needs_review";
export type EvidenceItemStance = "supports" | "contradicts" | "qualifies" | "background" | "unknown";
export type AnswerConfidence = "high" | "medium" | "low";
export type AnswerStatus = "answered" | "weak_evidence" | "conflicting_evidence" | "refused_no_evidence";
export type GraphNodeType = "memory_object" | "entity" | "topic" | "transcript" | "span";
export type GraphEdgeType = "related_to" | "supports" | "contradicts" | "qualifies" | "updates" | "mentions" | "derived_from" | "same_as";
export type GraphEdgeSourceType = "source_backed" | "inferred" | "user_confirmed";
export type GraphEdgeStatus = "active" | "needs_review" | "rejected";
export type CorrectionTargetType = "memory_object" | "graph_edge" | "speaker" | "answer" | "span" | "transcript";
export type CorrectionType = "edit" | "reject" | "confirm" | "merge" | "unmerge" | "mark_conflict" | "resolve_conflict" | "rename";
export type SearchDocumentType = "span" | "memory_object" | "answer" | "graph_node";

export interface TranscriptSource { id: string; source_type: TranscriptSourceType; original_filename: string | null; raw_storage_uri: string; content_hash: string; byte_length: number; created_at: string; metadata: JsonObject; }
export interface Transcript { id: string; source_id: string; title: string; language: string | null; status: TranscriptStatus; content_hash: string; imported_at: string; updated_at: string; metadata: JsonObject; }
export interface TranscriptSpeaker { id: string; transcript_id: string; speaker_label: string; display_name: string | null; canonical_entity_id: string | null; confidence: number | null; metadata: JsonObject; }
export interface TranscriptSpan { id: string; transcript_id: string; source_id: string; speaker_id: string | null; ordinal: number; start_char: number; end_char: number; start_time_ms: number | null; end_time_ms: number | null; text_preview: string; text_hash: string; topic_hint: string | null; created_at: string; metadata: JsonObject; }
export interface ProcessingRun { id: string; run_type: ProcessingRunType; status: ProcessingRunStatus; started_at: string; completed_at: string | null; model_name: string | null; agent_name: string | null; input: JsonObject; output: JsonObject; error: JsonObject | null; metadata: JsonObject; }
/** Raw legacy-compatible DB row. Downstream trust decisions must use CanonicalMemoryObject. */
export interface MemoryObject { id: string; type: MemoryObjectType; title: string | null; generated_text: string; normalized_text: string | null; status: MemoryObjectStatus; confidence: number; created_by: "agent" | "user" | "system"; created_run_id: string | null; supersedes_memory_id: string | null; created_at: string; updated_at: string; metadata: JsonObject; }
export interface MemoryObjectEvidence { id: string; memory_id: string; span_id: string; role: EvidenceRole; evidence_score: number; explanation: string | null; created_at: string; metadata: JsonObject; }
export interface MemoryObjectWithEvidence extends MemoryObject { evidence: MemoryObjectEvidence[]; }
export interface EvidenceBundle { id: string; purpose: EvidenceBundlePurpose; query_text: string | null; query_embedding_model: string | null; created_run_id: string | null; overall_score: number | null; status: EvidenceBundleStatus; created_at: string; metadata: JsonObject; }
export interface EvidenceItem { id: string; bundle_id: string; span_id: string; memory_id: string | null; retrieval_rank: number | null; vector_score: number | null; keyword_score: number | null; recency_score: number | null; speaker_score: number | null; rerank_score: number | null; final_score: number; stance: EvidenceItemStance; reason: string | null; created_at: string; metadata: JsonObject; }
export interface EvidenceBundleWithItems extends EvidenceBundle { items: EvidenceItem[]; }
export interface AiAnswer { id: string; question_text: string; answer_text: string; evidence_bundle_id: string; confidence: AnswerConfidence; answer_status: AnswerStatus; model_name: string | null; created_run_id: string | null; created_at: string; metadata: JsonObject; }
export interface AiAnswerCitation { id: string; answer_id: string; evidence_item_id: string; citation_order: number; quoted_text: string | null; created_at: string; }
export interface AiAnswerWithCitations extends AiAnswer { citations: AiAnswerCitation[]; }
export interface GraphNode { id: string; node_type: GraphNodeType; ref_id: string; label: string; created_at: string; updated_at: string; metadata: JsonObject; }
export interface GraphEdge { id: string; from_node_id: string; to_node_id: string; edge_type: GraphEdgeType; source_type: GraphEdgeSourceType; confidence: number; evidence_bundle_id: string | null; created_run_id: string | null; status: GraphEdgeStatus; created_at: string; updated_at: string; metadata: JsonObject; }
export interface UserCorrection { id: string; target_type: CorrectionTargetType; target_id: string; correction_type: CorrectionType; old_value: JsonObject | null; new_value: JsonObject; reason: string | null; created_at: string; created_by: string; metadata: JsonObject; }
export interface SearchDocument { id: string; doc_type: SearchDocumentType; ref_id: string; search_text: string; language: string | null; created_at: string; updated_at: string; metadata: JsonObject; }
export interface EmbeddingRecord { id: string; doc_type: SearchDocumentType; ref_id: string; embedding_model: string; embedding_dim: number; embedding_storage_uri: string | null; embedding: number[] | null; content_hash: string; created_run_id: string | null; created_at: string; metadata: JsonObject; }
