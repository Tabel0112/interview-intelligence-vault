import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Obsidian frontend CSS boundary", () => {
  it("scopes every style rule under the plugin root or host", async () => {
    const css = await readFile("styles.css", "utf8");
    const selectors = [...css.matchAll(/([^{}]+)\{/g)]
      .flatMap((match) => match[1].trim().split(",").map((selector) => selector.trim()));
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector).toMatch(/^\.transcript-memory-vault(?:-host|\b)/);
    }
    expect(css).not.toContain("pointer-events: none");
    expect(css).not.toMatch(/\bposition:\s*(?:absolute|fixed)\b/);
    expect(css).not.toMatch(/\bmargin(?:-[a-z]+)?:\s*-/);
  });
});
