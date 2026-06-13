import type { SqliteDatabase } from "../db/connection.js";
import { NotFoundError, ValidationError } from "../db/errors.js";
import { createId } from "../db/ids.js";
import { createMemoryObjectsRepo } from "../db/repositories/memoryObjectsRepo.js";
import { resolveEvidencePointer } from "../provenance/index.js";
import { stableProvenanceId } from "../provenance/utils.js";
import { isUsableAsEvidence } from "../memory/canonical.js";
import { classifyConflictCandidate } from "./rules.js";
import type {
  ApplyConflictCorrectionInput, ConflictAssessment, ConflictCandidate, ConflictClassification,
  ConflictEvidenceLink, ConflictEvidenceSide, ConflictStatus, CreateConflictAssessmentInput,
} from "./types.js";

type Row = Record<string, unknown>;

const leftKey = (candidate: ConflictCandidate) => `${candidate.leftTargetType}:${candidate.leftTargetId}`;
const rightKey = (candidate: ConflictCandidate) => `${candidate.rightTargetType}:${candidate.rightTargetId}`;
export const conflictPairKey = (candidate: ConflictCandidate): string => [leftKey(candidate), rightKey(candidate)].sort().join("|");

function normalizeCandidate(candidate: ConflictCandidate): ConflictCandidate {
  return leftKey(candidate) <= rightKey(candidate) ? candidate : {
    ...candidate,
    leftTargetId: candidate.rightTargetId, leftTargetType: candidate.rightTargetType, leftText: candidate.rightText,
    leftEvidenceIds: candidate.rightEvidenceIds, leftTimestamp: candidate.rightTimestamp,
    rightTargetId: candidate.leftTargetId, rightTargetType: candidate.leftTargetType, rightText: candidate.leftText,
    rightEvidenceIds: candidate.leftEvidenceIds, rightTimestamp: candidate.leftTimestamp,
  };
}

function parseLink(row: Row): ConflictEvidenceLink {
  return {
    id: String(row.id), conflictAssessmentId: String(row.conflict_assessment_id), evidencePointerId: String(row.evidence_pointer_id),
    side: row.side as ConflictEvidenceSide, role: row.role as ConflictEvidenceLink["role"], provenanceValidated: Boolean(row.provenance_validated),
    transcriptId: row.transcript_id == null ? undefined : String(row.transcript_id),
    spanId: row.span_id == null ? undefined : String(row.span_id),
    sourcePointerId: row.source_pointer_uri == null ? undefined : String(row.source_pointer_uri),
    quotePreview: row.quote_preview == null ? undefined : String(row.quote_preview),
    evidenceStrength: row.evidence_strength == null ? undefined : String(row.evidence_strength),
    confidence: row.confidence == null ? undefined : Number(row.confidence), createdAt: String(row.created_at),
  };
}

