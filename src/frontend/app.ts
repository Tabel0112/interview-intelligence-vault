import { escapeHtml } from "./html.js";
import { appShell } from "./html.js";
import { navigateInternal, type ObsidianNavigation } from "./navigation.js";
import { matchRoute, routeHref } from "./router.js";
import { renderPage } from "./render.js";
import type { CorrectionDraft, FrontendApi } from "./types.js";

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

export async function mountObsidianUi(root: HTMLElement, api: FrontendApi, navigation: ObsidianNavigation, initialTarget: string): Promise<void> {
  // Abort any previous mount's listeners on this host so exactly one set is ever active.
  mountControllers.get(root)?.abort();
  const controller = new AbortController();
  mountControllers.set(root, controller);
  const { signal } = controller;

  const render = async (target: string) => {
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
    const data = new FormData(form);
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
              <a href="${escapeHtml(routeHref.transcript(imported.transcriptId))}">Open transcript</a> <a href="${routeHref.dashboard()}">Dashboard</a>`;
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
          const reviewed = await api.reviewMemoryObject(String(data.get("memoryId") ?? ""), data.get("decision") === "reject" ? "reject" : "approve");
          if (result) result.innerHTML = `Memory ${escapeHtml(reviewed.status)}.${reviewed.warning ? ` ${escapeHtml(reviewed.warning)}` : ""}`;
        } else if (action === "filter") {
          const view = form.dataset.view ?? "dashboard";
          await render(`mv://${view}?${new URLSearchParams(data as never)}`);
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
