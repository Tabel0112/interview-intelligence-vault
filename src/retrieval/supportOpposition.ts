import type { SqliteDatabase } from "../db/connection.js";
import { getEvidenceCandidatesForTarget, scoreEvidenceBundle, type EvidenceCandidate, type EvidenceUseType } from "../evidence/index.js";
import type { EvidencePointer, EvidenceTargetType } from "../provenance/types.js";
import { searchRetrieval } from "./hybridSearch.js";
import type { RetrievalCandidate, RetrievalQuery } from "./types.js";

export interface AskAiRetrievalQuery extends RetrievalQuery {
  useType?: EvidenceUseType;
  requiredSpecificityTerms?: string[];
}

function stance(candidate: RetrievalCandidate): EvidenceCandidate["stance"] {
  return candidate.supportRole === "opposing" ? "opposes"
    : candidate.supportRole === "mixed" ? "qualifies"
    : candidate.supportRole === "supporting" ? "supports"
    : "unknown";
}

function mergeRetrievalScores(evidence: EvidenceCandidate, candidate: RetrievalCandidate): EvidenceCandidate {
  return {
    ...evidence,
    retrievalScore: candidate.finalScore,
    vectorScore: candidate.vectorScore,
    keywordScore: candidate.keywordScore,
    stance: evidence.stance === "unknown" ? stance(candidate) : evidence.stance,
  };
}

function toScoringCandidates(db: SqliteDatabase, candidates: RetrievalCandidate[]): EvidenceCandidate[] {
  return candidates.flatMap((candidate): EvidenceCandidate[] => {
    if (candidate.targetType === "transcript_span") {
      return [{
        id: candidate.targetId, transcriptId: candidate.transcriptId, spanIds: [candidate.targetId],
        quote: candidate.quote ?? candidate.textPreview, speaker: candidate.speakerName, sourceKind: "raw_transcript_span",
        createdAt: candidate.createdAt, retrievalScore: candidate.finalScore, vectorScore: candidate.vectorScore,
        keywordScore: candidate.keywordScore, stance: stance(candidate), sourceConfidence: candidate.evidenceScore,
        provenanceValidated: true,
      }];
    }
    if (candidate.targetType === "memory_object") {
      return getEvidenceCandidatesForTarget(db, "memory_object", candidate.targetId).map((evidence) => mergeRetrievalScores(evidence, candidate));
    }
    const pointer = db.prepare("SELECT target_type,target_id FROM evidence_pointers WHERE evidence_pointer_id=?").get(candidate.targetId) as
      Pick<EvidencePointer, "target_type" | "target_id"> | undefined;
    if (!pointer) return [];
    return getEvidenceCandidatesForTarget(db, pointer.target_type as EvidenceTargetType, pointer.target_id)
      .filter((evidence) => evidence.evidencePointerId === candidate.targetId)
      .map((evidence) => mergeRetrievalScores(evidence, candidate));
  });
}

/**
 * Ask AI retrieval boundary. Callers should use `assessment`, not retrieval
 * rank or the legacy grouping fields, to decide whether an answer is allowed.
 */
export async function retrieveForAskAi(db: SqliteDatabase, query: AskAiRetrievalQuery) {
  const candidates = await searchRetrieval(db, { ...query, includeOpposition: true });
  const weak = candidates.filter((item) => (item.evidenceScore ?? 0.5) < 0.45);
  const opposing = candidates.filter((item) => item.supportRole === "opposing" || item.supportRole === "mixed");
  const supporting = candidates.filter((item) => (item.supportRole === "supporting" || item.supportRole === "mixed") && !weak.includes(item));
  const assessment = scoreEvidenceBundle({
    claimText: query.query, useType: query.useType ?? "direct_fact", candidates: toScoringCandidates(db, candidates),
    now: query.now, requiredSpecificityTerms: query.requiredSpecificityTerms,
  });
  return { candidates, supporting, opposing, weak, conflictsDetected: supporting.length > 0 && opposing.length > 0, assessment };
}
