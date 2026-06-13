import type { SqliteDatabase } from "../db/connection.js";
import { ValidationError } from "../db/errors.js";
import { now } from "../db/utils.js";
import { makeEvidencePointerUri, parseEvidencePointerUri } from "./pointerFormat.js";
import { createSourcePointerForSpan, resolveSourcePointer } from "./sourcePointers.js";
import type { AnswerClaim, AnswerClaimSupportStatus, EvidencePointer, EvidencePointerResolution, EvidenceStrength, EvidenceTargetType, ProvenanceEvidenceRole } from "./types.js";
import { requireTarget, rolePrioritySql, stableProvenanceId, validateScore } from "./utils.js";

const targetTypes = new Set<EvidenceTargetType>(["memory_object", "claim", "answer", "answer_claim", "graph_node", "graph_edge", "summary"]);
const roles = new Set<ProvenanceEvidenceRole>(["support", "opposition", "neutral", "conditional", "unclear"]);
const strengths = new Set<EvidenceStrength>(["strong", "mixed", "weak", "conflicting", "unknown"]);

export interface CreateEvidencePointerInput {
  targetType: EvidenceTargetType; targetId: string; transcriptId: string; spanId: string;
  evidenceRole: ProvenanceEvidenceRole; evidenceStrength: EvidenceStrength; confidence: number;
  relevanceScore?: number | null; semanticScore?: number | null; lexicalScore?: number | null;
  recencyScore?: number | null; finalScore?: number | null;
}

function quotePreview(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length <= 240 ? clean : `${clean.slice(0, 237)}...`;
}

function updateAnswerClaimSupportStatus(db: SqliteDatabase, answerClaimId: string): void {
  const rows = db.prepare("SELECT evidence_role,evidence_strength FROM evidence_pointers WHERE target_type='answer_claim' AND target_id=?")
    .all(answerClaimId) as Array<{ evidence_role: ProvenanceEvidenceRole; evidence_strength: EvidenceStrength }>;
  const support = rows.filter((row) => row.evidence_role === "support");
  const opposition = rows.some((row) => row.evidence_role === "opposition");
  let status: AnswerClaimSupportStatus = "unsupported";
  if (support.length && opposition) status = "conflicted";
  else if (support.some((row) => row.evidence_strength === "strong" || row.evidence_strength === "mixed")) status = "supported";
  else if (support.length) status = "weakly_supported";
  else if (rows.length) status = "unclear";
  db.prepare("UPDATE answer_claims SET support_status=? WHERE answer_claim_id=?").run(status, answerClaimId);
}

