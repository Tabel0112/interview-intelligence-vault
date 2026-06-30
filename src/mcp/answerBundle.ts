// Stable MCP output type: a validated AnswerBundle built from a persisted/just-produced AskAIResponse.
//
// Trust note: this is a 1:1 projection of the pipeline's already-validated answer (claims that survived
// citation/grounding validation, citations that resolve to selected evidence). It NEVER adds content.
// It is the only Ask AI output Claude Desktop should treat as an answer. Secrets are excluded: no API
// keys, no Authorization headers, no prompts, no provider objects, no raw upstream errors. Quote
// previews are length-limited. `pipeline` carries only non-secret synthesis metadata (mode/provider/model).

import type { AskAIResponse } from "../ask-ai/index.js";
import { routeHref, toObsidianUri } from "../frontend/router.js";

export const ANSWER_BUNDLE_VERSION = "mcp-answerbundle-v1";
const QUOTE_PREVIEW_LIMIT = 280;

const clip = (value: string, limit = QUOTE_PREVIEW_LIMIT): string => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
};
const sourceSpanUri = (transcriptId: string, spanId: string) => routeHref.transcript(transcriptId, spanId);
const evidenceUri = (evidencePointerId: string) => routeHref.evidence(evidencePointerId);

export interface AnswerBundleClaim {
  claim_id: string;
  text: string;
  kind: string;
  support_state: string;
  citation_ids: string[];
  warning?: string;
}
/** A LIVE-ONLY, non-transcript AI analysis item. Never cited; never transcript-backed (Step 2). */
export interface AnswerBundleAnalysisItem {
  analysis_id: string;
  text: string;
  kind: string;
  support_state: "ai_analysis";
  warning: string;
}
/** A LIVE-ONLY unconfirmed/tentative/conflict item. Never a claim, never a normal citation (sub-step A). */
export interface AnswerBundleUnconfirmedItem {
  unconfirmed_id: string;
  kind: string;
  label: string;
  text: string;
  warning: string;
  memory_id?: string;
  conflict_id?: string;
  evidence_uri?: string;
  missing_evidence?: boolean;
}
export interface AnswerBundleCitation {
  citation_id: string;
  label: string;
  evidence_pointer_id: string;
  source_pointer_id?: string;
  quote_preview: string;
  source_span_uri: string;
  evidence_uri: string;
  obsidian_internal_uri?: string;
  /** OS-openable external deep links (open Obsidian to the evidence view / transcript span). */
  obsidian_uri?: string;
  source_span_obsidian_uri?: string;
  broken?: boolean;
}
export interface AnswerBundleEvidence {
  evidence_pointer_id: string;
  score: number;
  confidence: string;
  obsidian_uri?: string;
  source_span_obsidian_uri?: string;
  quote_preview: string;
  source_span_uri: string;
  evidence_uri: string;
}
export interface AnswerBundleConflict {
  summary: string;
  explanation: string;
  evidence_uris: string[];
}
export interface AnswerBundleLinks {
  answer_uri: string;
  evidence_uris: string[];
  source_span_uris: string[];
  graph_uri?: string;
  /** OS-openable external deep links (open Obsidian to the matching view). */
  answer_obsidian_uri?: string;
  graph_obsidian_uri?: string;
  evidence_obsidian_uris?: string[];
  source_span_obsidian_uris?: string[];
}
export interface AnswerBundlePipeline {
  answer_mode: string;
  requested_claim_kinds: string[];
  evidence_confidence: string;
  version: string;
  /** Non-secret synthesis metadata only (already redacted upstream). */
  synthesis_mode?: string;
  synthesis_provider?: string;
  synthesis_model?: string;
}
export interface AnswerBundle {
  answer_id: string;
  question: string;
  answer_markdown: string;
  evidence_confidence: string;
  not_enough_evidence: boolean;
  claims: AnswerBundleClaim[];
  /** Live-only AI analysis (uncited, not transcript-backed). Present only on fresh ask_vault responses. */
  analysis?: AnswerBundleAnalysisItem[];
  has_analysis?: boolean;
  /** Live-only unconfirmed/tentative/conflict context (never claims/citations). Fresh responses only. */
  unconfirmed?: AnswerBundleUnconfirmedItem[];
  has_unconfirmed?: boolean;
  citations: AnswerBundleCitation[];
  evidence: AnswerBundleEvidence[];
  warnings: string[];
  conflicts: AnswerBundleConflict[];
  followups: string[];
  links: AnswerBundleLinks;
  created_at: string;
  pipeline: AnswerBundlePipeline;
}

const claimWarning = (support: string): string | undefined =>
  support === "weakly_supported" ? "Supported only by weak/indirect evidence — treat cautiously."
    : support === "conflicting" ? "Sources conflict; both sides are preserved below."
      : support === "unsupported" ? "Not supported by the cited evidence." : undefined;

