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
  return `<section class="empty-state"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p>${action ? `<a href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>` : ""}</section>`;
}

export function appShell(title: string, body: string): string {
  return `<div class="vault-app">
    <header class="app-header"><a href="mv://dashboard" class="brand">Interview Intelligence Vault</a><nav aria-label="Primary">
      <a href="mv://upload">Upload</a><a href="mv://ask">Ask AI</a><a href="mv://search">Search</a><a href="mv://graph">Graph</a><a href="mv://review">Review</a>
    </nav></header>
    <main><header class="page-header"><h1>${escapeHtml(title)}</h1></header>${body}</main>
  </div>`;
}
