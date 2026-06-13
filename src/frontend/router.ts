import type { RouteId, RouteMatch } from "./types.js";

const patterns: Array<{ id: RouteId; pattern: RegExp; names?: string[] }> = [
  { id: "dashboard", pattern: /^\/(?:dashboard\/?)?$/ },
  { id: "upload", pattern: /^\/upload\/?$/ },
  { id: "transcript", pattern: /^\/transcripts\/([^/]+)\/?$/, names: ["id"] },
  { id: "ask", pattern: /^\/ask\/?$/ },
  { id: "answer", pattern: /^\/answers\/([^/]+)\/?$/, names: ["id"] },
  { id: "evidence", pattern: /^\/evidence\/([^/]+)\/?$/, names: ["id"] },
  { id: "memory", pattern: /^\/memory\/([^/]+)\/?$/, names: ["id"] },
  { id: "graph", pattern: /^\/graph\/?$/ },
  { id: "search", pattern: /^\/search\/?$/ },
  { id: "review", pattern: /^\/review\/?$/ },
  { id: "review_detail", pattern: /^\/review\/([^/]+)\/?$/, names: ["id"] },
];

export function matchRoute(input: string): RouteMatch {
  const internal = input.startsWith("mv://") ? new URL(input) : null;
  const inputPath = internal ? `/${internal.host}${internal.pathname}${internal.search}` : input;
  const url = new URL(inputPath, "http://vault.local");
  for (const route of patterns) {
    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    return {
      id: route.id,
      path: url.pathname,
      params: Object.fromEntries((route.names ?? []).map((name, index) => [name, decodeURIComponent(match[index + 1])])),
      query: url.searchParams,
    };
  }
  return { id: "not_found", path: url.pathname, params: {}, query: url.searchParams };
}

export const routeHref = {
  dashboard: () => "mv://dashboard",
  upload: () => "mv://upload",
  ask: () => "mv://ask",
  graph: (query = "") => `mv://graph${query}`,
  search: (query = "") => `mv://search${query}`,
  reviewQueue: (query = "") => `mv://review${query}`,
  transcript: (id: string, spanId?: string) => `mv://transcripts/${encodeURIComponent(id)}${spanId ? `?span=${encodeURIComponent(spanId)}` : ""}`,
  answer: (id: string) => `mv://answers/${encodeURIComponent(id)}`,
  evidence: (id: string) => `mv://evidence/${encodeURIComponent(id)}`,
  memory: (id: string) => `mv://memory/${encodeURIComponent(id)}`,
  review: (id: string) => `mv://review/${encodeURIComponent(id)}`,
};
