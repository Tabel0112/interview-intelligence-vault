import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, matchRoute, renderRoute, routeHref } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";

const now = () => new Date("2026-06-30T12:00:00.000Z");
let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); createRepositories(db); });
afterEach(() => db.close());
const api = () => createSqliteFrontendApi(db, { now });

describe("Pass 1: route ordering", () => {
  it("matches the transcripts LIST route and the transcript DETAIL route distinctly", () => {
    expect(matchRoute("mv://transcripts").id).toBe("transcripts");
    expect(matchRoute("mv://transcripts/").id).toBe("transcripts");
    const detail = matchRoute("mv://transcripts/tr_abc123");
    expect(detail.id).toBe("transcript"); // list route does not swallow the :id detail route
    expect(detail.params.id).toBe("tr_abc123");
  });

  it("exposes a routeHref.transcripts() helper", () => {
    expect(routeHref.transcripts()).toBe("mv://transcripts");
  });
});

describe("Pass 1: Transcripts list route renders", () => {
  it("shows an empty state with an Upload CTA when there are no transcripts", async () => {
    const html = await renderRoute(api(), routeHref.transcripts());
    expect(html).toContain(">Transcripts</h1>"); // page header
    expect(html).toContain("No transcripts yet");
    expect(html).toContain(`data-route="${routeHref.upload()}"`); // Upload CTA present
  });

  it("lists imported transcripts, each linking to its immutable detail route", async () => {
    const imported = importTranscript(db, { filename: "meeting.txt", rawText: "Alex: We shipped it." });
    const html = await renderRoute(api(), routeHref.transcripts());
    expect(html).toContain("transcript-list-item");
    expect(html).toContain(`href="${routeHref.transcript(imported.transcriptId)}"`);
    expect(html).toContain("meeting.txt");
  });

  it("keeps the transcript DETAIL route working (unchanged)", async () => {
    const imported = importTranscript(db, { filename: "meeting.txt", rawText: "Alex: We shipped it." });
    const html = await renderRoute(api(), routeHref.transcript(imported.transcriptId));
    expect(html).toContain("Raw transcript source is immutable");
    expect(html).toContain("Delete this transcript"); // detail-only danger zone
  });
});

describe("Pass 1: viewer-mode navigation", () => {
  const nav = async () => renderRoute(api(), routeHref.dashboard());
  const primary = (html: string) => html.slice(html.indexOf('<nav aria-label="Primary">'), html.indexOf('<details class="nav-advanced'));
  const advanced = (html: string) => html.slice(html.indexOf('<details class="nav-advanced'), html.indexOf("</nav>"));

  it("primary nav includes Dashboard, Upload, Review, Graph, Search, and Transcripts", async () => {
    const p = primary(await nav());
    for (const target of ["mv://dashboard", "mv://upload", "mv://review", "mv://graph", "mv://search", "mv://transcripts"]) {
      expect(p, `primary nav missing ${target}`).toContain(`data-route="${target}"`);
    }
  });

  it("primary nav does NOT include Ask AI", async () => {
    expect(primary(await nav())).not.toContain("mv://ask");
  });

  it("Advanced nav includes Internal Ask AI (route preserved) and a Settings & health jump", async () => {
    const a = advanced(await nav());
    expect(a).toContain('data-route="mv://ask"');
    expect(a).toContain("Internal Ask AI");
    expect(a).toContain("Settings &amp; health");
  });
});

describe("Pass 1: Ask AI demotion", () => {
  it("the Ask AI route is still accessible and shows the internal-debug callout", async () => {
    const html = await renderRoute(api(), routeHref.ask());
    expect(html).toContain("Internal Ask AI — for debugging. Use Claude Desktop for normal chat.");
    // The recommended-chat banner and the working form are unchanged.
    expect(html).toContain("Claude Desktop (via MCP) is the recommended chat UI");
    expect(html.toLowerCase()).not.toContain("legacy");
  });
});