function parseAssessment(db: SqliteDatabase, row: Row): ConflictAssessment {
  const links = db.prepare(`SELECT l.*,p.transcript_id,p.span_id,p.source_pointer_uri,p.quote_preview,p.evidence_strength,p.confidence FROM conflict_evidence_links l
    JOIN evidence_pointers p ON p.evidence_pointer_id=l.evidence_pointer_id
    WHERE l.conflict_assessment_id=? ORDER BY l.side,l.created_at,l.id`).all(row.id) as Row[];
  return {
    id: String(row.id), kind: row.kind as ConflictAssessment["kind"], confidence: Number(row.confidence),
    status: row.status as ConflictStatus, leftTargetType: row.left_target_type as ConflictAssessment["leftTargetType"],
    leftTargetId: String(row.left_target_id), rightTargetType: row.right_target_type as ConflictAssessment["rightTargetType"],
    rightTargetId: String(row.right_target_id), pairKey: String(row.pair_key), summary: String(row.summary),
    explanation: String(row.explanation), componentScores: JSON.parse(String(row.component_scores_json)),
    newerTargetId: row.newer_target_id == null ? null : String(row.newer_target_id),
    olderTargetId: row.older_target_id == null ? null : String(row.older_target_id),
    winningTargetId: row.winning_target_id == null ? null : String(row.winning_target_id),
    resolutionNote: row.resolution_note == null ? null : String(row.resolution_note),
    evidence: links.map(parseLink), evidenceLinks: links.map(parseLink), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function validatedPointers(db: SqliteDatabase, candidate: ConflictCandidate, side: ConflictEvidenceSide) {
  const targetType = side === "left" ? candidate.leftTargetType : candidate.rightTargetType;
  const targetId = side === "left" ? candidate.leftTargetId : candidate.rightTargetId;
  const ids = side === "left" ? candidate.leftEvidenceIds : candidate.rightEvidenceIds;
  return ids.map((id) => {
    const resolution = resolveEvidencePointer(db, id);
    if (!resolution.ok) throw new ValidationError(`Conflict evidence pointer is broken: ${id}`);
    if (targetType !== "evidence_pointer" && (resolution.evidence.target_type !== targetType || resolution.evidence.target_id !== targetId)) {
      throw new ValidationError(`Conflict evidence pointer does not belong to ${targetType}:${targetId}: ${id}`);
    }
    if (targetType === "evidence_pointer" && id !== targetId) {
      throw new ValidationError(`Conflict evidence pointer target does not match itself: ${id}`);
    }
    return resolution.evidence;
  });
}

export function createConflictRepository(db: SqliteDatabase, options: { now?: () => Date } = {}) {
  const timestamp = () => (options.now?.() ?? new Date()).toISOString();
  const get = (id: string): ConflictAssessment | null => {
    const row = db.prepare("SELECT * FROM conflict_assessments WHERE id=?").get(id) as Row | undefined;
    return row ? parseAssessment(db, row) : null;
  };
  const list = (where = "", values: unknown[] = []): ConflictAssessment[] =>
    (db.prepare(`SELECT * FROM conflict_assessments ${where} ORDER BY created_at,id`).all(...values) as Row[]).map((row) => parseAssessment(db, row));
  const revalidate = (id: string): ConflictAssessment => db.transaction(() => {
    const conflict = get(id);
    if (!conflict) throw new NotFoundError(`Conflict assessment not found: ${id}`);
    for (const link of conflict.evidenceLinks) {
      const valid = resolveEvidencePointer(db, link.evidencePointerId).ok;
      if (valid !== link.provenanceValidated) {
        db.prepare("UPDATE conflict_evidence_links SET provenance_validated=? WHERE id=?").run(valid ? 1 : 0, link.id);
      }
    }
    const coverage = db.prepare(`SELECT
      EXISTS(SELECT 1 FROM conflict_evidence_links WHERE conflict_assessment_id=? AND side='left' AND provenance_validated=1) left_valid,
      EXISTS(SELECT 1 FROM conflict_evidence_links WHERE conflict_assessment_id=? AND side='right' AND provenance_validated=1) right_valid`)
      .get(id, id) as { left_valid: number; right_valid: number };
    if (conflict.status === "active" && (!coverage.left_valid || !coverage.right_valid)) {
      db.prepare("UPDATE conflict_assessments SET status='needs_review',updated_at=? WHERE id=?").run(timestamp(), id);
    }
    return get(id)!;
  })();
  const pointerScore = (pointer: ReturnType<typeof validatedPointers>[number]) => {
    const raw = pointer.final_score ?? pointer.confidence;
    return pointer.evidence_strength === "strong" ? raw
      : pointer.evidence_strength === "mixed" ? Math.min(raw, 0.7)
        : pointer.evidence_strength === "weak" ? Math.min(raw, 0.4) : Math.min(raw, 0.5);
  };
  const targetIsTrusted = (type: ConflictAssessment["leftTargetType"], id: string) => {
    if (type !== "memory_object" && type !== "claim" && type !== "summary") return true;
    const memory = createMemoryObjectsRepo(db).getCanonicalMemoryObject(id);
    return memory != null && isUsableAsEvidence(memory);
  };

  return {
    create(input: CreateConflictAssessmentInput): ConflictAssessment {
      return db.transaction(() => {
        const candidate = normalizeCandidate(input.candidate);
        const pairKey = conflictPairKey(candidate);
        const existing = db.prepare("SELECT * FROM conflict_assessments WHERE pair_key=? ORDER BY created_at LIMIT 1").get(pairKey) as Row | undefined;
        if (existing) return parseAssessment(db, existing);
        const left = validatedPointers(db, candidate, "left"), right = validatedPointers(db, candidate, "right");
        const allPointers = [...left, ...right];
        const userCorrected = [candidate.leftTargetId, candidate.rightTargetId].filter((targetId) =>
          Boolean(db.prepare("SELECT 1 FROM memory_objects WHERE id=? AND user_corrected=1").get(targetId)));
        const evidenceOptions = {
          validatedEvidenceIds: allPointers.map((pointer) => pointer.evidence_pointer_id),
          evidenceScores: Object.fromEntries(allPointers.map((pointer) => [pointer.evidence_pointer_id, pointerScore(pointer)])),
          userCorrectionTargetIds: userCorrected,
        };
        const computed = classifyConflictCandidate(candidate, evidenceOptions);
        const classification: ConflictClassification = input.classification
          ? { ...input.classification, confidence: Math.min(input.classification.confidence, computed.confidence) }
          : computed;
        if (!targetIsTrusted(candidate.leftTargetType, candidate.leftTargetId) || !targetIsTrusted(candidate.rightTargetType, candidate.rightTargetId)) {
          classification.confidence = Math.min(classification.confidence, 0.59);
        }
        const createdAt = timestamp();
        const id = stableProvenanceId("conf_", pairKey);
        db.prepare(`INSERT INTO conflict_assessments(
          id,kind,confidence,status,left_target_type,left_target_id,right_target_type,right_target_id,pair_key,summary,explanation,
          component_scores_json,newer_target_id,older_target_id,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id, classification.kind, classification.confidence, "needs_review", candidate.leftTargetType, candidate.leftTargetId,
          candidate.rightTargetType, candidate.rightTargetId, pairKey, classification.summary, classification.explanation,
          JSON.stringify(classification.componentScores), classification.newerTargetId, classification.olderTargetId, createdAt, createdAt,
        );
        for (const [side, pointers] of [["left", left], ["right", right]] as const) {
          for (const pointer of pointers) {
            db.prepare(`INSERT OR IGNORE INTO conflict_evidence_links(
              id,conflict_assessment_id,evidence_pointer_id,side,role,provenance_validated,created_at
            ) VALUES (?,?,?,?,?,?,?)`).run(
              stableProvenanceId("cel_", `${id}:${side}:${pointer.evidence_pointer_id}`), id, pointer.evidence_pointer_id,
              side, side === "left" ? "supports_left" : "supports_right", 1, createdAt,
            );
          }
        }
        if (classification.kind !== "weak_or_ambiguous" && classification.confidence >= 0.6 && left.length && right.length) {
          db.prepare("UPDATE conflict_assessments SET status='active',updated_at=? WHERE id=?").run(createdAt, id);
        }
        return get(id)!;
      })();
    },
    createConflictAssessment(input: CreateConflictAssessmentInput): ConflictAssessment { return this.create(input); },
    get,
    getConflictAssessment(id: string): ConflictAssessment | null { return get(id); },
    listForTarget(targetType: ConflictAssessment["leftTargetType"], targetId: string, options: { activeOnly?: boolean } = {}): ConflictAssessment[] {
      return list(`WHERE ((left_target_type=? AND left_target_id=?) OR (right_target_type=? AND right_target_id=?))${options.activeOnly ? " AND status='active'" : ""}`,
        [targetType, targetId, targetType, targetId]);
    },
    listConflictsForTarget(targetType: ConflictAssessment["leftTargetType"], targetId: string, options: { activeOnly?: boolean } = {}): ConflictAssessment[] {
      return list(`WHERE ((left_target_type=? AND left_target_id=?) OR (right_target_type=? AND right_target_id=?))${options.activeOnly ? " AND status='active'" : ""}`,
        [targetType, targetId, targetType, targetId]);
    },
    listActiveForEvidencePointers(pointerIds: string[]): ConflictAssessment[] {
      if (!pointerIds.length) return [];
      const placeholders = pointerIds.map(() => "?").join(",");
      return list(`WHERE status='active' AND id IN (
        SELECT conflict_assessment_id FROM conflict_evidence_links WHERE evidence_pointer_id IN (${placeholders})
      )`, pointerIds).map((conflict) => revalidate(conflict.id)).filter((conflict) => conflict.status === "active");
    },
    listActiveConflicts(): ConflictAssessment[] {
      return list("WHERE status='active'").map((conflict) => revalidate(conflict.id)).filter((conflict) => conflict.status === "active");
    },
    listConflictsForEvidence(evidencePointerId: string): ConflictAssessment[] {
      return list("WHERE id IN (SELECT conflict_assessment_id FROM conflict_evidence_links WHERE evidence_pointer_id=?)", [evidencePointerId]);
    },
    revalidateConflictEvidence(id: string): ConflictAssessment { return revalidate(id); },
    addEvidenceLink(id: string, evidencePointerId: string, role: ConflictEvidenceLink["role"]): ConflictAssessment {
      const conflict = get(id);
      if (!conflict) throw new NotFoundError(`Conflict assessment not found: ${id}`);
      const resolution = resolveEvidencePointer(db, evidencePointerId);
      if (!resolution.ok) throw new ValidationError(`Conflict evidence pointer is broken: ${evidencePointerId}`);
      const side: ConflictEvidenceSide = role === "supports_left" || role === "opposes_right" ? "left"
        : role === "supports_right" || role === "opposes_left" ? "right"
          : resolution.evidence.target_id === conflict.leftTargetId ? "left" : "right";
      db.prepare(`INSERT OR IGNORE INTO conflict_evidence_links(
        id,conflict_assessment_id,evidence_pointer_id,side,role,provenance_validated,created_at
      ) VALUES (?,?,?,?,?,1,?)`).run(stableProvenanceId("cel_", `${id}:${role}:${evidencePointerId}`), id, evidencePointerId, side, role, timestamp());
      return get(id)!;
    },
    updateConflictStatus(id: string, status: ConflictStatus): ConflictAssessment {
      const current = get(id);
      if (!current) throw new NotFoundError(`Conflict assessment not found: ${id}`);
      if (status === "active" && current.kind === "weak_or_ambiguous") throw new ValidationError("Weak or ambiguous conflicts cannot be promoted to active");
      const result = db.prepare("UPDATE conflict_assessments SET status=?,updated_at=? WHERE id=?").run(status, timestamp(), id);
      if (!result.changes) throw new NotFoundError(`Conflict assessment not found: ${id}`);
      return get(id)!;
    },
    deleteOrDowngradeConflictsForMissingEvidence(evidencePointerId: string): ConflictAssessment[] {
      const ids = db.prepare("SELECT DISTINCT conflict_assessment_id id FROM conflict_evidence_links WHERE evidence_pointer_id=?")
        .all(evidencePointerId) as Array<{ id: string }>;
      db.prepare("DELETE FROM conflict_evidence_links WHERE evidence_pointer_id=?").run(evidencePointerId);
      if (!ids.length) return [];
      return list(`WHERE id IN (${ids.map(() => "?").join(",")})`, ids.map((row) => row.id));
    },
    applyCorrection(id: string, input: ApplyConflictCorrectionInput): ConflictAssessment {
      return db.transaction(() => {
        const conflict = get(id);
        if (!conflict) throw new NotFoundError(`Conflict assessment not found: ${id}`);
        const winner = input.action === "mark_left_correct" ? conflict.leftTargetId
          : input.action === "mark_right_correct" ? conflict.rightTargetId
            : input.action === "mark_newer_supersedes_older" ? conflict.newerTargetId : null;
        if (input.action === "mark_newer_supersedes_older" && (!conflict.newerTargetId || !conflict.olderTargetId)) {
          throw new ValidationError("Conflict has no deterministic newer/older targets");
        }
        const correctedAt = timestamp();
        db.prepare(`INSERT INTO conflict_corrections(id,conflict_assessment_id,action,winning_target_id,note,created_by,created_at)
          VALUES (?,?,?,?,?,?,?)`).run(createId("cc_"), id, input.action, winner, input.note ?? null, input.createdBy ?? "user", correctedAt);
        const status: ConflictStatus = input.action === "dismiss_not_conflict" ? "dismissed"
          : input.action === "mark_both_contextual" || input.action === "keep_both_as_tension" ? "active" : "resolved";
        const kind = input.action === "mark_both_contextual" ? "conditional_difference"
          : input.action === "keep_both_as_tension" ? "tension" : conflict.kind;
        db.prepare(`UPDATE conflict_assessments SET status=?,kind=?,winning_target_id=?,resolution_note=?,updated_at=? WHERE id=?`)
          .run(status, kind, winner, input.note ?? null, correctedAt, id);
        if (input.action === "mark_newer_supersedes_older" && conflict.olderTargetId) {
          const oldType = conflict.leftTargetId === conflict.olderTargetId ? conflict.leftTargetType : conflict.rightTargetType;
          if (oldType === "memory_object" || oldType === "claim" || oldType === "summary") {
            db.prepare(`UPDATE memory_objects SET status='superseded',
              extraction_status=CASE WHEN extraction_status IS NULL THEN NULL ELSE 'superseded' END,updated_at=? WHERE id=?`)
              .run(correctedAt, conflict.olderTargetId);
          }
        }
        return get(id)!;
      })();
    },
    dismissConflict(id: string, note?: string): ConflictAssessment {
      return this.applyCorrection(id, { action: "dismiss_not_conflict", note });
    },
    resolveConflict(id: string, winningTargetId?: string, note?: string): ConflictAssessment {
      const conflict = get(id);
      if (!conflict) throw new NotFoundError(`Conflict assessment not found: ${id}`);
      const action = winningTargetId === conflict.rightTargetId ? "mark_right_correct" : "mark_left_correct";
      return this.applyCorrection(id, { action, note });
    },
  };
}
