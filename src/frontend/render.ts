import { appShell, emptyState, escapeHtml, routeButton, score, trustBadge } from "./html.js";
import { routeHref } from "./router.js";
import { DEGRADED_MEMORY_REASON } from "./types.js";
import type { AskAITraceView, ConflictingSideView, EvidenceView, FrontendAnswerView, MemoryView, PageContext, RenderedPage, ReviewItemView, ReviewSupportSpanView, SearchResultView, SetupSummary, SupportSpanView, TranscriptView, TrustState } from "./types.js";

const section = (title: string, body: string, className = "") => `<section class="vault-section${className ? ` ${escapeHtml(className)}` : ""}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
const links = (items: Array<{ href: string; label: string }>) => `<div class="route-actions">${items.map((item) => routeButton(item.href, item.label)).join("")}</div>`;
/** A light status chip: a small muted pill with a state dot. State is carried by the TEXT (not color alone). */
const statusChip = (state: "ok" | "warn" | "error", label: string) =>
  `<span class="tmv-status tmv-status--${state}">${escapeHtml(label)}</span>`;
const correctionForm = (targetType: string, targetId: string) => ["memory_object", "answer_claim", "citation", "graph_node", "graph_edge", "evidence", "speaker", "answer", "span", "transcript"].includes(targetType)
  ? `<form data-action="correction"><input type="hidden" name="targetType" value="${escapeHtml(targetType)}"><input type="hidden" name="targetId" value="${escapeHtml(targetId)}">
      <label>Append-only correction <textarea name="correctionText" required></textarea></label><label>Reason <input name="reason"></label>
      <button type="submit">Submit correction</button></form><div data-form-result></div>`
  : `<p class="trust-warning">This target type does not yet have a backend correction record type. Use its owning memory, answer, or graph edge.</p>`;

function evidenceCard(evidence: EvidenceView): string {
  const clickback = evidence.brokenReason
    ? `<p class="error">Pointer resolution failed: ${escapeHtml(evidence.brokenReason)}</p>`
    : `<a class="transcript-clickback" href="${escapeHtml(routeHref.transcript(evidence.transcriptId, evidence.spanId))}">Open exact transcript span</a>`;
  return `<article class="evidence-card" data-evidence-id="${escapeHtml(evidence.id)}">
    <header>${trustBadge(evidence.strength)} <strong>${escapeHtml(evidence.role)}</strong> <span>${score(evidence.finalScore ?? evidence.confidence)}</span></header>
    <blockquote>${escapeHtml(evidence.quotePreview || evidence.spanText)}</blockquote>
    <p>${escapeHtml(evidence.transcriptTitle)} · span ${escapeHtml(evidence.spanId)}</p><button type="button" data-copy-quote="${escapeHtml(evidence.quotePreview || evidence.spanText)}">Copy quote</button>
    ${links([{ href: routeHref.evidence(evidence.id), label: "Evidence details" }])} ${clickback}
  </article>`;
}

function answerView(answer: FrontendAnswerView): string {
  const hasTraceableAnswer = answer.claims.length > 0 && answer.citations.length > 0 && answer.evidence.length > 0;
  const confidence = (hasTraceableAnswer ? answer.evidenceConfidence : "no_evidence") as TrustState;
  const brokenWarning = answer.brokenCitationIds?.length
    ? `<aside class="trust-warning">${trustBadge("broken")} ${answer.brokenCitationIds.length} citation pointer(s) no longer resolve.</aside>` : "";
  const warning = confidence === "weak" || confidence === "no_evidence"
    ? `<aside class="trust-warning">${trustBadge(confidence)} This answer must not be treated as strong truth.</aside>`
    : confidence === "conflicting"
      ? `<aside class="trust-warning">${trustBadge("conflicting")} Supporting and opposing evidence are both preserved below.</aside>`
      : "";
  const citations = new Map(answer.citations.map((citation) => [citation.id, citation]));
  const claims = answer.claims.map((claim) => `<article class="answer-claim" data-support-status="${escapeHtml(claim.supportStatus)}">
    <p>${escapeHtml(claim.text)}</p>
    <footer>${trustBadge(claim.supportStatus === "supported" ? "strong" : claim.supportStatus === "conflicting" ? "conflicting" : claim.supportStatus === "weakly_supported" ? "weak" : "no_evidence")}
      ${claim.citationIds.map((id) => {
        const citation = citations.get(id);
        return citation ? `<span class="citation-preview"><a class="citation-link" href="${escapeHtml(routeHref.evidence(citation.evidencePointerId))}" title="${escapeHtml(citation.quotePreview)}">${escapeHtml(citation.label)}</a><small>${escapeHtml(citation.quotePreview)}</small>${correctionForm("citation", citation.id)}</span>` : "";
      }).join(" ")}
    </footer>
    ${correctionForm("answer_claim", claim.id)}
  </article>`).join("");
  const evidence = answer.evidence.map((item) => `<article class="evidence-card">
    ${trustBadge(item.evidenceConfidence as TrustState)} <strong>${escapeHtml(item.stance === "opposes" ? "Opposing/conflicting evidence" : item.stance === "supports" ? "Supporting evidence" : item.stance)}</strong>
    <blockquote>${escapeHtml(item.quotePreview)}</blockquote>
    <p>${escapeHtml(item.scoringExplanation)}</p>
    <a href="${escapeHtml(routeHref.evidence(item.evidencePointerId))}">Inspect evidence and transcript source</a>
    ${correctionForm("evidence", item.evidencePointerId)}
  </article>`).join("");
  const conflict = answer.conflicts.map((item) => `<article class="conflict-card">${trustBadge("conflicting")}<h3>${escapeHtml(item.summary)}</h3><p>${escapeHtml(item.explanation)}</p></article>`).join("");
  return `${brokenWarning}${warning}${links([{ href: routeHref.answerTrace(answer.id), label: "View trace" }])}
    <article class="answer"><h2>Generated answer</h2><pre>${escapeHtml(answer.answerMarkdown)}</pre></article>
    ${section("Claims and citations", claims || emptyState("No supported claims", "The answer correctly refused to invent claims."))}
    ${section("Evidence", evidence || emptyState("No evidence", "No transcript-backed evidence was available."))}
    ${conflict ? section("Conflicts", conflict) : ""}${section("Submit a correction", correctionForm("answer", answer.id))}`;
}

const claimSupportBadge = (supportStatus: string): string =>
  trustBadge(supportStatus === "supported" ? "strong" : supportStatus === "conflicting" ? "conflicting" : supportStatus === "weakly_supported" ? "weak" : "no_evidence", supportStatus.replaceAll("_", " "));

/** One "label: value" row for the trace's definition-list sections. */
const traceRow = (label: string, value: string): string =>
  `<div class="trace-row"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;
const traceFlag = (on: boolean, onLabel = "yes", offLabel = "no"): string =>
  `<span class="trace-flag" data-on="${on}">${escapeHtml(on ? onLabel : offLabel)}</span>`;
const traceList = (items: string[], empty: string): string =>
  items.length ? escapeHtml(items.join(", ")) : `<em class="trace-empty">${escapeHtml(empty)}</em>`;

/**
 * READ-ONLY Ask AI trace page (developer/debug-oriented): how one persisted run went from question to
 * answer/refusal. Renders only structured persisted fields (never parses the generated Markdown); raw
 * ids/JSON live under an Advanced disclosure; nothing here mutates or re-runs anything.
 */
