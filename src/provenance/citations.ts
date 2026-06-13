import type { SqliteDatabase } from "../db/connection.js";
import { NotFoundError, ValidationError } from "../db/errors.js";
import { now } from "../db/utils.js";
import { makeEvidencePointerUri } from "./pointerFormat.js";
import type { CitationLink, EvidencePointer } from "./types.js";
import { stableProvenanceId } from "./utils.js";

export function formatCitationLabel(order: number): string {
  if (!Number.isInteger(order) || order < 1) throw new ValidationError("Citation order must be a positive integer");
  return `[${order}]`;
}

export function createCitationLinksForAnswer(db: SqliteDatabase, input: { answerId: string; answerClaimIds?: string[] }): CitationLink[] {
  if (!db.prepare("SELECT 1 FROM ai_answers WHERE id=?").get(input.answerId)) throw new NotFoundError(`Answer not found: ${input.answerId}`);
  const claims = db.prepare("SELECT answer_claim_id,claim_order FROM answer_claims WHERE answer_id=? ORDER BY claim_order")
    .all(input.answerId) as Array<{ answer_claim_id: string; claim_order: number }>;
  const selected = input.answerClaimIds ? new Set(input.answerClaimIds) : null;
  const evidence: Array<EvidencePointer & { answer_claim_id: string | null; claim_order: number }> = [];
  evidence.push(...(db.prepare("SELECT *,NULL answer_claim_id,-1 claim_order FROM evidence_pointers WHERE target_type='answer' AND target_id=?").all(input.answerId) as typeof evidence));
  for (const claim of claims) {
    if (selected && !selected.has(claim.answer_claim_id)) continue;
    const rows = db.prepare("SELECT * FROM evidence_pointers WHERE target_type='answer_claim' AND target_id=?").all(claim.answer_claim_id) as EvidencePointer[];
    evidence.push(...rows.map((row) => ({ ...row, answer_claim_id: claim.answer_claim_id, claim_order: claim.claim_order })));
  }
  const roleOrder: Record<string, number> = { support: 1, opposition: 2, conditional: 3, neutral: 4, unclear: 5 };
  evidence.sort((a, b) => a.claim_order - b.claim_order || roleOrder[a.evidence_role] - roleOrder[b.evidence_role] || (b.final_score ?? -1) - (a.final_score ?? -1) || a.evidence_pointer_id.localeCompare(b.evidence_pointer_id));
  return db.transaction(() => {
    db.prepare("DELETE FROM citation_links WHERE answer_id=?").run(input.answerId);
    return evidence.map((item, index) => {
      const order = index + 1;
      const id = stableProvenanceId("cit_", `${input.answerId}:${item.evidence_pointer_id}`);
      db.prepare(`INSERT INTO citation_links(citation_link_id,answer_id,answer_claim_id,evidence_pointer_id,citation_label,citation_order,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(id, input.answerId, item.answer_claim_id, item.evidence_pointer_id, formatCitationLabel(order), order, now());
      return db.prepare("SELECT * FROM citation_links WHERE citation_link_id=?").get(id) as CitationLink;
    });
  })();
}

export function renderCitationMarkdown(db: SqliteDatabase, evidencePointerId: string, label: string): string {
  if (!db.prepare("SELECT 1 FROM evidence_pointers WHERE evidence_pointer_id=?").get(evidencePointerId)) throw new NotFoundError(`Evidence pointer not found: ${evidencePointerId}`);
  return `${label}(${makeEvidencePointerUri(evidencePointerId)})`;
}
