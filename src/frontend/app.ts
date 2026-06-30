import { escapeHtml } from "./html.js";
import { appShell } from "./html.js";
import { navigateInternal, type ObsidianNavigation } from "./navigation.js";
import { matchRoute, routeHref } from "./router.js";
import { renderPage } from "./render.js";
import type { CorrectionDraft, FrontendApi, GeneratedSyncResult } from "./types.js";

export async function renderRoute(api: FrontendApi, url: string): Promise<string> {
  try {
    return (await renderPage({ api, route: matchRoute(url) })).html;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Transcript Memory Vault UI render failed", error);
    return appShell("Unable to load view", `<section class="trust-warning"><h2>Transcript Memory Vault could not load this view</h2><p>${escapeHtml(detail)}</p><p>The plugin did not continue as if unavailable data were trustworthy. Open the dashboard or plugin settings for database health details.</p></section>`);
  }
}

// Tracks the active listener set per host element. Obsidian calls the view's render on both onOpen
// and setState, so mountObsidianUi can run repeatedly on the same contentEl; without this, each run
// would stack another set of delegated listeners and every click would open duplicate views.
const mountControllers = new WeakMap<HTMLElement, AbortController>();

// Frontend actions that change persisted data. After one succeeds, other open views are notified to
// refresh so they cannot show stale status/items.
const MUTATING_ACTIONS = new Set(["upload", "ask", "correction", "review", "sync-graph", "delete-transcript"]);

export async function mountObsidianUi(root: HTMLElement, api: FrontendApi, navigation: ObsidianNavigation, initialTarget: string, onMutation?: () => void | Promise<void>, notify?: (message: string) => void): Promise<void> {
  // Abort any previous mount's listeners on this host so exactly one set is ever active.
  mountControllers.get(root)?.abort();
  const controller = new AbortController();
  mountControllers.set(root, controller);
  const { signal } = controller;

  let currentTarget = initialTarget;
  const render = async (target: string) => {
    currentTarget = target;
    root.innerHTML = await renderRoute(api, target);
    const span = new URL(target).searchParams.get("span");
    if (span) document.getElementById(`span-${span}`)?.scrollIntoView({ block: "center" });
  };
  root.addEventListener("click", (event) => {
    const copy = (event.target as Element).closest<HTMLElement>("[data-copy-quote]");
    if (copy) {
      void navigator.clipboard?.writeText(copy.dataset.copyQuote ?? "");
      copy.textContent = "Quote copied";
      return;
    }
    const routeControl = (event.target as Element).closest<HTMLElement>("[data-route], a[href]");
    const target = routeControl?.dataset.route ?? routeControl?.getAttribute("href");
    if (!isInternalNavigationTarget(target)) return;
    // We own internal plugin routes: prevent the default anchor action and stop the event from also
    // reaching Obsidian's document-level link handler, so the route opens exactly one plugin view.
    event.preventDefault();
    event.stopPropagation();
    void navigateInternal(navigation, target);
  }, { signal });
  root.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement;
    if (input.name !== "file" || !input.files?.[0]) return;
    const file = input.files[0];
    const form = input.form;
    const status = form?.querySelector<HTMLElement>("[data-file-status]") ?? form?.parentElement?.querySelector<HTMLElement>("[data-file-status]");
    if (status) status.textContent = `${file.name} · ${file.size} bytes`;
    void file.text().then((text) => {
      const filename = form?.elements.namedItem("filename") as HTMLInputElement | null;
      const rawText = form?.elements.namedItem("rawText") as HTMLTextAreaElement | null;
      if (filename) filename.value = file.name;
      if (rawText) rawText.value = text;
    });
  }, { signal });
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    // Build FormData WITH the submitter so a clicked submit button's name/value (e.g. the review form's
    // decision=approve|reject, where Dismiss is the reject button) is captured. Plain `new FormData(form)`
    // omits submit-button entries, which previously made `decision` always read as approve.
    const data = new FormData(form, (event as SubmitEvent).submitter);
    const result = form.parentElement?.querySelector<HTMLElement>("[data-form-result]");
    const loading = form.parentElement?.querySelector<HTMLElement>("[data-loading-message]");
    const action = form.dataset.action;
    void (async () => {
      try {
        if (loading) loading.hidden = false;
        if (action === "upload") {
          const imported = await api.uploadTranscript({ filename: String(data.get("filename") ?? ""), rawText: String(data.get("rawText") ?? "") });
          if (result) {
            result.innerHTML = `${imported.status === "duplicate" ? '<strong>Duplicate transcript:</strong> existing immutable source reused.' : "<strong>Transcript imported successfully.</strong>"}
              <a href="${escapeHtml(routeHref.transcript(imported.transcriptId))}">Open transcript</a> <a href="${routeHref.dashboard()}">Dashboard</a>${imported.warning ? `<p class="trust-warning">${escapeHtml(imported.warning)}</p>` : ""}`;
          }
        } else if (action === "ask") {
          const answer = await api.ask(String(data.get("question") ?? ""), { transcriptIds: data.getAll("transcriptIds").map(String) });
          await navigation.openAnswer(answer.id);
        } else if (action === "correction") {
          const correction = await api.submitCorrection({
            targetType: String(data.get("targetType")) as CorrectionDraft["targetType"], targetId: String(data.get("targetId")),
            correctionText: String(data.get("correctionText") ?? ""), reason: String(data.get("reason") ?? "") || undefined,
          });
          if (result) result.innerHTML = `Correction appended: <code>${escapeHtml(correction.correctionId)}</code>`;
        } else if (action === "review") {
          // Re-fetch and re-render after the decision so the resolved task disappears and the page
          // reflects the current memory status — never stale pre-action text or a now-resolved item.
          // (A just-resolved detail page falls back to the review queue.)
          await performReviewAction(api, String(data.get("memoryId") ?? ""), data.get("decision") === "reject" ? "reject" : "approve", render, currentTarget);
        } else if (action === "sync-graph") {
          // Writes the disposable generated-Markdown view layer (Obsidian's native graph). Only the
          // plugin injects a real implementation; headless callers get an "unavailable" result.
          const summary = await api.syncGeneratedGraphNotes?.();
          if (result) result.innerHTML = renderSyncSummary(summary);
        } else if (action === "delete-transcript") {
          // Hard delete (irreversible). The required confirmation checkbox gates this in the browser.
          const { summary } = await api.deleteTranscript(String(data.get("transcriptId") ?? ""));
          const message = `Transcript deleted: ${summary.spansDeleted} span(s), ${summary.evidencePointersDeleted} evidence pointer(s), ${summary.evidenceItemsDeleted} evidence item(s) removed; ${summary.memoriesDowngraded} memory(ies) downgraded, ${summary.conflictsAffected} conflict(s) and ${summary.answersAffected} answer(s) affected. Run "Sync generated graph notes" to remove stale graph notes.`;
          if (result) result.textContent = message;
          notify?.(message);
          await navigation.openDashboard();
        } else if (action === "filter") {
          const view = form.dataset.view ?? "dashboard";
          await render(`mv://${view}?${new URLSearchParams(data as never)}`);
        }
        // After a successful mutating action, refresh every OTHER open plugin view (the initiating view
        // already refreshed itself in place above). Never let a refresh failure surface as an action error.
        if (action && MUTATING_ACTIONS.has(action)) {
          try { await onMutation?.(); } catch (refreshError) { console.error("Transcript Memory Vault cross-view refresh failed", refreshError); }
        }
      } catch (error) {
        if (result) result.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        if (loading) loading.hidden = true;
      }
    })();
  }, { signal });
  await render(initialTarget);
}