export function createEvidencePointer(db: SqliteDatabase, input: CreateEvidencePointerInput): EvidencePointer {
  if (!targetTypes.has(input.targetType)) throw new ValidationError(`Invalid evidence target type: ${input.targetType}`);
  if (!roles.has(input.evidenceRole)) throw new ValidationError(`Invalid evidence role: ${input.evidenceRole}`);
  if (!strengths.has(input.evidenceStrength)) throw new ValidationError(`Invalid evidence strength: ${input.evidenceStrength}`);
  for (const [name, value] of Object.entries({
    confidence: input.confidence, relevanceScore: input.relevanceScore, semanticScore: input.semanticScore,
    lexicalScore: input.lexicalScore, recencyScore: input.recencyScore, finalScore: input.finalScore,
  })) validateScore(value, name);
  requireTarget(db, input.targetType, input.targetId);
  const source = createSourcePointerForSpan(db, { transcriptId: input.transcriptId, spanId: input.spanId });
  const resolved = resolveSourcePointer(db, source.pointer_uri);
  if (!resolved.ok) throw new ValidationError(`Source pointer is broken: ${resolved.reason}`);
  const id = stableProvenanceId("evp_", `${input.targetType}:${input.targetId}:${source.pointer_uri}:${input.evidenceRole}`);
  const pointerUri = makeEvidencePointerUri(id);
  db.prepare(`INSERT OR IGNORE INTO evidence_pointers(
    evidence_pointer_id,pointer_uri,source_pointer_uri,target_type,target_id,transcript_id,span_id,evidence_role,evidence_strength,
    confidence,relevance_score,semantic_score,lexical_score,recency_score,final_score,quote_preview,created_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, pointerUri, source.pointer_uri, input.targetType, input.targetId, input.transcriptId, input.spanId,
    input.evidenceRole, input.evidenceStrength, input.confidence, input.relevanceScore ?? null, input.semanticScore ?? null,
    input.lexicalScore ?? null, input.recencyScore ?? null, input.finalScore ?? null, quotePreview(resolved.spanText), now(),
  );
  if (input.targetType === "answer_claim") updateAnswerClaimSupportStatus(db, input.targetId);
  return db.prepare("SELECT * FROM evidence_pointers WHERE evidence_pointer_id=?").get(id) as EvidencePointer;
}

export function getEvidenceForTarget(db: SqliteDatabase, input: { targetType: EvidenceTargetType; targetId: string }): EvidencePointer[] {
  return db.prepare(`SELECT * FROM evidence_pointers WHERE target_type=? AND target_id=?
    ORDER BY ${rolePrioritySql}, final_score DESC, created_at, evidence_pointer_id`).all(input.targetType, input.targetId) as EvidencePointer[];
}

export function resolveEvidencePointer(db: SqliteDatabase, idOrUri: string): EvidencePointerResolution {
  let id = idOrUri;
  if (idOrUri.startsWith("mv://")) {
    try { id = parseEvidencePointerUri(idOrUri).evidencePointerId; } catch { return { ok: false, reason: "not_found" }; }
  }
  const evidence = db.prepare("SELECT * FROM evidence_pointers WHERE evidence_pointer_id=?").get(id) as EvidencePointer | undefined;
  if (!evidence) return { ok: false, reason: "not_found" };
  const source = resolveSourcePointer(db, evidence.source_pointer_uri);
  if (!source.ok) return { ok: false, reason: source.reason };
  return { ok: true, evidence, source: source.pointer, spanText: source.spanText, rawText: source.rawText };
}

export function createAnswerClaim(db: SqliteDatabase, input: { answerId: string; claimText: string; claimOrder: number }): AnswerClaim {
  requireTarget(db, "answer", input.answerId);
  if (input.claimOrder < 0 || !Number.isInteger(input.claimOrder)) throw new ValidationError("claimOrder must be a non-negative integer");
  const id = stableProvenanceId("ac_", `${input.answerId}:${input.claimOrder}:${input.claimText}`);
  db.prepare(`INSERT OR IGNORE INTO answer_claims(answer_claim_id,answer_id,claim_text,claim_order,support_status,created_at)
    VALUES (?,?,?,?, 'unsupported', ?)`).run(id, input.answerId, input.claimText, input.claimOrder, now());
  return db.prepare("SELECT * FROM answer_claims WHERE answer_claim_id=?").get(id) as AnswerClaim;
}

export function linkAnswerClaimToEvidence(db: SqliteDatabase, input: {
  answerClaimId: string; transcriptId: string; spanId: string; evidenceRole: ProvenanceEvidenceRole;
  evidenceStrength: EvidenceStrength; confidence: number; scores?: Omit<CreateEvidencePointerInput, "targetType" | "targetId" | "transcriptId" | "spanId" | "evidenceRole" | "evidenceStrength" | "confidence">;
}): EvidencePointer {
  return createEvidencePointer(db, { targetType: "answer_claim", targetId: input.answerClaimId, transcriptId: input.transcriptId, spanId: input.spanId, evidenceRole: input.evidenceRole, evidenceStrength: input.evidenceStrength, confidence: input.confidence, ...input.scores });
}

export function linkMemoryObjectToSpan(db: SqliteDatabase, input: { memoryObjectId: string; transcriptId: string; spanId: string; evidenceRole?: ProvenanceEvidenceRole; evidenceStrength?: EvidenceStrength; confidence?: number }): EvidencePointer {
  return createEvidencePointer(db, { targetType: "memory_object", targetId: input.memoryObjectId, transcriptId: input.transcriptId, spanId: input.spanId, evidenceRole: input.evidenceRole ?? "support", evidenceStrength: input.evidenceStrength ?? "unknown", confidence: input.confidence ?? 0.5 });
}

export function linkGraphNodeToSpan(db: SqliteDatabase, input: { graphNodeId: string; transcriptId: string; spanId: string; evidenceRole?: ProvenanceEvidenceRole; evidenceStrength?: EvidenceStrength; confidence?: number }): EvidencePointer {
  return createEvidencePointer(db, { targetType: "graph_node", targetId: input.graphNodeId, transcriptId: input.transcriptId, spanId: input.spanId, evidenceRole: input.evidenceRole ?? "support", evidenceStrength: input.evidenceStrength ?? "unknown", confidence: input.confidence ?? 0.5 });
}

export function linkGraphEdgeToSpan(db: SqliteDatabase, input: { graphEdgeId: string; transcriptId: string; spanId: string; evidenceRole: ProvenanceEvidenceRole; evidenceStrength: EvidenceStrength; confidence: number }): EvidencePointer {
  return createEvidencePointer(db, { targetType: "graph_edge", targetId: input.graphEdgeId, transcriptId: input.transcriptId, spanId: input.spanId, evidenceRole: input.evidenceRole, evidenceStrength: input.evidenceStrength, confidence: input.confidence });
}
