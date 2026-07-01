import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, renderRoute, routeHref } from "../src/frontend/index.js";

const now = () => new Date("2026-06-30T12:00:00.000Z");
let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());
const api = () => createSqliteFrontendApi(db, { now });

describe("Pass 2: scoped design system", () => {
  it("defines the core design-system primitive classes, all scoped under the plugin root", async () => {
    const css = await readFile("styles.css", "utf8");
    for (const cls of [".tmv-card", ".tmv-card--primary", ".tmv-grid", ".tmv-btn-primary", ".tmv-btn-secondary",
      ".tmv-badge", ".tmv-callout", ".tmv-callout--info", ".tmv-callout--warning", ".tmv-callout--success",
      ".tmv-empty", ".tmv-section-header", ".tmv-code", ".tmv-advanced", ".tmv-dropzone"]) {
      expect(css, `missing design-system class ${cls}`).toContain(`.transcript-memory-vault ${cls}`);
    }
  });

  it("uses namespaced keyframes and applies subtle animation only via transform/opacity", async () => {
    const css = await readFile("styles.css", "utf8");
    expect(css).toContain("@keyframes tmv-fade-in");
    expect(css).toContain("@keyframes tmv-pulse");
    // No motion primitive relies on positioning that could escape the plugin surface.
    expect(css).not.toMatch(/\bposition:\s*(?:absolute|fixed)\b/);
  });

  it("ships a scoped reduced-motion escape hatch", async () => {
    const css = await readFile("styles.css", "utf8");
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain(".transcript-memory-vault *");
    expect(block).toContain("animation: none !important");
    expect(block).toContain("transition: none !important");
  });
});

describe("Pass 2: markup uses design-system classes without changing content/order", () => {
  it("applies tmv-advanced to the Advanced nav disclosure and keeps Internal Ask AI inside it", async () => {
    const html = await renderRoute(api(), routeHref.dashboard());
    expect(html).toContain('class="nav-advanced tmv-advanced"');
    const advanced = html.slice(html.indexOf('<details class="nav-advanced'), html.indexOf("</nav>"));
    expect(advanced).toContain("Internal Ask AI");
  });

  it("applies a fade-in class to empty states (animation only; content unchanged)", async () => {
    const html = await renderRoute(api(), routeHref.transcripts());
    expect(html).toContain("empty-state tmv-fade-in");
    expect(html).toContain("No transcripts yet"); // content/copy unchanged
  });

  it("keeps the demoted Internal Ask AI route rendering", async () => {
    const html = await renderRoute(api(), routeHref.ask());
    expect(html).toContain("Internal Ask AI — for debugging. Use Claude Desktop for normal chat.");
  });
});
