import { describe, expect, it, vi } from "vitest";
import {
  navigateInternal,
  obsidianRouteFromProtocol,
  OBSIDIAN_PROTOCOL_ACTION,
  routeHref,
  toObsidianUri,
  type ObsidianNavigation,
} from "../src/frontend/index.js";

// Parse an obsidian:// deep link the way Obsidian's protocol layer does (per-param decode).
const protocolParams = (obsidianUri: string): Record<string, string> =>
  Object.fromEntries(new URL(obsidianUri).searchParams.entries());
const protocolAction = (obsidianUri: string): string => new URL(obsidianUri).host;

describe("toObsidianUri", () => {
  it("converts an internal mv:// route into an OS-openable obsidian:// deep link", () => {
    const uri = toObsidianUri(routeHref.evidence("evp_1"));
    expect(uri.startsWith(`obsidian://${OBSIDIAN_PROTOCOL_ACTION}?`)).toBe(true);
    expect(protocolAction(uri)).toBe(OBSIDIAN_PROTOCOL_ACTION);
    const params = protocolParams(uri);
    expect(params.route).toBe("mv://evidence/evp_1"); // mv:// stays canonical; just wrapped
    expect(params.vault).toBeUndefined();
  });

  it("includes the vault, encoding spaces as %20 (not '+') so Obsidian's decoder round-trips it", () => {
    const uri = toObsidianUri(routeHref.answer("ans_1"), { vault: "My Vault" });
    expect(uri).toContain("vault=My%20Vault");
    expect(uri).not.toContain("vault=My+Vault");
    const params = protocolParams(uri);
    expect(params.vault).toBe("My Vault");
    expect(params.route).toBe("mv://answers/ans_1");
  });

  it("omits a blank/whitespace vault", () => {
    expect(toObsidianUri(routeHref.dashboard(), { vault: "   " })).not.toContain("vault=");
    expect(toObsidianUri(routeHref.dashboard(), {})).not.toContain("vault=");
  });

  it("round-trips a transcript span route, preserving the ?span= query and special-char ids", () => {
    const span = routeHref.transcript("t 1", "s/1"); // ids encoded inside the mv:// route
    const params = protocolParams(toObsidianUri(span));
    expect(params.route).toBe(span);
    // The wrapped route still validates to a known internal view.
    expect(obsidianRouteFromProtocol(params)).toBe(span);
  });
});

describe("obsidianRouteFromProtocol", () => {
  it("returns the internal route for every known view (allowlist of mv:// routes)", () => {
    const routes = [
      routeHref.dashboard(),
      routeHref.upload(),
      routeHref.ask(),
      routeHref.search(),
      routeHref.graph(),
      routeHref.reviewQueue(),
      routeHref.transcript("t1", "s1"),
      routeHref.answer("ans_1"),
      routeHref.evidence("evp_1"),
      routeHref.memory("mem_1"),
      routeHref.review("weak:evp_1"),
      routeHref.review("conflict:c1"), // the deep-link target get_conflicts emits
    ];
    for (const route of routes) {
      expect(obsidianRouteFromProtocol({ route })).toBe(route);
    }
  });

  it("rejects a missing route param", () => {
    expect(obsidianRouteFromProtocol({})).toBeNull();
  });

  it("rejects non-mv:// schemes (no file paths, web links, or arbitrary strings)", () => {
    for (const route of [
      "file:///etc/passwd",
      "https://evil.example/steal",
      "javascript:alert(1)",
      "/local/path",
      "obsidian://open?file=secret",
      "mvX://evidence/evp_1",
      "evidence/evp_1",
    ]) {
      expect(obsidianRouteFromProtocol({ route })).toBeNull();
    }
  });

  it("rejects mv:// strings that do not resolve to a known route", () => {
    for (const route of ["mv://nope", "mv://memory", "mv://evidence/", "mv://answers"]) {
      expect(obsidianRouteFromProtocol({ route })).toBeNull();
    }
  });

  it("rejects a mismatched protocol action but accepts the matching one", () => {
    expect(obsidianRouteFromProtocol({ action: "some-other-plugin", route: "mv://dashboard" })).toBeNull();
    expect(obsidianRouteFromProtocol({ action: OBSIDIAN_PROTOCOL_ACTION, route: "mv://dashboard" })).toBe("mv://dashboard");
  });
});

