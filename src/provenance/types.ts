export type EvidenceTargetType = "memory_object" | "claim" | "answer" | "answer_claim" | "graph_node" | "graph_edge" | "summary";
export type ProvenanceEvidenceRole = "support" | "opposition" | "neutral" | "conditional" | "unclear";
export type EvidenceStrength = "strong" | "mixed" | "weak" | "conflicting" | "unknown";
export type AnswerClaimSupportStatus = "supported" | "weakly_supported" | "conflicted" | "unsupported" | "unclear";

export interface SourcePointer {
  pointer_uri: string;
  transcript_id: string;
  span_id: string;
  turn_id: string | null;
  raw_start_offset: number;
  raw_end_offset: number;
  raw_text_sha256: string;
  span_text_sha256: string;
  speaker_id: string | null;
  start_ms: number | null;
  end_ms: number | null;
  created_at: string;
}

export interface EvidencePointer {
  evidence_pointer_id: string;
  pointer_uri: string;
  source_pointer_uri: string;
  target_type: EvidenceTargetType;
  target_id: string;
  transcript_id: string;
  span_id: string;
  evidence_role: ProvenanceEvidenceRole;
  evidence_strength: EvidenceStrength;
  confidence: number;
  relevance_score: number | null;
  semantic_score: number | null;
  lexical_score: number | null;
  recency_score: number | null;
  final_score: number | null;
  quote_preview: string;
  created_at: string;
}

export interface AnswerClaim {
  answer_claim_id: string;
  answer_id: string;
  claim_text: string;
  claim_order: number;
  support_status: AnswerClaimSupportStatus;
  created_at: string;
}

export interface CitationLink {
  citation_link_id: string;
  answer_id: string | null;
  answer_claim_id: string | null;
  evidence_pointer_id: string;
  citation_label: string;
  citation_order: number;
  created_at: string;
}

export type SourcePointerResolution =
  | { ok: true; pointer: SourcePointer; rawText: string; spanText: string; transcriptTitle: string | null }
  | { ok: false; reason: "not_found" | "hash_mismatch" | "invalid_offsets" | "raw_transcript_missing"; pointerUri: string };

export type EvidencePointerResolution =
  | { ok: true; evidence: EvidencePointer; source: SourcePointer; spanText: string; rawText: string }
  | { ok: false; reason: string };
