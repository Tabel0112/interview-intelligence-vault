import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * Block-aware scan of styles.css. Walks brace depth so we can tell apart:
 *  - real style-rule selectors (must be scoped under the plugin root/host), including selectors nested
 *    inside `@media` blocks,
 *  - `@keyframes NAME { ... }` (NAME collected; its `0%`/`from`/`to` step selectors are NOT global selectors),
 *  - other at-rule preludes (`@media (...)`), which are not selectors themselves.
 * Deliberately small (not a full CSS parser) but sufficient for this hand-written, comment-stripped file.
 */
function analyzeCss(raw: string): { selectors: string[]; keyframeNames: string[]; keyframeSteps: string[] } {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, ""); // strip comments
  const selectors: string[] = [];
  const keyframeNames: string[] = [];
  const keyframeSteps: string[] = [];
  const stack: Array<"top" | "media" | "keyframes" | "rule" | "atrule"> = ["top"];
  let i = 0;
  while (i < css.length) {
    let j = i;
    while (j < css.length && css[j] !== "{" && css[j] !== "}") j++;
    const prelude = css.slice(i, j).trim();
    if (css[j] === "{") {
      const ctx = stack[stack.length - 1];
      if (prelude.startsWith("@keyframes")) {
        keyframeNames.push(prelude.replace("@keyframes", "").trim());
        stack.push("keyframes");
      } else if (prelude.startsWith("@media")) {
        stack.push("media");
      } else if (prelude.startsWith("@")) {
        stack.push("atrule");
      } else if (ctx === "keyframes") {
        for (const step of prelude.split(",").map((s) => s.trim()).filter(Boolean)) keyframeSteps.push(step);
        stack.push("rule");
      } else {
        for (const sel of prelude.split(",").map((s) => s.trim()).filter(Boolean)) selectors.push(sel);
        stack.push("rule");
      }
      i = j + 1;
    } else if (css[j] === "}") {
      if (stack.length > 1) stack.pop();
      i = j + 1;
    } else {
      break;
    }
  }
  return { selectors, keyframeNames, keyframeSteps };
}

describe("Obsidian frontend CSS boundary", () => {
  it("scopes every style rule under the plugin root or host — including inside @media", async () => {
    const css = await readFile("styles.css", "utf8");
    const { selectors } = analyzeCss(css);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector, `unscoped selector: ${selector}`).toMatch(/^\.transcript-memory-vault(?:-host|\b)/);
    }
  });

  it("namespaces every @keyframes with a tmv- prefix (keyframe names are global in CSS)", async () => {
    const css = await readFile("styles.css", "utf8");
    const { keyframeNames, keyframeSteps } = analyzeCss(css);
    for (const name of keyframeNames) {
      expect(name, `un-namespaced keyframes: ${name}`).toMatch(/^tmv-[a-z0-9-]+$/);
    }
    // Keyframe step selectors are only ever `from`/`to`/percentages — never leaked as global selectors.
    for (const step of keyframeSteps) {
      expect(step, `unexpected keyframe step: ${step}`).toMatch(/^(?:from|to|\d+%)$/);
    }
  });

  it("includes a reduced-motion escape hatch scoped under the plugin root", async () => {
    const css = await readFile("styles.css", "utf8");
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    // The reduced-motion block must be scoped (its selectors go through the same scoping assertion above).
    const { selectors } = analyzeCss(css);
    expect(selectors.some((s) => /^\.transcript-memory-vault\b/.test(s) && s.includes("*"))).toBe(true);
  });

  it("keeps the global-safety bans (no fixed/absolute positioning, pointer-events:none, or negative margins)", async () => {
    const css = await readFile("styles.css", "utf8");
    expect(css).not.toContain("pointer-events: none");
    expect(css).not.toMatch(/\bposition:\s*(?:absolute|fixed)\b/);
    expect(css).not.toMatch(/\bmargin(?:-[a-z]+)?:\s*-/);
    // Animations/transitions must be scoped: no bare global @keyframes leakage is possible because every
    // keyframes name is tmv- prefixed (asserted above) and all rules are scoped (asserted above).
  });
});