describe("obsidian:// protocol handler contract (navigation-only)", () => {
  // Mirrors the handler registered in src/obsidian/Plugin.ts: decode+validate the route, navigate ONLY
  // when valid, otherwise surface a Notice. Replicated here because Plugin.ts imports the real "obsidian"
  // runtime and is not loadable in the headless test environment (same pattern as the navigateInternal tests).
  async function dispatchProtocol(navigation: ObsidianNavigation, params: Record<string, string>, onInvalid: () => void): Promise<void> {
    const route = obsidianRouteFromProtocol(params);
    if (route) await navigateInternal(navigation, route);
    else onInvalid();
  }

  const makeNav = () => ({
    openDashboard: vi.fn(async () => undefined),
    openUpload: vi.fn(async () => undefined),
    openTranscripts: vi.fn(async () => undefined),
    openTranscript: vi.fn(async () => undefined),
    openAskAI: vi.fn(async () => undefined),
    openAnswer: vi.fn(async () => undefined),
    openAnswerTrace: vi.fn(async () => undefined),
    openEvidence: vi.fn(async () => undefined),
    openMemoryObject: vi.fn(async () => undefined),
    openGraph: vi.fn(async () => undefined),
    openSearch: vi.fn(async () => undefined),
    openReviewQueue: vi.fn(async () => undefined),
  }) satisfies ObsidianNavigation;

  const assertOnly = (nav: ReturnType<typeof makeNav>, called: keyof ObsidianNavigation) => {
    for (const [name, fn] of Object.entries(nav)) {
      if (name === called) expect(fn, `${name} should be called once`).toHaveBeenCalledTimes(1);
      else expect(fn, `${name} should not be called`).not.toHaveBeenCalled();
    }
  };

  it("drives exactly one internal navigation for a valid evidence deep link", async () => {
    const nav = makeNav();
    const onInvalid = vi.fn();
    await dispatchProtocol(nav, protocolParams(toObsidianUri(routeHref.evidence("evp_9"))), onInvalid);
    expect(nav.openEvidence).toHaveBeenCalledWith("evp_9");
    assertOnly(nav, "openEvidence");
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it("opens the exact transcript span for a span deep link", async () => {
    const nav = makeNav();
    await dispatchProtocol(nav, protocolParams(toObsidianUri(routeHref.transcript("t1", "s1"))), vi.fn());
    expect(nav.openTranscript).toHaveBeenCalledWith("t1", { spanId: "s1" });
    assertOnly(nav, "openTranscript");
  });

  it("opens the review queue at a conflict item (the get_conflicts deep-link target)", async () => {
    const nav = makeNav();
    await dispatchProtocol(nav, protocolParams(toObsidianUri(routeHref.review("conflict:c1"))), vi.fn());
    expect(nav.openReviewQueue).toHaveBeenCalledWith({ reviewItemId: "conflict:c1" });
    assertOnly(nav, "openReviewQueue");
  });

  it("shows a notice and never navigates for an invalid/unsafe deep link", async () => {
    const nav = makeNav();
    const onInvalid = vi.fn();
    await dispatchProtocol(nav, { route: "file:///etc/passwd" }, onInvalid);
    expect(onInvalid).toHaveBeenCalledTimes(1);
    for (const fn of Object.values(nav)) expect(fn).not.toHaveBeenCalled();
  });

  it("shows a notice when the route param is missing entirely", async () => {
    const nav = makeNav();
    const onInvalid = vi.fn();
    await dispatchProtocol(nav, {}, onInvalid);
    expect(onInvalid).toHaveBeenCalledTimes(1);
    for (const fn of Object.values(nav)) expect(fn).not.toHaveBeenCalled();
  });
});
