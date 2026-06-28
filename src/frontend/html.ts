import type { TrustState } from "./types.js";

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

export function trustBadge(state: TrustState, label = state.replaceAll("_", " ")): string {
  return `<span class="trust-badge trust-${escapeHtml(state)}" data-trust-state="${escapeHtml(state)}">${escapeHtml(label)}</span>`;
}

export function score(value: number | null | undefined): string {
  return value == null ? "not scored" : `${Math.round(value * 100)}%`;
}

export function emptyState(title: string, detail: string, action?: { href: string; label: string }): string {
  return `<div class="empty-state"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p>${action ? routeButton(action.href, action.label) : ""}</div>`;
}

export function routeButton(target: string, label: string, className = "route-action"): string {
  return `<button type="button" class="${escapeHtml(className)}" data-route="${escapeHtml(target)}">${escapeHtml(label)}</button>`;
}

export function appShell(title: string, body: string): string {
  // Viewer-first nav: Dashboard/Search/Graph/Review are primary; authoring (Upload, Ask AI) is demoted
  // into an "Advanced" disclosure — still reachable, just not the default surface now that Claude Desktop
  // (via MCP) is the recommended chat UI. Every target stays an internal mv:// route.
  return `<div class="transcript-memory-vault vault-app">
    <header class="app-header">${routeButton("mv://dashboard", "Interview Intelligence Vault", "route-action brand")}<nav aria-label="Primary">
      ${routeButton("mv://dashboard", "Dashboard")}${routeButton("mv://search", "Search")}${routeButton("mv://graph", "Graph")}${routeButton("mv://review", "Review")}
      <details class="nav-advanced"><summary>Advanced</summary><div class="nav-advanced-items">${routeButton("mv://upload", "Upload")}${routeButton("mv://ask", "Ask AI")}</div></details>
    </nav></header>
    <main><header class="page-header"><h1>${escapeHtml(title)}</h1></header>${body}</main>
  </div>`;
}
