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

/** The Obsidian protocol action this plugin registers: `obsidian://transcript-memory-vault?route=...`. */
export const OBSIDIAN_PROTOCOL_ACTION = "transcript-memory-vault";

/**
 * Convert a canonical internal `mv://...` route into an OS-openable external `obsidian://...` deep link.
 * Navigation only — the link just carries an internal route the plugin validates before opening a view.
 * `vault` (optional, Obsidian's own param) focuses a specific vault; omit to open the active vault.
 */
export function toObsidianUri(mvUri: string, opts: { vault?: string; action?: string } = {}): string {
  // Encode with encodeURIComponent (space -> %20), not URLSearchParams (space -> "+"): Obsidian decodes
  // each protocol param with decodeURIComponent, which turns "+" into a literal "+" and would corrupt a
  // vault name like "My Vault". %20 round-trips correctly through Obsidian's parser.
  const parts = [`route=${encodeURIComponent(mvUri)}`];
  const vault = opts.vault?.trim();
  if (vault) parts.push(`vault=${encodeURIComponent(vault)}`);
  return `obsidian://${opts.action ?? OBSIDIAN_PROTOCOL_ACTION}?${parts.join("&")}`;
}

/**
 * Extract and validate the internal `mv://` route from an Obsidian protocol payload. Returns the route
 * ONLY when it is an `mv://` link that resolves to a known route; otherwise null (the caller shows an
 * error and does not navigate). This allowlist keeps deep links navigation-only — no file paths,
 * arbitrary strings, or unknown routes are honored.
 */
export function obsidianRouteFromProtocol(params: Record<string, string>, opts: { action?: string } = {}): string | null {
  if (typeof params.action === "string" && params.action !== (opts.action ?? OBSIDIAN_PROTOCOL_ACTION)) return null;
  const route = params.route;
  if (typeof route !== "string" || !route.startsWith("mv://")) return null;
  let parsed: RouteMatch;
  try { parsed = matchRoute(route); } catch { return null; }
  return parsed.id === "not_found" ? null : route;
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