export function toAnswerBundle(response: AskAIResponse, options: { brokenCitationIds?: string[]; obsidianVault?: string } = {}): AnswerBundle {
  const broken = new Set(options.brokenCitationIds ?? []);
  // External deep link from a canonical mv:// route. Navigation only; no secrets are ever in a route.
  const ext = (mvUri: string) => toObsidianUri(mvUri, { vault: options.obsidianVault });
  const citations: AnswerBundleCitation[] = response.citations.map((c) => {
    const spanUri = sourceSpanUri(c.transcriptId, c.spanId);
    const evUri = evidenceUri(c.evidencePointerId);
    return {
      citation_id: c.id,
      label: c.label,
      evidence_pointer_id: c.evidencePointerId,
      source_pointer_id: c.sourcePointerId,
      quote_preview: clip(c.quotePreview),
      source_span_uri: spanUri,
      evidence_uri: evUri,
      obsidian_internal_uri: c.clickbackUri,
      obsidian_uri: ext(evUri),
      source_span_obsidian_uri: ext(spanUri),
      ...(broken.has(c.id) ? { broken: true } : {}),
    };
  });
  const evidence: AnswerBundleEvidence[] = response.evidence.map((e) => {
    const spanUri = sourceSpanUri(e.transcriptId, e.spanId);
    const evUri = evidenceUri(e.evidencePointerId);
    return {
      evidence_pointer_id: e.evidencePointerId,
      score: e.evidenceScore,
      confidence: e.evidenceConfidence,
      obsidian_uri: ext(evUri),
      source_span_obsidian_uri: ext(spanUri),
      quote_preview: clip(e.quotePreview),
      source_span_uri: spanUri,
      evidence_uri: evUri,
    };
  });
  const claims: AnswerBundleClaim[] = response.claims.map((claim) => ({
    claim_id: claim.id,
    text: claim.text,
    kind: claim.kind,
    support_state: claim.supportStatus,
    citation_ids: claim.citationIds,
    ...(claimWarning(claim.supportStatus) ? { warning: claimWarning(claim.supportStatus) } : {}),
  }));

  // Live-only AI analysis (Step 2): uncited, never transcript-backed. Projected as-is; never promoted.
  const analysis: AnswerBundleAnalysisItem[] = (response.analysis ?? []).map((a) => ({
    analysis_id: a.id, text: a.text, kind: a.kind, support_state: a.supportStatus, warning: a.warning,
  }));
  // Live-only unconfirmed context (sub-step A): separate from claims/citations; never a supported claim.
  const unconfirmed: AnswerBundleUnconfirmedItem[] = (response.unconfirmed ?? []).map((u) => ({
    unconfirmed_id: u.id, kind: u.kind, label: u.label, text: u.text, warning: u.warning,
    ...(u.memoryId ? { memory_id: u.memoryId } : {}), ...(u.conflictId ? { conflict_id: u.conflictId } : {}),
    ...(u.evidenceUri ? { evidence_uri: u.evidenceUri } : {}), ...(u.missingEvidence ? { missing_evidence: true } : {}),
  }));

  const warnings: string[] = [];
  if (response.notEnoughEvidence || response.evidenceConfidence === "no_evidence") {
    warnings.push(analysis.length
      ? "No transcript evidence was found; the AI analysis below is reasoning, not transcript-backed evidence."
      : "No supporting transcript evidence was found; this is a refusal, not an answer.");
  } else if (response.evidenceConfidence === "weak") {
    warnings.push("Evidence is weak; do not treat this as strong truth.");
  } else if (response.evidenceConfidence === "conflicting") {
    warnings.push("Sources conflict; both sides are preserved with citations.");
  }
  if (broken.size > 0) warnings.push(`${broken.size} citation pointer(s) no longer resolve.`);
  if (response.analysisUnavailable) warnings.push("AI analysis could not be generated for this answer; the transcript-backed evidence above is unaffected.");
  if (analysis.length) warnings.push("This answer includes AI analysis that is not from your transcripts and is not cited evidence.");
  if (unconfirmed.length) warnings.push("This answer includes unconfirmed/review-only/tentative/conflict context that is NOT confirmed transcript-backed fact.");

  const conflicts: AnswerBundleConflict[] = response.conflicts.map((conflict) => ({
    summary: conflict.summary,
    explanation: conflict.explanation,
    evidence_uris: [...new Set(conflict.evidenceLinks.map((link) => evidenceUri(link.evidencePointerId)))],
  }));

  const evidenceUris = [...new Set(citations.map((c) => c.evidence_uri))];
  const sourceSpanUris = [...new Set(citations.map((c) => c.source_span_uri))];

  return {
    answer_id: response.id,
    question: response.question,
    answer_markdown: response.answerMarkdown,
    evidence_confidence: response.evidenceConfidence,
    not_enough_evidence: response.notEnoughEvidence,
    claims,
    ...(analysis.length ? { analysis, has_analysis: true } : {}),
    // Always present (array + boolean) so live ask_vault and reconstructed get_answer share one contract.
    unconfirmed, has_unconfirmed: unconfirmed.length > 0,
    citations,
    evidence,
    warnings,
    conflicts,
    followups: response.suggestedFollowups,
    links: {
      answer_uri: routeHref.answer(response.id), evidence_uris: evidenceUris, source_span_uris: sourceSpanUris, graph_uri: routeHref.graph(),
      answer_obsidian_uri: ext(routeHref.answer(response.id)), graph_obsidian_uri: ext(routeHref.graph()),
      evidence_obsidian_uris: evidenceUris.map(ext), source_span_obsidian_uris: sourceSpanUris.map(ext),
    },
    created_at: response.createdAt,
    pipeline: {
      answer_mode: response.queryUnderstanding.answerMode,
      requested_claim_kinds: response.queryUnderstanding.requestedClaimKinds,
      evidence_confidence: response.evidenceConfidence,
      version: ANSWER_BUNDLE_VERSION,
      synthesis_mode: response.synthesis?.mode,
      synthesis_provider: response.synthesis?.provider,
      synthesis_model: response.synthesis?.model,
    },
  };
}
