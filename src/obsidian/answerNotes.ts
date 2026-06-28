import type { SqliteDatabase } from "../db/connection.js";
import { renderEvidenceCitation } from "./citations.js";
import { frontmatter, generatedWarning, makeGeneratedFile } from "./markdown.js";
import { answerPath } from "./paths.js";
import type { GeneratedFile } from "./types.js";

export function generateAnswerNotes(db: SqliteDatabase, maxQuoteLength = 300): GeneratedFile[] {
  const answers = db.prepare("SELECT * FROM ai_answers ORDER BY id").all() as Array<Record<string, unknown>>;
  return answers.map((answer) => {
    const claims = db.prepare("SELECT * FROM answer_claims WHERE answer_id=? ORDER BY claim_order").all(answer.id) as Array<Record<string, unknown>>;
    const claimSections = claims.map((claim) => {
      const pointers = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type='answer_claim' AND target_id=? ORDER BY evidence_pointer_id").all(claim.answer_claim_id) as Array<{ evidence_pointer_id: string }>;
      return `### Claim ${Number(claim.claim_order) + 1}: ${claim.support_status}

${claim.claim_text}

${pointers.map((pointer) => renderEvidenceCitation(db, pointer.evidence_pointer_id, maxQuoteLength).markdown).join("\n\n") || "> [!danger] Unsupported claim\n> No evidence pointers."}`;
    }).join("\n\n");
    const warning = answer.answer_status === "weak_evidence" || answer.answer_status === "refused_no_evidence"
      ? "> [!caution] Weak or missing evidence\n> This answer is limited by its evidence."
      : answer.answer_status === "conflicting_evidence" ? "> [!warning] Conflicting evidence\n> The answer must preserve both sides." : "";
    return makeGeneratedFile("answer_note", answerPath(String(answer.question_text), String(answer.id)), `${frontmatter({ mv_entity_type: "answer", mv_entity_id: String(answer.id), mv_generated: true, mv_source_of_truth: "sqlite", mv_support_status: String(answer.answer_status), mv_confidence: String(answer.confidence) })}
# Ask AI Answer

${generatedWarning}

${warning}

## Question

${answer.question_text}

## Generated Answer

> [!note] Generated text
> ${String(answer.answer_text).replace(/\n/g, "\n> ")}

## Claim-Level Citations

${claimSections || "_No claims were generated._"}`, "answer", String(answer.id));
  });
}
