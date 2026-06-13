import type { SqliteDatabase } from "../db/connection.js";
import { createId } from "../db/ids.js";
import type { EvidenceRole } from "../db/schema.js";
import { getCanonicalMemoryObject, isUsableAsEvidence, type RawMemoryObjectForCanonical } from "../memory/canonical.js";
import type { EvidencePointer, EvidenceTargetType } from "../provenance/types.js";
import { resolveEvidencePointer } from "../provenance/evidencePointers.js";
import type { EvidenceBundleAssessment, EvidenceCandidate, EvidenceSourceKind, EvidenceStance } from "./types.js";

export interface SaveEvidenceScoreRunOptions { id?: string; targetType: string; targetId?: string | null }

const pointerStance = (role: EvidencePointer["evidence_role"]): EvidenceStance =>
  role === "support" ? "supports" : role === "opposition" ? "opposes" : role === "conditional" ? "qualifies" : role === "neutral" ? "neutral" : "unknown";
const memoryEvidenceStance = (role: EvidenceRole): EvidenceStance =>
  role === "supports" || role === "source" ? "supports" : role === "contradicts" ? "opposes" : role === "qualifies" ? "qualifies" : "neutral";

const sourceKindForTarget = (targetType: EvidenceTargetType): EvidenceSourceKind => {
  if (targetType === "memory_object" || targetType === "claim") return "memory_object_with_pointers";
  if (targetType === "summary") return "generated_summary_with_pointers";
  if (targetType === "graph_edge") return "graph_edge_with_pointers";
  if (targetType === "graph_node") return "graph_edge_with_pointers";
  if (targetType === "answer_claim" || targetType === "answer") return "answer_claim_with_pointers";
  return "raw_transcript_span";
};

export function getEvidenceCandidatesForTarget(db: SqliteDatabase, targetType: EvidenceTargetType, targetId: string): EvidenceCandidate[] {
  const pointers = db.prepare("SELECT * FROM evidence_pointers WHERE target_type=? AND target_id=? ORDER BY created_at,evidence_pointer_id")
    .all(targetType, targetId) as EvidencePointer[];
  const memoryRow = targetType === "memory_object" || targetType === "claim" || targetType === "summary"
    ? db.prepare("SELECT * FROM memory_objects WHERE id=?").get(targetId) as RawMemoryObjectForCanonical | undefined
    : undefined;
  const memorySpanIds = memoryRow
    ? db.prepare(`SELECT span_id FROM memory_object_evidence WHERE memory_id=?
      UNION SELECT span_id FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id=?`).all(targetId, targetId) as Array<{ span_id: string }>
    : [];
  const memory = memoryRow ? getCanonicalMemoryObject(memoryRow, memorySpanIds.map((row) => row.span_id)) : undefined;
  const memoryMetadata = memory ? { canonicalMemoryStatus: memory.status, duplicateOfId: memory.duplicateOfId, memoryUsableAsEvidence: isUsableAsEvidence(memory) } : {};
  const pointerCandidates = pointers.flatMap((pointer) => {
    const resolved = resolveEvidencePointer(db, pointer.evidence_pointer_id);
    if (!resolved.ok) return [];
    return [{
      id: pointer.evidence_pointer_id, evidencePointerId: pointer.evidence_pointer_id, transcriptId: pointer.transcript_id,
      spanIds: [pointer.span_id], quote: resolved.spanText, sourceKind: sourceKindForTarget(targetType), createdAt: pointer.created_at,
      turnTimestampStartMs: resolved.source.start_ms, turnTimestampEndMs: resolved.source.end_ms, retrievalScore: pointer.relevance_score ?? pointer.final_score ?? undefined,
      vectorScore: pointer.semantic_score ?? undefined, keywordScore: pointer.lexical_score ?? undefined, stance: pointerStance(pointer.evidence_role),
      sourceConfidence: pointer.confidence, provenanceValidated: true, metadata: { ...memoryMetadata, sourcePointerId: pointer.source_pointer_uri },
    }];
  });
  if (!memory) return pointerCandidates;
  const pointerSpanIds = new Set(pointerCandidates.flatMap((candidate) => candidate.spanIds));
  const legacyRows = db.prepare(`SELECT e.id,e.span_id,e.role,e.evidence_score,e.created_at,s.transcript_id,s.text,s.start_time_ms,s.end_time_ms
    FROM memory_object_evidence e JOIN transcript_spans s ON s.id=e.span_id WHERE e.memory_id=? ORDER BY e.created_at,e.id`).all(targetId) as Array<{
      id: string; span_id: string; role: EvidenceRole; evidence_score: number; created_at: string; transcript_id: string;
      text: string; start_time_ms: number | null; end_time_ms: number | null;
    }>;
  const legacyCandidates: EvidenceCandidate[] = legacyRows.filter((row) => !pointerSpanIds.has(row.span_id)).map((row) => ({
    id: row.id, transcriptId: row.transcript_id, spanIds: [row.span_id], quote: row.text, sourceKind: "memory_object_with_pointers",
    createdAt: row.created_at, turnTimestampStartMs: row.start_time_ms, turnTimestampEndMs: row.end_time_ms,
    retrievalScore: row.evidence_score, stance: memoryEvidenceStance(row.role), sourceConfidence: row.evidence_score,
    provenanceValidated: true, metadata: memoryMetadata,
  }));
  return [...pointerCandidates, ...legacyCandidates];
}

export function saveEvidenceScoreRun(db: SqliteDatabase, assessment: EvidenceBundleAssessment, options: SaveEvidenceScoreRunOptions): string {
  const id = options.id ?? createId("esr_");
  db.transaction(() => {
    db.prepare(`INSERT INTO evidence_score_runs(
      id,target_type,target_id,claim_text,use_type,strength,support_score,opposition_score,qualification_score,has_conflict,scorer_version,reasons_json,assessment_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, options.targetType, options.targetId ?? null, assessment.claimText, assessment.useType, assessment.strength,
      assessment.supportScore, assessment.oppositionScore, assessment.qualificationScore, assessment.hasConflict ? 1 : 0,
      assessment.scorerVersion, JSON.stringify(assessment.reasons), JSON.stringify(assessment),
    );
    assessment.scoredEvidence.forEach((item) => {
      const pointerId = item.candidate.evidencePointerId
        && db.prepare("SELECT 1 FROM evidence_pointers WHERE evidence_pointer_id=?").get(item.candidate.evidencePointerId)
        ? item.candidate.evidencePointerId : null;
      db.prepare(`INSERT INTO evidence_score_items(
      id,run_id,evidence_pointer_id,candidate_id,stance,final_score,strength,relevance,directness,specificity,source_strength,repetition,
      recency,correction_weight,confidence,opposition_penalty,caps_json,reasons_json,candidate_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      createId("esi_"), id, pointerId, item.candidate.id, item.stance, item.finalScore, item.strength,
      item.components.relevance, item.components.directness, item.components.specificity, item.components.sourceStrength,
      item.components.repetition, item.components.recency, item.components.correctionWeight, item.components.confidence,
      item.components.oppositionPenalty, JSON.stringify(item.caps), JSON.stringify(item.reasons), JSON.stringify(item.candidate),
      );
    });
  })();
  return id;
}

export function getEvidenceScoreRun(db: SqliteDatabase, runId: string): EvidenceBundleAssessment | null {
  const row = db.prepare("SELECT assessment_json FROM evidence_score_runs WHERE id=?").get(runId) as { assessment_json: string } | undefined;
  return row ? JSON.parse(row.assessment_json) as EvidenceBundleAssessment : null;
}