export function isInternalNavigationTarget(target: string | null | undefined): target is string {
  return target?.startsWith("mv://") ?? false;
}

/** Inline result of a dashboard "Sync Obsidian graph notes" action. Navigation/view layer only — no truth. */
export function renderSyncSummary(summary?: GeneratedSyncResult): string {
  if (!summary || summary.status === "unavailable") {
    return `<p class="trust-warning">${escapeHtml(summary?.message ?? "Generated graph notes can only be synced inside the Obsidian plugin. Use the \"Sync generated graph notes\" command.")}</p>`;
  }
  if (summary.status === "failed") return `<p class="trust-warning">Sync failed: ${escapeHtml(summary.message)}</p>`;
  const warn = summary.warnings.length ? `<p class="trust-warning">${summary.warnings.length} warning(s) — weak/broken evidence is preserved and labeled in the generated notes.</p>` : "";
  const err = summary.errors.length ? `<p class="trust-warning">${summary.errors.length} file(s) could not be written.</p>` : "";
  return `<p><strong>Graph notes synced.</strong> ${summary.filesWritten} written, ${summary.filesSkipped} unchanged · ${summary.graphNodeCount} nodes · ${summary.graphEdgeCount} edges. Open Obsidian's native graph to see them.</p>${warn}${err}`;
}

/**
 * The route to re-render after a mutating action. Normally the current route is re-fetched in place.
 * A review-detail item that was just approved/rejected no longer exists, so its detail page would show
 * "not found"; falling back to the review queue is the least confusing result.
 */
export function refreshTargetAfterAction(currentTarget: string): string {
  return matchRoute(currentTarget).id === "review_detail" ? routeHref.reviewQueue() : currentTarget;
}

/**
 * Perform an approve/reject decision and then refresh the current view. Extracted (and DOM-free) so the
 * refresh-after-mutation contract is verifiable offline — the Node test environment cannot dispatch a
 * real form submit (`new FormData(formElement)` is unavailable there).
 */
export async function performReviewAction(
  api: Pick<FrontendApi, "reviewMemoryObject">,
  memoryId: string,
  decision: "approve" | "reject",
  refresh: (target: string) => Promise<void>,
  currentTarget: string,
): Promise<void> {
  await api.reviewMemoryObject(memoryId, decision);
  await refresh(refreshTargetAfterAction(currentTarget));
}