function traceView(trace: AskAITraceView): string {
  const qu = trace.queryUnderstanding;
  const contract = trace.answerContract;
  const synthesisIntent = qu.intent === "synthesis_conclusion" || qu.intent === "why_explanation";

  // A. Question and result
  const refused = trace.notEnoughEvidence;
  const result = `<dl class="trace-kv">
      ${traceRow("Question", `<strong>${escapeHtml(trace.question)}</strong>`)}
      ${traceRow("Status", `${statusChip(refused ? "warn" : "ok", trace.answerStatus.replaceAll("_", " "))}`)}
      ${traceRow("Evidence confidence", trustBadge(trace.confidence as TrustState))}
      ${traceRow("Created", escapeHtml(trace.createdAt))}
    </dl>
    ${trace.refusalReason ? `<aside class="trust-warning tmv-callout tmv-callout--warning">${trustBadge("no_evidence")} ${escapeHtml(trace.refusalReason)}</aside>` : ""}`;

  // B. Query understanding
  const understanding = `<dl class="trace-kv">
      ${traceRow("Intent", `<code>${escapeHtml(qu.intent)}</code>`)}
      ${traceRow("Understanding source", statusChip("ok", qu.understandingSource === "llm" ? "LLM-assisted (deterministic contract)" : qu.understandingSource === "deterministic" ? "deterministic (regex)" : "not recorded (legacy run)"))}
      ${traceRow("Answer mode", escapeHtml(qu.answerMode))}
      ${traceRow("Requested claim kinds", traceList(qu.requestedClaimKinds, "none recorded"))}
      ${traceRow("Detected entities", traceList(qu.detectedEntities, "none detected"))}
      ${traceRow("Detected topics", traceList(qu.detectedTopics, "none detected"))}
      ${traceRow("Time hints", traceList(qu.timeHints, "none detected"))}
    </dl>`;

  // C. Answer contract — deterministic per-intent flags; the conclusion/why notice is informational.
  const conclusionNotice = synthesisIntent
    ? `<aside class="tmv-callout tmv-callout--info trace-conclusion-notice">This run uses evidence-backed conclusion routing, but full entailment validation is not implemented yet. Claims are still constrained by the current grounding gate.</aside>`
    : "";
  const contractBody = contract
    ? `${synthesisIntent ? `<p>${statusChip("ok", "evidence-bounded synthesis")} This intent answers ONLY from selected transcript evidence — it is not the free-reasoning advice path.</p>` : ""}
      <dl class="trace-kv">
        ${traceRow("Evidence required for factual claims", traceFlag(contract.requireEvidenceForFactualClaims))}
        ${traceRow("Refuse if no evidence", traceFlag(contract.refuseIfNoEvidence))}
        ${traceRow("Include conflicts", traceFlag(contract.includeConflicts))}
        ${traceRow("Use memory objects", traceFlag(qu.shouldUseMemoryObjects))}
        ${traceRow("Use raw transcript spans", traceFlag(qu.shouldUseRawTranscriptSpans))}
        ${traceRow("General reasoning (uncited analysis) allowed", traceFlag(contract.allowGeneralReasoning))}
        ${traceRow("Recommendations allowed", traceFlag(contract.allowRecommendations))}
        ${traceRow("Drafting allowed", traceFlag(contract.allowDrafting))}
        ${traceRow("Review-only items allowed", traceFlag(contract.includeReviewOnlyItems))}
      </dl>${conclusionNotice}`
    : `<p><em class="trace-empty">Answer contract was not persisted for this run (legacy row) — behavior flags cannot be reconstructed and are not invented.</em></p>${conclusionNotice}`;

  // D. Selected evidence
  const evidenceCards = trace.selectedEvidence.map((item) => `<article class="evidence-card trace-evidence" data-pointer-id="${escapeHtml(item.evidencePointerId)}">
      <header><span class="trace-rank">#${item.rank}</span> ${trustBadge(item.confidence as TrustState)} <span>${score(item.score)}</span> ${item.broken ? trustBadge("broken") : ""}</header>
      <blockquote>${escapeHtml(item.quote)}</blockquote>
      <p>${escapeHtml(item.scoringExplanation)}</p>
      <p><code>${escapeHtml(item.evidencePointerId)}</code></p>
      ${links([{ href: routeHref.evidence(item.evidencePointerId), label: "Evidence details" }, { href: routeHref.transcript(item.transcriptId, item.spanId), label: "Open source span" }])}
    </article>`).join("");

  // E. Claims and citations
  const claimCards = trace.claims.map((claim) => `<article class="answer-claim trace-claim" data-support-status="${escapeHtml(claim.supportStatus)}">
      <p>${escapeHtml(claim.text)}</p>
      <footer><code>${escapeHtml(claim.kind)}</code> ${claimSupportBadge(claim.supportStatus)}
        ${claim.citationLabels.map(escapeHtml).map((label) => `<span class="citation-preview">${label}</span>`).join(" ")}
        ${claim.citedPointerIds.map((pointerId) => `<a class="citation-link" href="${escapeHtml(routeHref.evidence(pointerId))}"><code>${escapeHtml(pointerId)}</code></a>`).join(" ")}
      </footer>
      ${claim.explanation ? `<p class="trace-claim-explanation"><small>${escapeHtml(claim.explanation)}</small></p>` : ""}
    </article>`).join("");

  // F. Warnings and honest limitations (structured fields only — never scraped from answer Markdown).
  const warningsBody = `${trace.warnings.length
      ? `<ul class="trace-warnings">${trace.warnings.map((warning) => `<li>${trustBadge("weak", "warning")} ${escapeHtml(warning)}</li>`).join("")}</ul>`
      : `<p><em class="trace-empty">No trust warnings were recorded for this run.</em></p>`}
    <ul class="trace-limitations">${trace.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;

  // G. Advanced disclosure: raw ids + sanitized JSON. Synthesis metadata is the persisted NON-SECRET
  // summary (mode/provider id/model id/fallback) — API keys never enter these tables.
  const debugJson = JSON.stringify(
    { runId: trace.runId, answerId: trace.answerId ?? null, scoreRunId: trace.scoreRunId ?? null, synthesis: trace.synthesis ?? null, counts: { evidence: trace.selectedEvidence.length, claims: trace.claims.length, conflicts: trace.conflictCount, analysis: trace.analysisCount, unconfirmed: trace.unconfirmedCount }, queryUnderstanding: qu, answerContract: contract ?? null },
    null, 2);
  const advanced = `<details class="tmv-advanced trace-debug"><summary>Advanced: raw ids and debug JSON</summary>
      <dl class="trace-kv">
        ${traceRow("Run id", `<code>${escapeHtml(trace.runId)}</code>`)}
        ${traceRow("Answer id", trace.answerId ? `<code>${escapeHtml(trace.answerId)}</code>` : "<em>none persisted</em>")}
        ${traceRow("Score run id", trace.scoreRunId ? `<code>${escapeHtml(trace.scoreRunId)}</code>` : "<em>none persisted</em>")}
        ${traceRow("Synthesis", trace.synthesis ? escapeHtml(`${trace.synthesis.mode}${trace.synthesis.provider ? ` · ${trace.synthesis.provider}` : ""}${trace.synthesis.model ? ` · ${trace.synthesis.model}` : ""}${trace.synthesis.usedFallback ? " · fallback" : ""}`) : "not recorded")}
      </dl>
      <pre class="trace-debug-json">${escapeHtml(debugJson)}</pre>
    </details>`;

  return `<aside class="immutable-notice">Read-only trace of a persisted Ask AI run. Nothing on this page re-runs retrieval or generation, and nothing is modified.</aside>
    ${links([...(trace.answerId ? [{ href: routeHref.answer(trace.runId), label: "Open answer" }] : []), { href: routeHref.dashboard(), label: "Dashboard" }])}
    ${section("Question and result", result)}
    ${section("Query understanding", understanding)}
    ${section("Answer contract", contractBody)}
    ${section("Selected evidence", evidenceCards || emptyState("No evidence was selected", "The run refused (or found nothing usable) — that is the safe behavior, not an error."))}
    ${section("Claims and citations", claimCards || emptyState("No accepted claims", "No claims survived evidence selection and the grounding gate. The run refused rather than inventing an answer."))}
    ${section("Warnings and limitations", warningsBody)}
    ${section("Debug", advanced, "trace-debug-section")}`;
}

function transcriptView(transcript: TranscriptView, selectedSpanId?: string): string {
  const selectedIndex = selectedSpanId ? transcript.spans.findIndex((span) => span.id === selectedSpanId) : -1;
  const start = selectedIndex >= 0 ? Math.max(0, selectedIndex - 20) : 0;
  const visibleSpans = transcript.spans.slice(start, start + 100);
  const spans = visibleSpans.map((span) => `<article id="span-${escapeHtml(span.id)}" class="transcript-span${span.id === selectedSpanId ? " selected-span" : ""}" data-span-id="${escapeHtml(span.id)}">
    <header><strong>${escapeHtml(span.speaker ?? "Unknown speaker")}</strong> <span>${span.startTimeMs == null ? "" : `${Math.round(span.startTimeMs / 1000)}s`}</span></header>
    <pre>${escapeHtml(span.text)}</pre><button type="button" data-copy-quote="${escapeHtml(span.text)}">Copy quote</button><small>Raw offsets ${span.startChar}-${span.endChar}</small>
  </article>`).join("");
  const missing = selectedSpanId && !transcript.spans.some((span) => span.id === selectedSpanId)
    ? `<aside class="trust-warning">${trustBadge("broken")} Requested span ${escapeHtml(selectedSpanId)} was not found.</aside>` : "";
  return `<aside class="immutable-notice">Raw transcript source is immutable. Generated text and corrections are stored separately.</aside>${missing}
    <p>${escapeHtml(transcript.status)} · ${transcript.spanCount} spans · showing ${visibleSpans.length} · imported ${escapeHtml(transcript.importedAt)}</p>
    <div class="transcript-viewer" data-selected-span="${escapeHtml(selectedSpanId ?? "")}">${spans}</div>`;
}

/** A raw extraction support span (NOT citable evidence): quote + transcript label + open-span clickback. */
const supportSpanCard = (span: SupportSpanView): string =>
  `<article class="evidence-card support-span" data-support-span-id="${escapeHtml(span.spanId)}">
    <header>${trustBadge("needs_review", "Support only")} <strong>${escapeHtml(span.role)}</strong> <span>${score(span.evidenceScore)}</span></header>
    <blockquote>${escapeHtml(span.quote)}</blockquote>
    <p>${escapeHtml(span.transcriptTitle)} · span ${escapeHtml(span.spanId)}</p>
    <a class="transcript-clickback" href="${escapeHtml(routeHref.transcript(span.transcriptId, span.spanId))}">Open exact transcript span</a>
  </article>`;

/** The active memory a pending memory conflicts with, shown alongside its own source support quotes. */
function conflictingSideCard(side: ConflictingSideView): string {
  const spans = side.supportSpans.length
    ? side.supportSpans.map(supportSpanCard).join("")
    : emptyState("No source spans found", "This active memory has no resolvable source spans.");
  return `<article class="conflict-side conflict-side--active tmv-card">
    <p>${trustBadge("strong")} active memory · ${escapeHtml(side.type)} · confidence ${score(side.confidence)} (${escapeHtml(side.confidenceLabel)}) · status ${escapeHtml(side.status)}</p>
    <h4>${escapeHtml(side.title)}</h4><p>${escapeHtml(side.body)}</p>
    ${spans}
    ${links([{ href: routeHref.memory(side.memoryId), label: "Open the active memory" }])}
  </article>`;
}

function conflictReviewSection(view: MemoryView): string {
  const conflict = view.conflictReview;
  if (!conflict) return "";
  const memory = view.memory;
  const pendingSpans = view.supportSpans.length ? view.supportSpans.map(supportSpanCard).join("") : "";
  const pendingSide = `<article class="conflict-side conflict-side--pending tmv-card">
    <p>${trustBadge(view.trustState)} pending memory · ${escapeHtml(memory.type)} · confidence ${score(memory.confidence)} (${escapeHtml(memory.confidenceLabel)}) · status ${escapeHtml(memory.status)}</p>
    <h4>${escapeHtml(memory.title || memory.type)}</h4><p>${escapeHtml(memory.body)}</p>
    ${pendingSpans}
  </article>`;
  const meta = conflict.conflictType
    ? `<p>${trustBadge("conflicting")} Conflict type: <strong>${escapeHtml(conflict.conflictType.replaceAll("_", " "))}</strong>${conflict.confidence != null ? ` · confidence ${score(conflict.confidence)}` : ""}</p>${conflict.explanation ? `<p>${escapeHtml(conflict.explanation)}</p>` : ""}`
    : "";
  const otherSide = conflict.active
    ? conflictingSideCard(conflict.active)
    : `<aside class="trust-warning tmv-callout tmv-callout--warning">${trustBadge("conflicting")} Conflicting active memory could not be resolved; inspect the <a href="${escapeHtml(routeHref.review("conflict"))}">conflicts list</a>. Approving preserves both sides so live conflict detection can surface it.</aside>`;
  return section("Conflict — both sides preserved", `${meta}<div class="conflict-comparison">${pendingSide}${otherSide}</div>`);
}

function memoryView(view: MemoryView): string {
  const memory = view.memory;
  // A memory in a reviewable state gets the same Approve/Reject controls here as in the review queue,
  // so following a review item to its memory page is never a dead end.
  const reviewable = memory.status === "needs_review" || memory.status === "weak";
  // Show the SPECIFIC review reason (conflict/tentative/duplicate/overbroad/legacy) rather than the old
  // generic "not independent strong truth". Falls back to the generic line only for non-reviewable weakness.
  const warning = view.trustState === "strong" ? ""
    : reviewable && view.reviewReason
      ? `<aside class="trust-warning tmv-callout tmv-callout--warning">${trustBadge(view.trustState)} <strong>Not active yet.</strong> This memory is not active yet because: ${escapeHtml(view.reviewReason)}</aside>`
      : `<aside class="trust-warning">${trustBadge(view.trustState)} This memory is not independent strong truth.</aside>`;
  // Same actionability rule as the review queue: a memory with no live evidence span (e.g. its source
  // transcript was deleted) is degraded — Approve is omitted with a warning; Reject/Dismiss stays available.
  const hasLiveEvidence = memory.evidenceSpanIds.length > 0;
  const reviewSection = reviewable
    ? section("Review decision",
        `<p><strong>What happens if you approve:</strong> this memory becomes active, citable evidence for Ask AI and search — its source support spans become citable.</p>
         <p><strong>What happens if you reject:</strong> this extracted memory is removed from Ask AI and search. It does not delete or edit the raw transcript.</p>
         <p class="review-source__meta">Both are append-only decisions and never change raw transcript text.</p>
         ${memoryReviewControls(memory.id, { canApprove: hasLiveEvidence, degradedReason: hasLiveEvidence ? undefined : DEGRADED_MEMORY_REASON })}`)
    : "";
  // Extraction support spans: shown when this reviewable memory has span-level support but NO citable
  // evidence pointers yet (Policy A). Clearly labeled as not-yet-citable; displaying them never promotes.
  const supportSection = reviewable && view.supportSpans.length && view.evidence.length === 0
    ? section("Extraction support spans", `<aside class="immutable-notice">These source spans were used by extraction, but they are not citable evidence until this memory is approved.</aside>${view.supportSpans.map(supportSpanCard).join("")}`)
    : "";
  return `${warning}<article class="memory-object">
    <p>${trustBadge(view.trustState)} ${escapeHtml(memory.type)} · confidence ${score(memory.confidence)} (${escapeHtml(memory.confidenceLabel)})</p>
    <h2>${escapeHtml(memory.title || memory.type)}</h2><p>${escapeHtml(memory.body)}</p>
    <dl><dt>Canonical status</dt><dd>${escapeHtml(memory.status)}</dd><dt>Evidence spans</dt><dd>${memory.evidenceSpanIds.length}</dd><dt>User corrected</dt><dd>${memory.userCorrected ? "yes" : "no"}</dd><dt>Duplicate of</dt><dd>${escapeHtml(memory.duplicateOfId ?? "none")}</dd></dl>
  </article>${section("Evidence", view.evidence.map(evidenceCard).join("") || emptyState("No linked evidence pointers", reviewable ? "Not citable evidence yet — approve this memory to promote its support spans to citable evidence. See the extraction support spans below." : "This memory cannot be treated as strong."))}
  ${supportSection}
  ${conflictReviewSection(view)}
  ${view.conflicts.length ? section("Conflicts", view.conflicts.map((item) => `<article>${trustBadge("conflicting")} <strong>${escapeHtml(item.summary)}</strong><p>${escapeHtml(item.explanation)}</p></article>`).join("")) : ""}
  ${reviewSection}
  ${section("Submit a correction", correctionForm("memory_object", memory.id))}`;
}

// Approve/Reject operate on a memory object's review status via reviewMemoryObject. They are shown
// only when the review item is safely tied to a real memory_object id — never creating fake evidence
// or editing raw transcript text. The submit handler reads memoryId from this form. A degraded memory
// (zero live evidence, e.g. its source transcript was deleted) CANNOT be approved — Approve is omitted and
// a clear warning is shown — but it stays dismissible via Reject so it is never a dead/actionless item.
const memoryReviewControls = (memoryId: string, options: { canApprove?: boolean; degradedReason?: string } = {}): string => {
  // Presentation only: the degraded warning is the same reason text, now in a warning callout that also
  // spells out WHY Approve is unavailable. The canApprove gate itself is unchanged. Button VALUES
  // (approve/reject) are unchanged — only the human labels are clearer.
  const warning = options.degradedReason
    ? `<aside class="trust-warning tmv-callout tmv-callout--warning">${trustBadge("no_evidence", "Evidence removed")} ${escapeHtml(options.degradedReason)} <em>Approve is unavailable because there is no live evidence to promote — you can still Reject / do not use.</em></aside>`
    : "";
  const approve = options.canApprove === false ? "" : `<button type="submit" name="decision" value="approve" class="tmv-btn tmv-btn-primary">Approve as active memory</button>`;
  return `${warning}<form data-action="review" class="review-actions"><input type="hidden" name="memoryId" value="${escapeHtml(memoryId)}">
      ${approve}<button type="submit" name="decision" value="reject" class="tmv-btn tmv-btn-secondary">Reject / do not use</button></form><div data-form-result></div>`;
};

const reviewActions = (item: ReviewItemView): string => {
  // memory_needs_review is always a memory_object; weak_evidence may be attached to a memory_object.
  if (item.targetType === "memory_object" && (item.type === "memory_needs_review" || item.type === "weak_evidence")) {
    return memoryReviewControls(item.targetId, { canApprove: item.canApprove, degradedReason: item.degradedReason });
  }
  // Weak evidence not tied to a memory object: no safe direct Approve/Reject — explain instead.
  if (item.type === "weak_evidence") {
    return `<p class="trust-warning">This weak-evidence item is attached to a ${escapeHtml(item.targetType)}, not a memory object, so it has no direct Approve/Reject. Open the linked evidence and use the append-only correction below.</p>`;
  }
  return "";
};

// Friendly, human badge label per review item kind (never the raw enum on the card face).
const reviewBadgeLabel = (item: ReviewItemView): string =>
  item.type === "conflict" ? "Conflict"
    : item.type === "broken_pointer" ? "Broken evidence"
      : item.type === "weak_evidence" ? "Weak evidence"
        : item.type === "user_correction" ? "Correction received"
          : "Needs review";

// Raw extraction support span shown on the card: the immutable transcript quote used by extraction,
// explicitly labeled NOT citable until approved, with an open-exact-span clickback. Never a pointer.
const reviewSupportSpanBlock = (span: ReviewSupportSpanView): string =>
  `<div class="review-source">
    <p class="review-label">Source span used for extraction <span class="review-pill review-pill--muted">Not citable until approved</span></p>
    <blockquote>${escapeHtml(span.quote)}</blockquote>
    <p class="review-source__meta">${escapeHtml(span.transcriptTitle)} · span ${escapeHtml(span.spanId)}</p>
    <a class="transcript-clickback" href="${escapeHtml(routeHref.transcript(span.transcriptId, span.spanId))}">Open exact transcript span</a>
  </div>`;

// Compact both-sides comparison on a conflict card. `conflictWith === undefined` => not a conflict item.
function reviewConflictCompact(item: ReviewItemView): string {
  if (item.conflictWith === undefined) return "";
  const other = item.conflictWith;
  const pending = `<div class="review-conflict__side"><p class="review-conflict__role">This memory</p><p>${escapeHtml(item.memoryBody ?? item.title)}</p></div>`;
  const active = other
    ? `<div class="review-conflict__side"><p class="review-conflict__role">Conflicts with active memory</p><p><strong>${escapeHtml(other.title)}</strong></p><p>${escapeHtml(other.body)}</p>${other.quote ? `<blockquote>${escapeHtml(other.quote)}</blockquote>` : ""}${other.memoryId ? `<a href="${escapeHtml(routeHref.memory(other.memoryId))}">Open the active memory</a>` : ""}</div>`
    : `<div class="review-conflict__side"><p class="review-conflict__role">Conflicts with active memory</p><p class="trust-warning">Could not be resolved — inspect the conflicts list. Approving preserves both sides so live conflict detection can surface it.</p></div>`;
  return `<div class="review-conflict"><p class="review-label">${trustBadge("conflicting")} Conflict — both sides preserved</p><div class="review-conflict__grid">${pending}${active}</div></div>`;
}

function reviewCard(item: ReviewItemView): string {
  const isMemory = item.type === "memory_needs_review";
  // A memory item links to its full memory detail page; other items to the review-detail route.
  const detailHref = isMemory ? routeHref.memory(item.targetId) : routeHref.review(item.id);
  const typeChip = item.memoryType ? `<span class="review-pill">${escapeHtml(item.memoryType.replaceAll("_", " "))}</span>` : "";
  const bodyBlock = item.memoryBody ? `<div class="review-extracted"><p class="review-label">Extracted memory</p><p>${escapeHtml(item.memoryBody)}</p></div>` : "";
  const sourceBlock = item.supportSpan ? reviewSupportSpanBlock(item.supportSpan) : "";
  const conflictBlock = reviewConflictCompact(item);
  const decisionHelp = (item.type === "memory_needs_review" || item.type === "conflict")
    ? `<p class="review-decision-help"><strong>Approve</strong> if this should become active memory for Ask AI and search. <strong>Reject</strong> if this extraction is wrong, too vague, a duplicate, or should not be used.</p>`
    : "";
  // Debug/technical metadata is moved off the card face into a collapsed disclosure.
  const advanced = `<details class="review-card__advanced"><summary>Details</summary><small>${escapeHtml(item.severity)} severity · ${escapeHtml(item.status)} · ${escapeHtml(item.type)} · ${escapeHtml(item.targetType)}:${escapeHtml(item.targetId)}</small> <a href="${escapeHtml(routeHref.review(item.id))}">Review and correct</a></details>`;
  return `<article class="review-card tmv-card" data-review-type="${escapeHtml(item.type)}">
    <header class="review-card__head">${trustBadge(item.trustState, reviewBadgeLabel(item))}${typeChip}<h3 class="review-card__title"><a href="${escapeHtml(detailHref)}">${escapeHtml(item.title)}</a></h3></header>
    <div class="review-why"><p class="review-label">Why this needs review</p><p>${escapeHtml(item.detail)}</p></div>
    ${bodyBlock}${sourceBlock}${conflictBlock}${decisionHelp}${reviewActions(item)}${advanced}</article>`;
}

function searchCard(item: SearchResultView): string {
  return `<article class="search-result">${item.trustState ? trustBadge(item.trustState) : ""}<h3><a href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a></h3>
    <p>${escapeHtml(item.preview)}</p><small>${escapeHtml(item.type)}</small></article>`;
}

function graphNodeLink(nodeId: string): string | null {
  const [kind, id] = nodeId.split(":", 2);
  if (!id) return null;
  return kind === "memory" ? routeHref.memory(id)
    : kind === "transcript" ? routeHref.transcript(id)
      : kind === "evidence" ? routeHref.evidence(id) : null;
}

function healthView(health: NonNullable<Awaited<ReturnType<PageContext["api"]["getDashboard"]>>["health"]>): string {
  const status = health.status === "ready" ? trustBadge("strong", "database connected")
    : health.status === "unsupported" ? trustBadge("no_evidence", "desktop only")
      : health.status === "error" ? trustBadge("broken", "startup failed") : trustBadge("needs_review", "initializing");
  return section("Database health", `<article class="database-health tmv-card">${status}<dl>
    <dt>SQLite storage</dt><dd>${health.realSqliteStorage ? "real local SQLite" : "not connected"}</dd>
    <dt>Migration status</dt><dd>${escapeHtml(health.migrationStatus)}</dd>
    <dt>Packaged migrations</dt><dd>${health.packagedMigrationCount}</dd>
    <dt>Applied migrations</dt><dd>${health.appliedMigrationCount}</dd>
    <dt>Database location</dt><dd><code class="tmv-code">${escapeHtml(health.databasePath ?? "unavailable")}</code></dd>
    <dt>Last initialization error</dt><dd>${escapeHtml(health.lastInitializationError ?? "none")}</dd>
    <dt>Native binding target</dt><dd>${escapeHtml(health.nativeBindingTarget ?? "unresolved")}</dd>
    <dt>Packaged native targets</dt><dd>${escapeHtml(health.packagedNativeTargets.join(", ") || "none")}</dd>
  </dl>
  <p class="tmv-callout tmv-callout--info">LLM and embedding providers, models, and API keys are configured in the Obsidian plugin <strong>Settings</strong> tab. Keys are never shown here or in generated notes.</p></article>`, "database-health-section");
}

const SUPPORTED_UPLOAD_FORMATS = ".txt, .md, .srt, .vtt";

/** Post-import guidance (informational; no new backend behavior). Collapsed so it never crowds the CTA. */
function uploadNextSteps(): string {
  return `<details class="tmv-advanced upload-next-steps"><summary>After importing — recommended next steps</summary>
    <ol class="upload-next-list">
      <li>Import stores the immutable raw transcript in local SQLite (the source of truth).</li>
      <li>Run <strong>AI extraction</strong> if the transcript was imported before an LLM was configured (command: "Run AI extraction", or open the transcript).</li>
      <li>Rebuild the <strong>embedding index</strong> after changing embedding settings (command: "Rebuild Embedding Index").</li>
      <li>Sync <strong>generated graph notes</strong> for Obsidian's native graph (the "Native Obsidian graph" card below, or command: "Sync generated graph notes").</li>
      <li>Chat in <strong>Claude Desktop</strong> (via MCP) — the recommended Ask AI experience.</li>
    </ol></details>`;
}

/**
 * The obvious, primary upload surface — a drop-zone form reused by the dashboard and the /upload route.
 * Uses the EXISTING `data-action="upload"` form + hidden filename/rawText fields, so upload/ingest backend
 * behavior is unchanged. The native file input is visually hidden (but keyboard-focusable) inside the
 * styled "Choose transcript" label; `data-dropzone` adds the drag visual + drop-to-fill in app.ts. Layout:
 * short description → drop-zone → filename status → submit (secondary) → collapsed next steps.
 */
function uploadCard(): string {
  // Compact, product-like: a Choose button + inline filename status on one row, quiet formats helper text,
  // a secondary Upload submit, and a subtle "drag a file here" hint. Drag/drop is an enhancement — the whole
  // form is the drop target (`data-dropzone`), styled only on drag (no permanent dashed box). The native
  // file input is visually hidden inside the styled label but stays keyboard-focusable and `required`.
  return `<p class="upload-desc">Import an immutable transcript source into the evidence vault.</p>
    <form data-action="upload" class="upload-form" data-dropzone>
      <div class="upload-row">
        <label class="upload-choose tmv-btn tmv-btn-primary">Choose transcript<input class="upload-file-input" name="file" type="file" accept=".txt,.md,.srt,.vtt" required></label>
        <span class="upload-file-status" data-file-status>No file selected</span>
      </div>
      <p class="upload-formats">Supports ${SUPPORTED_UPLOAD_FORMATS}</p>
      <input name="filename" type="hidden"><textarea name="rawText" hidden></textarea>
      <div class="upload-actions"><button type="submit" class="tmv-btn tmv-btn-secondary upload-submit">Upload transcript</button><span class="upload-drop-hint">or drag a file here</span></div>
    </form>
    <p data-loading-message hidden>Importing immutable transcript source…</p><div data-form-result></div>
    ${uploadNextSteps()}`;
}

/** Non-secret Claude Desktop MCP config snippet. NEVER contains an API key (the key stays in data.json). */
function mcpConfigSnippet(dbPath?: string): string {
  return `{
  "mcpServers": {
    "transcript-memory-vault": {
      "command": "node",
      "args": ["<path-to-plugin-checkout>/dist/mcp/server.cjs"],
      "env": {
        "TMV_DB_PATH": "${dbPath ?? "<path-to>/transcript-memory.sqlite"}"
      }
    }
  }
}`;
}

/**
 * The Claude/MCP setup-status card. Renders ONLY the non-secret `SetupSummary` (key PRESENCE + provider/
 * model/dimensions/paths) — never an API key value. Falls back to a minimal message when the summary is
 * not wired (headless/dev). Copy buttons carry only non-secret paths/snippets.
 */
function setupCard(setup: SetupSummary | null, fallbackDbPath?: string): string {
  const dbPath = setup?.databasePath ?? fallbackDbPath;
  const snippet = mcpConfigSnippet(dbPath);

  // Default view: one-line explanation, a compact status row, and a quiet metadata line — no paths, no JSON.
  const embeddingLabel = !setup
    ? ""
    : setup.embeddingHealth === "ok" ? "Embeddings OK"
      : setup.embeddingHealth === "reindex_required" ? "Reindex needed"
        : "Embeddings not set up";
  const statusRow = setup
    ? `<div class="setup-status">
        ${statusChip(setup.llmConfigured ? "ok" : "warn", setup.llmConfigured ? "LLM ready" : "LLM not configured")}
        ${statusChip(setup.embeddingHealth === "ok" ? "ok" : "warn", embeddingLabel)}
        ${statusChip(setup.reindexNeeded ? "warn" : "ok", setup.reindexNeeded ? "Reindex needed" : "Reindex not needed")}
      </div>`
    : `<p class="setup-meta">Detailed setup status appears inside the Obsidian plugin.</p>`;
  const metaBits = setup
    ? [
        setup.llmProvider ? `${setup.llmProvider}${setup.llmModel ? ` / ${setup.llmModel}` : ""}` : "",
        setup.embeddingProvider ? `${setup.embeddingProvider}${setup.embeddingModel ? ` / ${setup.embeddingModel}` : ""}${setup.embeddingDimensions ? ` / ${setup.embeddingDimensions}d` : ""}` : "",
      ].filter(Boolean)
    : [];
  const metaLine = metaBits.length ? `<p class="setup-meta">${metaBits.map(escapeHtml).join(" · ")}</p>` : "";

  // Progressive disclosure: full DB path, data.json path, and the FULL MCP JSON config live ONLY here,
  // inside a collapsed <details> — never in the default dashboard view. No API keys anywhere.
  const setupDetails = `<details class="tmv-advanced setup-details"><summary>Setup details</summary>
      ${dbPath
        ? `<p class="setup-detail-label">Database — <code>TMV_DB_PATH</code></p><p class="mcp-db-path"><code class="tmv-code">${escapeHtml(dbPath)}</code></p>`
        : `<p class="setup-meta"><code>TMV_DB_PATH</code> will appear once the database has initialized.</p>`}
      ${setup?.settingsPath ? `<p class="setup-detail-label">Settings file — data.json</p><p><code class="tmv-code">${escapeHtml(setup.settingsPath)}</code></p>` : ""}
      <p class="setup-detail-label">Claude Desktop MCP config <span class="setup-meta">(no API keys — the key stays in data.json)</span></p>
      <pre class="tmv-code mcp-config-snippet">${escapeHtml(snippet)}</pre>
      <div class="setup-detail-actions">${dbPath ? `<button type="button" class="tmv-btn tmv-btn-secondary" data-copy="${escapeHtml(snippet)}">Copy MCP config</button>` : ""}</div>
      <p class="setup-meta">See <code>docs/MCP.md</code> for the full setup. API keys are configured in the Obsidian Settings tab and never shown here.</p>
    </details>`;

  return `<p class="setup-intro">Use Claude Desktop for normal chat. This plugin stores, indexes, reviews, and visualizes the evidence vault.</p>
    ${statusRow}
    ${metaLine}
    <div class="setup-actions">
      ${dbPath ? `<button type="button" class="tmv-btn tmv-btn-secondary" data-copy="${escapeHtml(dbPath)}">Copy DB path</button>` : ""}
    </div>
    ${setupDetails}`;
}

export async function renderPage(context: PageContext): Promise<RenderedPage> {
  const { api, route } = context;
  switch (route.id) {
    case "dashboard": {
      const view = await api.getDashboard();
      // Compact ready line — no full DB path on the first screen (it lives in the setup card's details).
      const readyStatus = view.health?.status === "ready"
        ? `<aside class="status-banner tmv-callout tmv-callout--success">${statusChip("ok", "Vault ready")} <strong>Transcript Memory Vault is ready.</strong> ${view.health.firstRun ? "Upload a transcript to begin. " : ""}Imported raw transcript snapshots are immutable; SQLite is the source of truth.</aside>` : "";
      const startupProblem = view.health && view.health.status !== "ready"
        ? `<aside class="trust-warning">${view.health.status === "unsupported" ? trustBadge("no_evidence", "desktop only") : trustBadge("broken", "startup unavailable")} ${escapeHtml(view.health.lastInitializationError ?? "Database initialization has not completed.")}</aside>` : "";
      const llmBanner = view.llmRequired && view.llmReady === false
        ? `<aside class="trust-warning llm-setup-required">${trustBadge("no_evidence", "LLM required")} AI is not configured. Ask AI needs an external LLM (grounded extraction + answer synthesis) AND an external embedding provider (retrieval) — open plugin Settings and configure both. Transcripts still import; run the "Run AI extraction" command afterward. (Embedding status is shown in the setup card below.)</aside>`
        : "";
      const sync = view.generatedSync;
      const syncStatusLine = !sync
        ? "Generated graph notes status is unavailable in this context."
        : !sync.synced
          ? "Never synced — Obsidian's native graph has no generated notes yet. Sync after importing transcripts, running AI extraction, or asking AI."
          : `Last synced ${escapeHtml(sync.lastSyncedAt ?? "unknown")} · ${sync.fileCount ?? 0} files · ${sync.graphNodeCount ?? 0} nodes · ${sync.graphEdgeCount ?? 0} edges.`;
      const syncWarn = sync?.status === "failed"
        ? `<aside class="trust-warning">${trustBadge("broken", "last sync had errors")} ${escapeHtml(sync.error ?? "Some generated files could not be written.")}</aside>` : "";

      const dbPath = view.health?.databasePath ?? undefined;
      const setup = (await api.getSetupSummary?.()) ?? null;

      // 1. Upload — the most obvious, primary first action.
      const uploadSection = section("Upload a transcript", uploadCard(), "upload-section tmv-card--primary");

      // 2. Claude Desktop / MCP setup + status (non-secret setup summary).
      const setupSection = section("Use Claude Desktop with this vault", setupCard(setup, dbPath), "mcp-card tmv-card");

      // 3. One calm "Review & attention" card: light status chips summarise counts, then the top items.
      const attention = view.attention ?? [];
      const reviewMetrics = `<div class="review-metrics">
          ${statusChip(view.reviewCount ? "warn" : "ok", `${view.reviewCount} to review`)}
          ${view.conflictCount ? statusChip("warn", `${view.conflictCount} conflicts`) : ""}
          ${view.brokenCount ? statusChip("error", `${view.brokenCount} broken pointers`) : ""}
          ${statusChip("ok", `${view.totalTranscriptCount} transcripts`)}
        </div>`;
      const attentionList = attention.length
        ? `<ul class="attention-list">${attention.map((item) => `<li class="attention-item">${trustBadge(item.trustState)} <a href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a> <small>${escapeHtml(item.detail)}</small></li>`).join("")}</ul>`
        : `<p class="setup-meta">Nothing needs attention right now.</p>`;
      const reviewSection = section("Review and attention", `${reviewMetrics}${attentionList}${links([{ href: routeHref.reviewQueue(), label: "Open review queue" }])}`, "review-summary-section attention-section");

      // 4. Graph / evidence viewer (generated notes + a link to the live plugin graph).
      const graphSection = section("Native Obsidian graph", `<p>These generated Markdown notes power Obsidian's <strong>native (ribbon) graph</strong>. The plugin's own Graph page reads SQLite live; the native graph only sees Markdown files and wiki links, so it needs these notes. SQLite stays the source of truth — editing a generated note never changes memory.</p>
        <p class="generated-sync-status">${syncStatusLine}</p>${syncWarn}
        <form data-action="sync-graph"><button type="submit" class="tmv-btn tmv-btn-secondary">Sync Obsidian graph notes</button></form>
        <p data-loading-message hidden>Generating Markdown graph notes…</p><div data-form-result></div>
        ${links([{ href: routeHref.graph(), label: "Open graph & evidence viewer" }])}`, "generated-notes-section");

      // 5. Recent transcripts (links to the full Transcripts route).
      const transcriptsSection = section("Transcripts", `${view.transcripts.map((item) => `<article><a href="${escapeHtml(routeHref.transcript(item.id))}">${escapeHtml(item.title)}</a> · ${item.spanCount} spans</article>`).join("") || emptyState("No transcripts", "Upload a transcript to begin.", { href: routeHref.upload(), label: "Upload transcript" })}
        ${links([{ href: routeHref.transcripts(), label: "All transcripts" }, { href: routeHref.upload(), label: "Upload transcript" }])}`, "transcripts-section");

      // 6. Recent answers/evidence.
      const recentAnswers = section("Recent answers", view.recentAnswers.map((item) => `<article>${trustBadge(item.confidence)} <a href="${escapeHtml(routeHref.answer(item.id))}">${escapeHtml(item.question)}</a></article>`).join("")
        || emptyState("No answers yet", "Ask in Claude Desktop for chat. Answers run there — or via Internal Ask AI under Advanced tools — appear here."), "recent-answers-section");

      // 7. Advanced / internal tools — collapsed, low prominence.
      const advancedSection = section("Advanced / Internal tools", `<details class="tmv-advanced advanced-tools"><summary>Show advanced / internal tools</summary>
        <p>Debugging and inspection tools. For normal chat, use Claude Desktop.</p>
        ${links([{ href: routeHref.search(), label: "Search vault" }, { href: routeHref.ask(), label: "Internal Ask AI" }])}
        ${view.health ? healthView(view.health) : ""}
      </details>`, "advanced-tools-section");

      const body = `${readyStatus}${startupProblem}${llmBanner}
        ${uploadSection}
        ${setupSection}
        ${reviewSection}
        ${graphSection}
        ${transcriptsSection}
        ${recentAnswers}
        ${advancedSection}`;
      return { title: "Dashboard", html: appShell("Dashboard", body) };
    }
    case "upload":
      return { title: "Upload transcript", html: appShell("Upload transcript", `<aside class="immutable-notice">Uploads become immutable raw transcript sources. Re-uploading identical content reuses the existing transcript.</aside>
        ${section("Upload a transcript", uploadCard(), "upload-section tmv-card--primary")}`) };
    case "transcripts": {
      // Viewer-mode Transcripts list: a read-only projection of listTranscripts(). No new backend behavior;
      // each item links to the existing immutable transcript detail route.
      const transcripts = await api.listTranscripts();
      const list = transcripts.map((item) => `<article class="transcript-list-item">
        <h3><a href="${escapeHtml(routeHref.transcript(item.id))}">${escapeHtml(item.title)}</a></h3>
        <p>${trustBadge(item.processingStatus === "ready" ? "strong" : item.processingStatus === "failed" ? "broken" : "needs_review", item.processingStatus)} ${item.spanCount} spans · ${item.speakerCount} speaker(s) · ${escapeHtml(item.sourceType)} · imported ${escapeHtml(item.importedAt)}</p>
      </article>`).join("");
      const body = `<aside class="immutable-notice">Imported raw transcript sources are immutable. This is a read-only list; open one to view its spans or delete it.</aside>
        ${transcripts.length
          ? section(`${transcripts.length} transcript(s)`, list)
          : emptyState("No transcripts yet", "Upload a transcript to begin building the evidence vault.", { href: routeHref.upload(), label: "Upload transcript" })}
        ${links([{ href: routeHref.upload(), label: "Upload transcript" }])}`;
      return { title: "Transcripts", html: appShell("Transcripts", body) };
    }
    case "transcript": {
      const view = await api.getTranscript(route.params.id);
      if (!view) return { title: "Transcript not found", html: appShell("Transcript not found", emptyState("Transcript not found", "The requested immutable source is unavailable.")) };
      // Danger zone: deleting a whole transcript is allowed (raw text stays immutable — there is no edit path).
      // Tucked in a <details> with a required confirmation so it cannot be clicked by accident.
      const dangerZone = `${section("Danger zone", `<details class="danger-zone"><summary>Delete this transcript</summary>
        <aside class="trust-warning">${trustBadge("broken", "irreversible")} This will permanently delete this transcript and remove or invalidate generated evidence, memories, answers, conflicts, and graph notes that depend on it. Transcript text cannot be edited. If the transcript is wrong, delete it and re-import the corrected file. This action cannot be undone.</aside>
        <form data-action="delete-transcript"><input type="hidden" name="transcriptId" value="${escapeHtml(view.id)}">
        <label><input type="checkbox" name="confirm" required> I understand this permanently deletes the transcript and its dependent data, and cannot be undone.</label>
        <button type="submit">Delete transcript</button></form>
        <p data-loading-message hidden>Deleting transcript and dependent data…</p><div data-form-result></div></details>`, "danger-zone-section")}`;
      return { title: view.title, html: appShell(view.title, `${transcriptView(view, route.query.get("span") ?? undefined)}${dangerZone}`) };
    }
    case "ask": {
      const llm = await api.getLlmStatus();
      // Viewer-mode: Ask AI is DEMOTED to an internal/debug tool (reached via Advanced), but stays fully
      // functional. Claude Desktop (MCP) is the recommended chat UI. This is the SAME evidence-grounded,
      // LLM-required pipeline — not a legacy or local mode.
      const internalDebugCallout = `<aside class="trust-warning ask-internal-callout">Internal Ask AI — for debugging. Use Claude Desktop for normal chat.</aside>`;
      const claudeDesktopBanner = `${internalDebugCallout}<aside class="immutable-notice claude-desktop-banner">Claude Desktop (via MCP) is the recommended chat UI; this page runs the same evidence-grounded, LLM-required pipeline.</aside>`;
      if (llm.required && !llm.ready) {
        return { title: "Ask AI", html: appShell("Ask AI", `${claudeDesktopBanner}<section class="trust-warning ask-setup-required">${trustBadge("no_evidence", "LLM required")}<h2>Set up an LLM to use Ask AI</h2>
          <p>Ask AI answers only from your transcripts, with citations — but it needs a configured external LLM to generate the answer. Add a provider, model, and API key in the plugin Settings.</p>
          ${links([{ href: routeHref.dashboard(), label: "Open dashboard" }])}</section>`) };
      }
      // Production embedding gate: block factual answers until an API embedding provider is configured and the
      // index matches it (token-hash-v1 is dev/test only, never a production retrieval path).
      const embedding = (await api.getEmbeddingStatus?.()) ?? { required: false, state: "ok" as const };
      if (embedding.required && embedding.state !== "ok") {
        const setup = embedding.state === "setup_required";
        return { title: "Ask AI", html: appShell("Ask AI", `${claudeDesktopBanner}<section class="trust-warning ask-setup-required">${trustBadge("no_evidence", setup ? "Embeddings required" : "Reindex required")}<h2>${setup ? "Set up an API embedding provider to use Ask AI" : "Rebuild the embedding index to use Ask AI"}</h2>
          <p>${setup
            ? "Ask AI uses semantic retrieval over your transcripts and needs a configured API embedding provider (provider, model, dimensions, API key) in Settings. token-hash-v1 is a dev/test seam, not a production retrieval path."
            : "The embedding index was built with a different or stale provider (e.g. after changing embedding settings). Run the \"Rebuild embedding index\" command before Ask AI can answer."}${embedding.reason ? ` ${escapeHtml(embedding.reason)}` : ""}</p>
          ${links([{ href: routeHref.dashboard(), label: "Open dashboard" }])}</section>`) };
      }
      const transcripts = (await api.listTranscripts()).slice(0, 100);
      return { title: "Ask AI", html: appShell("Ask AI", `${claudeDesktopBanner}<aside class="immutable-notice">Ask AI retrieves and scores evidence before answering. Weak or conflicting evidence remains visibly labeled.</aside>
        <form data-action="ask"><label>Question <textarea name="question" required></textarea></label>
        <label>Optional transcript filter <select name="transcriptIds" multiple>${transcripts.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join("")}</select></label>
        <button type="submit">Retrieve, score, and answer</button></form>
        <p data-loading-message hidden>Retrieving and scoring evidence before answer synthesis...</p><div data-form-result></div>`) };
    }
    case "answer": {
      const answer = await api.getAnswer(route.params.id);
      return { title: answer?.question ?? "Answer not found", html: appShell(answer?.question ?? "Answer not found", answer ? answerView(answer) : emptyState("Answer not found", "The requested Ask AI run is unavailable.")) };
    }
    case "answer_trace": {
      const trace = await api.getAskAITrace(route.params.id);
      return {
        title: trace ? "Ask AI trace" : "Trace not found",
        html: appShell(trace ? "Ask AI trace" : "Trace not found",
          trace ? traceView(trace) : emptyState("Trace not found", "No Ask AI run or answer with this id exists.", { href: routeHref.dashboard(), label: "Open dashboard" })),
      };
    }
    case "evidence": {
      const evidence = await api.getEvidence(route.params.id);
      // A clear, honest header: broken pointers warn; healthy ones are labelled transcript-backed so the
      // reader knows this traces to an immutable source span. Trust state/score are unchanged.
      const statusCallout = evidence.brokenReason
        ? `<aside class="trust-warning tmv-callout tmv-callout--warning">${trustBadge("broken")} This pointer cannot be trusted until repaired: ${escapeHtml(evidence.brokenReason)}</aside>`
        : `<aside class="immutable-notice tmv-callout tmv-callout--success">${trustBadge(evidence.strength)} Transcript-backed evidence — it resolves to an immutable source span (open it below). Score ${score(evidence.finalScore ?? evidence.confidence)}.</aside>`;
      const body = `${statusCallout}
        ${evidenceCard(evidence)}${section("Resolved transcript span", evidence.brokenReason ? emptyState("Resolution failed", evidence.brokenReason) : `<blockquote>${escapeHtml(evidence.spanText)}</blockquote><a href="${escapeHtml(routeHref.transcript(evidence.transcriptId, evidence.spanId))}">Open highlighted source span</a>`)}
        ${section("Submit a correction", correctionForm("evidence", evidence.id))}`;
      return { title: `Evidence ${evidence.id}`, html: appShell(`Evidence ${evidence.id}`, body) };
    }
    case "memory": {
      const view = await api.getMemory(route.params.id);
      return { title: view?.memory.title || "Memory object", html: appShell(view?.memory.title || "Memory object", view ? memoryView(view) : emptyState("Memory not found", "The requested canonical memory object is unavailable.")) };
    }
    case "graph": {
      const { graph, warnings } = await api.getGraph();
      const query = (route.query.get("q") ?? "").toLowerCase(), type = route.query.get("type") ?? "all";
      const limit = Math.min(Math.max(Number(route.query.get("limit") ?? 100) || 100, 1), 100);
      const visibleNodes = graph.nodes.filter((node) => (!query || node.label.toLowerCase().includes(query)) && (type === "all" || node.type === type)).slice(0, limit);
      const ids = new Set(visibleNodes.map((node) => node.id));
      const visibleEdges = graph.edges.filter((edge) => ids.has(edge.source) || ids.has(edge.target)).slice(0, limit);
      const nodes = visibleNodes.map((node) => `<li tabindex="0"><a href="${routeHref.graph(`?selectedNode=${encodeURIComponent(node.id)}`)}"><strong>${escapeHtml(node.label)}</strong></a> <small>${escapeHtml(node.type)}</small> ${node.supportStatus ? `<span class="support-status">${escapeHtml(node.supportStatus)}</span>` : ""}</li>`).join("");
      const edges = visibleEdges.map((edge) => `<li tabindex="0">${edge.type === "contradicts" || edge.type === "updates" ? trustBadge("conflicting", edge.type) : ""} <a href="${routeHref.graph(`?selectedEdge=${encodeURIComponent(edge.id)}`)}">${escapeHtml(edge.source)} → ${escapeHtml(edge.target)} <strong>${escapeHtml(edge.type)}</strong></a> ${edge.evidencePointerId ? `<a href="${escapeHtml(routeHref.evidence(edge.evidencePointerId))}">evidence</a>` : `<span>${trustBadge("needs_review", "inferred / no evidence link")}</span>`}</li>`).join("");
      const selectedNode = graph.nodes.find((node) => node.id === route.query.get("selectedNode"));
      const selectedEdge = graph.edges.find((edge) => edge.id === route.query.get("selectedEdge"));
      const details = selectedNode
        ? section("Selected node", `<article><h3>${escapeHtml(selectedNode.label)}</h3><p>${escapeHtml(selectedNode.type)} · ${escapeHtml(selectedNode.supportStatus ?? "no status")} · confidence ${score(selectedNode.confidence)}</p><p>${graph.edges.filter((edge) => (edge.source === selectedNode.id || edge.target === selectedNode.id) && edge.evidencePointerId).length} evidence-linked edge(s)</p>${graphNodeLink(selectedNode.id) ? `<a href="${escapeHtml(graphNodeLink(selectedNode.id)!)}">Open related item</a>` : ""}</article>`)
        : selectedEdge
          ? section("Selected edge", `<article>${selectedEdge.type === "contradicts" || selectedEdge.type === "updates" ? trustBadge("conflicting", selectedEdge.type) : ""}<p>${escapeHtml(selectedEdge.source)} → ${escapeHtml(selectedEdge.target)}</p><p>${escapeHtml(selectedEdge.type)} · confidence ${score(selectedEdge.confidence)} · ${selectedEdge.evidencePointerId ? "1 evidence link" : "0 evidence links"}</p>${selectedEdge.evidencePointerId ? `<a href="${escapeHtml(routeHref.evidence(selectedEdge.evidencePointerId))}">Open linked evidence</a>` : ""}</article>`)
          : "";
      const legend = `<aside class="tmv-callout tmv-callout--info graph-legend"><strong>What this shows.</strong> Nodes are memory objects, transcripts, and evidence pointers. Edges are relationships — <em>supports</em>, <em>contradicts</em>, <em>updates</em>. An edge tagged "inferred / no evidence link" has no backing evidence pointer, so it is not part of the clean provenance chain. This page reads SQLite live (the source of truth); Obsidian's native Markdown graph is a separate, disposable view.</aside>`;
      const warningsCallout = warnings.length ? `<aside class="trust-warning tmv-callout tmv-callout--warning">${warnings.map(escapeHtml).join("<br>")}</aside>` : "";
      const filterForm = `<form data-action="filter" data-view="graph"><label>Filter graph <input name="q" value="${escapeHtml(query)}"></label><label>Node type <input name="type" value="${escapeHtml(type)}"></label><label>Limit (max 100) <input name="limit" type="number" min="1" max="100" value="${limit}"></label><button type="submit" class="tmv-btn tmv-btn-secondary">Apply</button></form>`;
      const listings = graph.nodes.length
        ? `<p>Showing ${visibleNodes.length} of ${graph.nodes.length} nodes and ${visibleEdges.length} edges.</p>${details}${section("Nodes", `<ul>${nodes}</ul>`)}${section("Edges", `<ul>${edges}</ul>`)}`
        : emptyState("Graph is empty", "No memory, transcript, or evidence nodes yet. Import a transcript and run AI extraction to populate the provenance graph.");
      return { title: "Graph", html: appShell("Graph", `${legend}${filterForm}${warningsCallout}${listings}`) };
    }
    case "search": {
      const query = route.query.get("q") ?? "";
      const results = await api.search(query);
      const filter = route.query.get("type") ?? "all", strength = route.query.get("strength") ?? "all";
      const filtered = results.filter((item) =>
        (filter === "all" || filter === "evidence" && item.type === "evidence" || item.type === filter || filter === "memory" && item.type === "memory_object" || filter === "answers" && item.type === "answer" || filter === "transcripts" && (item.type === "transcript" || item.type === "span"))
        && (strength === "all" || item.trustState === strength));
      const groups = [...new Set(filtered.map((item) => item.type))].map((group) => section(group.replaceAll("_", " "), filtered.filter((item) => item.type === group).map(searchCard).join(""))).join("");
      return { title: "Search", html: appShell("Search", `<aside class="immutable-notice">Search finds candidate evidence; evidence scores decide how much to trust it.</aside><form data-action="filter" data-view="search"><label>Search transcripts, spans, memory, answers, and evidence <input name="q" value="${escapeHtml(query)}"></label><label>Type <select name="type"><option>${escapeHtml(filter)}</option><option>all</option><option>transcripts</option><option>memory</option><option>answers</option><option>evidence</option></select></label><label>Evidence strength <select name="strength"><option>${escapeHtml(strength)}</option><option>all</option><option>strong</option><option>mixed</option><option>weak</option><option>conflicting</option><option>broken</option></select></label><button type="submit">Search</button></form>
        ${query ? section(`${filtered.length} results`, groups || emptyState("No results", "No source-backed content matched.")) : emptyState("Search the vault", "Enter a phrase to search structured SQLite content.")}`) };
    }
    case "review": {
      const items = await api.listReviewItems(), type = route.query.get("type") ?? "all", status = route.query.get("status") ?? "open";
      const filtered = items.filter((item) => (type === "all" || item.type === type) && (status === "all" || item.status === status));
      const intro = `<aside class="immutable-notice tmv-callout tmv-callout--info">Approving promotes a memory to active, citable evidence; Reject / Dismiss removes it from Ask AI and search. Both are append-only and never edit raw transcript text. Items with no live evidence cannot be approved — only dismissed.</aside>`;
      const filterForm = `<form data-action="filter" data-view="review"><label>Item type <input name="type" value="${escapeHtml(type)}"></label><label>Status <select name="status"><option>${escapeHtml(status)}</option><option>open</option><option>resolved</option><option>dismissed</option><option>all</option></select></label><button type="submit" class="tmv-btn tmv-btn-secondary">Filter items</button></form>`;
      // Visual grouping only — every item still comes from `filtered` and renders via the same reviewCard.
      const conflicts = filtered.filter((item) => item.type === "conflict");
      const degraded = filtered.filter((item) => item.type !== "conflict" && item.canApprove === false);
      const active = filtered.filter((item) => item.type !== "conflict" && item.canApprove !== false);
      const group = (title: string, list: ReviewItemView[], className: string) => list.length ? section(title, list.map(reviewCard).join(""), className) : "";
      const groups = `${group("Needs review", active, "review-active-group")}${group("Conflicts / tensions", conflicts, "review-conflicts-group")}${group("Degraded — evidence missing", degraded, "review-degraded-group")}`;
      const body = `${intro}${filterForm}${filtered.length ? groups : emptyState("Review queue is clear", "No weak, broken, conflicting, or review-only items were found.")}`;
      return { title: "Review queue", html: appShell("Review queue", body) };
    }
    case "review_detail": {
      const item = await api.getReviewItem(route.params.id);
      const form = item ? correctionForm(item.targetType, item.targetId) : "";
      const related = item ? `${item.relatedTranscriptIds.length ? section("Linked transcripts", item.relatedTranscriptIds.map((id) => `<a href="${escapeHtml(routeHref.transcript(id))}">${escapeHtml(id)}</a>`).join(" ")) : ""}${item.relatedEvidenceIds.length ? section("Linked evidence", item.relatedEvidenceIds.map((id) => `<a href="${escapeHtml(routeHref.evidence(id))}">${escapeHtml(id)}</a>`).join(" ")) : ""}` : "";
      return { title: item?.title ?? "Review item not found", html: appShell(item?.title ?? "Review item not found", item ? `${reviewCard(item)}${related}<aside class="immutable-notice">Resolution is read-only here. Corrections are appended as separate records; raw source text is never edited.</aside>${form}` : emptyState("Review item not found", "This item may already have been resolved.")) };
    }
    default:
      return { title: "Not found", html: appShell("Not found", emptyState("Page not found", "The requested frontend route does not exist.", { href: "/", label: "Dashboard" })) };
  }
}
