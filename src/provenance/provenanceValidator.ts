import type { SqliteDatabase } from "../db/connection.js";
import { getEvidenceForTarget, resolveEvidencePointer } from "./evidencePointers.js";
import type { EvidenceStrength, EvidenceTargetType } from "./types.js";

const strengthRank: Record<EvidenceStrength, number> = { strong: 5, mixed: 4, conflicting: 3, weak: 2, unknown: 1 };

export function validateTargetHasEvidence(db: SqliteDatabase, input: { targetType: EvidenceTargetType; targetId: string }) {
  const evidence = getEvidenceForTarget(db, input);
  const problems: string[] = [];
  const broken = evidence.filter((item) => !resolveEvidencePointer(db, item.evidence_pointer_id).ok);
  if (!evidence.length) problems.push("Target has no evidence pointers.");
  if (broken.length) problems.push(`Target has ${broken.length} broken evidence pointer(s).`);
  const strongest = evidence.reduce<EvidenceStrength | null>((best, item) => !best || strengthRank[item.evidence_strength] > strengthRank[best] ? item.evidence_strength : best, null);
  return {
    ok: evidence.length > 0 && broken.length === 0,
    evidenceCount: evidence.length,
    supportCount: evidence.filter((item) => item.evidence_role === "support").length,
    oppositionCount: evidence.filter((item) => item.evidence_role === "opposition").length,
    unclearCount: evidence.filter((item) => item.evidence_role === "unclear").length,
    strongestEvidenceStrength: strongest,
    problems,
  };
}

export function validateAnswerProvenance(db: SqliteDatabase, answerId: string) {
  const claims = db.prepare("SELECT * FROM answer_claims WHERE answer_id=? ORDER BY claim_order").all(answerId) as Array<{ answer_claim_id: string; support_status: string }>;
  const claimsWithoutEvidence: string[] = [], conflictingClaims: string[] = [], weakClaims: string[] = [], brokenPointers: string[] = [];
  for (const item of getEvidenceForTarget(db, { targetType: "answer", targetId: answerId })) {
    if (!resolveEvidencePointer(db, item.evidence_pointer_id).ok) brokenPointers.push(item.evidence_pointer_id);
  }
  for (const claim of claims) {
    const evidence = getEvidenceForTarget(db, { targetType: "answer_claim", targetId: claim.answer_claim_id });
    if (!evidence.length) claimsWithoutEvidence.push(claim.answer_claim_id);
    if (claim.support_status === "conflicted") conflictingClaims.push(claim.answer_claim_id);
    if (claim.support_status === "weakly_supported" || claim.support_status === "unclear") weakClaims.push(claim.answer_claim_id);
    for (const item of evidence) if (!resolveEvidencePointer(db, item.evidence_pointer_id).ok) brokenPointers.push(item.evidence_pointer_id);
  }
  const problems: string[] = [];
  if (claims.length && claimsWithoutEvidence.length) problems.push("One or more answer claims have no evidence.");
  if (brokenPointers.length) problems.push("One or more provenance pointers are broken.");
  return { ok: claimsWithoutEvidence.length === 0 && brokenPointers.length === 0, answerId, claimCount: claims.length, claimsWithoutEvidence, conflictingClaims, weakClaims, brokenPointers, problems };
}
