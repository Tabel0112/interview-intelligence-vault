import { appShell, emptyState, escapeHtml, routeButton, score, trustBadge } from "./html.js";
import { routeHref } from "./router.js";
import type { EvidenceView, FrontendAnswerView, MemoryView, PageContext, RenderedPage, ReviewItemView, SearchResultView, TranscriptView, TrustState } from "./types.js";

const section = (title: string, body: string, className = "") => `<section class="vault-section${className ? ` ${escapeHtml(className)}` : ""}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
const links = (items: Array<{ href: string; label: string }>) => `<div class="route-actions">${items.map((item) => routeButton(item.href, item.label)).join("")}</div>`;
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
  return `${brokenWarning}${warning}<article class="answer"><h2>Generated answer</h2><pre>${escapeHtml(answer.answerMarkdown)}</pre></article>
    ${section("Claims and citations", claims || emptyState("No supported claims", "The answer correctly refused to invent claims."))}
    ${section("Evidence", evidence || emptyState("No evidence", "No transcript-backed evidence was available."))}
    ${conflict ? section("Conflicts", conflict) : ""}${section("Submit a correction", correctionForm("answer", answer.id))}`;
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

function memoryView(view: MemoryView): string {
  const memory = view.memory;
  const warning = view.trustState === "strong" ? "" : `<aside class="trust-warning">${trustBadge(view.trustState)} This memory is not independent strong truth.</aside>`;
  // A memory in a reviewable state gets the same Approve/Reject controls here as in the review queue,
  // so following a review item to its memory page is never a dead end.
  const reviewable = memory.status === "needs_review" || memory.status === "weak";
  const reviewSection = reviewable
    ? section("Review decision", `<p>Approve to promote this memory to active, citable evidence, or Reject to remove it from Ask AI and search. Both are append-only and never edit raw transcript text.</p>${memoryReviewControls(memory.id)}`)
    : "";
  return `${warning}<article class="memory-object">
    <p>${trustBadge(view.trustState)} ${escapeHtml(memory.type)} · confidence ${score(memory.confidence)} (${escapeHtml(memory.confidenceLabel)})</p>
    <h2>${escapeHtml(memory.title || memory.type)}</h2><p>${escapeHtml(memory.body)}</p>
    <dl><dt>Canonical status</dt><dd>${escapeHtml(memory.status)}</dd><dt>Evidence spans</dt><dd>${memory.evidenceSpanIds.length}</dd><dt>User corrected</dt><dd>${memory.userCorrected ? "yes" : "no"}</dd><dt>Duplicate of</dt><dd>${escapeHtml(memory.duplicateOfId ?? "none")}</dd></dl>
  </article>${section("Evidence", view.evidence.map(evidenceCard).join("") || emptyState("No linked evidence pointers", "This memory cannot be treated as strong."))}
  ${view.conflicts.length ? section("Conflicts", view.conflicts.map((item) => `<article>${trustBadge("conflicting")} <strong>${escapeHtml(item.summary)}</strong><p>${escapeHtml(item.explanation)}</p></article>`).join("")) : ""}
  ${reviewSection}
  ${section("Submit a correction", correctionForm("memory_object", memory.id))}`;
}

// Approve/Reject operate on a memory object's review status via reviewMemoryObject. They are shown
// only when the review item is safely tied to a real memory_object id — never creating fake evidence
// or editing raw transcript text. The submit handler reads memoryId from this form.
const memoryReviewControls = (memoryId: string): string =>
  `<form data-action="review" class="review-actions"><input type="hidden" name="memoryId" value="${escapeHtml(memoryId)}">
      <button type="submit" name="decision" value="approve">Approve</button>
      <button type="submit" name="decision" value="reject">Reject</button></form><div data-form-result></div>`;

const reviewActions = (item: ReviewItemView): string => {
  // memory_needs_review is always a memory_object; weak_evidence may be attached to a memory_object.
  if (item.targetType === "memory_object" && (item.type === "memory_needs_review" || item.type === "weak_evidence")) {
    return memoryReviewControls(item.targetId);
  }
  // Weak evidence not tied to a memory object: no safe direct Approve/Reject — explain instead.
  if (item.type === "weak_evidence") {
    return `<p class="trust-warning">This weak-evidence item is attached to a ${escapeHtml(item.targetType)}, not a memory object, so it has no direct Approve/Reject. Open the linked evidence and use the append-only correction below.</p>`;
  }
  return "";
};

function reviewCard(item: ReviewItemView): string {
  return `<article class="review-card">${trustBadge(item.trustState)}<h3><a href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a></h3>
    <p>${escapeHtml(item.detail)}</p><small>${escapeHtml(item.severity)} severity · ${escapeHtml(item.status)} · ${escapeHtml(item.type)} · ${escapeHtml(item.targetType)}:${escapeHtml(item.targetId)}</small>
    <a href="${escapeHtml(routeHref.review(item.id))}">Review and correct</a>${reviewActions(item)}</article>`;
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
  return section("Database health", `<article class="database-health">${status}<dl>
    <dt>SQLite storage</dt><dd>${health.realSqliteStorage ? "real local SQLite" : "not connected"}</dd>
    <dt>Migration status</dt><dd>${escapeHtml(health.migrationStatus)}</dd>
    <dt>Packaged migrations</dt><dd>${health.packagedMigrationCount}</dd>
    <dt>Applied migrations</dt><dd>${health.appliedMigrationCount}</dd>
    <dt>Database location</dt><dd>${escapeHtml(health.databasePath ?? "unavailable")}</dd>
    <dt>Last initialization error</dt><dd>${escapeHtml(health.lastInitializationError ?? "none")}</dd>
    <dt>Native binding target</dt><dd>${escapeHtml(health.nativeBindingTarget ?? "unresolved")}</dd>
    <dt>Packaged native targets</dt><dd>${escapeHtml(health.packagedNativeTargets.join(", ") || "none")}</dd>
  </dl></article>`, "database-health-section");
}

export async function renderPage(context: PageContext): Promise<RenderedPage> {
  const { api, route } = context;
  switch (route.id) {
    case "dashboard": {
      const view = await api.getDashboard();
      const readyStatus = view.health?.status === "ready"
        ? `<aside class="immutable-notice status-banner"><strong>Transcript Memory Vault is ready.</strong> ${view.health.firstRun ? "Upload a transcript to begin. " : ""}Imported raw transcript snapshots are immutable and stored in local SQLite at ${escapeHtml(view.health.databasePath)}.</aside>` : "";
      const startupProblem = view.health && view.health.status !== "ready"
        ? `<aside class="trust-warning">${view.health.status === "unsupported" ? trustBadge("no_evidence", "desktop only") : trustBadge("broken", "startup unavailable")} ${escapeHtml(view.health.lastInitializationError ?? "Database initialization has not completed.")}</aside>` : "";
      const llmBanner = view.llmRequired && view.llmReady === false
        ? `<aside class="trust-warning llm-setup-required">${trustBadge("no_evidence", "LLM required")} AI is not configured. Ask AI and AI memory extraction need an external LLM — open plugin Settings and add a provider, model, and API key. Transcripts still import; run the "Run AI extraction" command afterward.</aside>`
        : "";
      const sync = view.generatedSync;
      const syncStatusLine = !sync
        ? "Generated graph notes status is unavailable in this context."
        : !sync.synced
          ? "Never synced — Obsidian's native graph has no generated notes yet. Sync after importing transcripts, running AI extraction, or asking AI."
          : `Last synced ${escapeHtml(sync.lastSyncedAt ?? "unknown")} · ${sync.fileCount ?? 0} files · ${sync.graphNodeCount ?? 0} nodes · ${sync.graphEdgeCount ?? 0} edges.`;
      const syncWarn = sync?.status === "failed"
        ? `<aside class="trust-warning">${trustBadge("broken", "last sync had errors")} ${escapeHtml(sync.error ?? "Some generated files could not be written.")}</aside>` : "";
      // Native Obsidian graph (the disposable-Markdown sync card — elevated as a first-class viewer surface).
      const generatedNotesSection = section("Native Obsidian graph", `<p>These generated Markdown notes power Obsidian's <strong>native (ribbon) graph</strong>. The plugin's own Graph page reads SQLite live; the native graph only sees Markdown files and wiki links, so it needs these notes. SQLite stays the source of truth — editing a generated note never changes memory.</p>
        <p class="generated-sync-status">${syncStatusLine}</p>${syncWarn}
        <form data-action="sync-graph"><button type="submit">Sync Obsidian graph notes</button></form>
        <p data-loading-message hidden>Generating Markdown graph notes…</p><div data-form-result></div>`, "generated-notes-section");

      const vaultStatus = section("Vault status", `<p><strong>SQLite is the source of truth.</strong> Imported raw transcript snapshots are immutable; generated Markdown is a disposable view layer for Obsidian's native graph.</p>
        <div class="metric-grid"><span>${view.totalTranscriptCount} transcripts</span>${routeButton(routeHref.reviewQueue(), `${view.reviewCount} review items`, "route-action metric-action")}<span>${view.weakCount} weak/review</span><span>${view.conflictCount} conflicts</span><span>${view.brokenCount} broken pointers</span></div>
        ${view.health ? healthView(view.health) : ""}`, "vault-status-section");

      const dbPath = view.health?.databasePath;
      const mcpCard = section("Use Claude Desktop (MCP)", `<p><strong>Claude Desktop is the recommended chat UI.</strong> It connects to this vault through a local MCP server and answers from the same evidence-first pipeline. This plugin is your evidence viewer, graph browser, transcript/memory navigator, and review/control panel.</p>
        ${dbPath ? `<p>Point Claude Desktop's <code>TMV_DB_PATH</code> at this vault's database:</p><p class="mcp-db-path"><code>${escapeHtml(dbPath)}</code></p>` : `<p><code>TMV_DB_PATH</code> will appear here once the plugin has initialized its database.</p>`}
        <p>See <code>docs/MCP.md</code> for the full Claude Desktop / MCP setup. (Opening Claude Desktop is a manual step — there is no in-app launcher.)</p>`, "mcp-card");

      const attention = view.attention ?? [];
      const attentionSection = section("Evidence needing attention", attention.length
        ? attention.map((item) => `<article class="attention-item">${trustBadge(item.trustState)} <a href="${escapeHtml(item.href)}">${escapeHtml(item.title)}</a> <small>${escapeHtml(item.detail)}</small></article>`).join("")
        : emptyState("Nothing needs attention", "No weak, broken, or conflicting evidence right now."), "attention-section");

      const recentAnswers = section("Recent answers", view.recentAnswers.map((item) => `<article>${trustBadge(item.confidence)} <a href="${escapeHtml(routeHref.answer(item.id))}">${escapeHtml(item.question)}</a></article>`).join("")
        || emptyState("No answers yet", "Ask in Claude Desktop, or use the Ask AI page under Advanced.", { href: routeHref.ask(), label: "Ask AI" }), "recent-answers-section");

      const reviewSection = section("Review queue / conflicts", `<p>${view.reviewCount} open review item(s)${view.conflictCount ? `, including ${view.conflictCount} conflict(s)` : ""}.</p>${links([{ href: routeHref.reviewQueue(), label: "Open review queue" }])}`, "review-summary-section");

      const transcriptsSection = section("Transcripts", `${view.transcripts.map((item) => `<article><a href="${escapeHtml(routeHref.transcript(item.id))}">${escapeHtml(item.title)}</a> · ${item.spanCount} spans</article>`).join("") || emptyState("No transcripts", "Import a transcript to begin.")}
        ${links([{ href: routeHref.upload(), label: "Upload transcript" }])}`, "transcripts-section");

      const searchSection = section("Search vault", `<p>Find transcripts, spans, memory objects, answers, and evidence.</p>${links([{ href: routeHref.search(), label: "Search vault" }])}`, "search-section");

      const body = `${readyStatus}${startupProblem}${llmBanner}
        ${vaultStatus}
        ${mcpCard}
        ${attentionSection}
        ${recentAnswers}
        ${reviewSection}
        ${generatedNotesSection}
        ${transcriptsSection}
        ${searchSection}`;
      return { title: "Dashboard", html: appShell("Dashboard", body) };
    }
    case "upload":
      return { title: "Upload transcript", html: appShell("Upload transcript", `<aside class="immutable-notice">Uploads become immutable raw transcript sources. Re-uploading identical content reuses the existing transcript.</aside>
        <form data-action="upload"><label>Transcript file (.txt, .md, .srt, .vtt) <input name="file" type="file" accept=".txt,.md,.srt,.vtt" required></label>
        <p data-file-status>No file selected.</p><input name="filename" type="hidden"><textarea name="rawText" hidden></textarea>
        <button type="submit">Import transcript</button></form><p data-loading-message hidden>Importing immutable transcript source...</p><div data-form-result></div>`) };
    case "transcript": {
      const view = await api.getTranscript(route.params.id);
      return { title: view?.title ?? "Transcript not found", html: appShell(view?.title ?? "Transcript not found", view ? transcriptView(view, route.query.get("span") ?? undefined) : emptyState("Transcript not found", "The requested immutable source is unavailable.")) };
    }
    case "ask": {
      const llm = await api.getLlmStatus();
      // Viewer-mode: Ask AI stays fully functional, but Claude Desktop (MCP) is the recommended chat UI.
      // This is the SAME evidence-grounded, LLM-required pipeline — not a legacy or local mode.
      const claudeDesktopBanner = `<aside class="immutable-notice claude-desktop-banner">Claude Desktop (via MCP) is the recommended chat UI; this page runs the same evidence-grounded, LLM-required pipeline.</aside>`;
      if (llm.required && !llm.ready) {
        return { title: "Ask AI", html: appShell("Ask AI", `${claudeDesktopBanner}<section class="trust-warning ask-setup-required">${trustBadge("no_evidence", "LLM required")}<h2>Set up an LLM to use Ask AI</h2>
          <p>Ask AI answers only from your transcripts, with citations — but it needs a configured external LLM to generate the answer. Add a provider, model, and API key in the plugin Settings.</p>
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
    case "evidence": {
      const evidence = await api.getEvidence(route.params.id);
      const body = `${evidence.brokenReason ? `<aside class="trust-warning">${trustBadge("broken")} This pointer cannot be trusted until repaired.</aside>` : ""}
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
      return { title: "Graph", html: appShell("Graph", `<form data-action="filter" data-view="graph"><label>Filter graph <input name="q" value="${escapeHtml(query)}"></label><label>Node type <input name="type" value="${escapeHtml(type)}"></label><label>Limit (max 100) <input name="limit" type="number" min="1" max="100" value="${limit}"></label><button type="submit">Apply</button></form>
        <p>Showing ${visibleNodes.length} of ${graph.nodes.length} nodes and ${visibleEdges.length} edges.</p>${warnings.length ? `<aside class="trust-warning">${warnings.map(escapeHtml).join("<br>")}</aside>` : ""}${details}${section("Nodes", `<ul>${nodes}</ul>`)}${section("Edges", `<ul>${edges}</ul>`)}`) };
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
      return { title: "Review queue", html: appShell("Review queue", `<form data-action="filter" data-view="review"><label>Item type <input name="type" value="${escapeHtml(type)}"></label><label>Status <select name="status"><option>${escapeHtml(status)}</option><option>open</option><option>resolved</option><option>dismissed</option><option>all</option></select></label><button type="submit">Filter items</button></form>${filtered.map(reviewCard).join("") || emptyState("Review queue is clear", "No weak, broken, conflicting, or review-only items were found.")}`) };
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
