import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Portability guards: the app must run on someone else's machine. These tests fail if a developer-specific
// absolute path, home directory, username, or real API key leaks into anything that ships (the plugin +
// MCP bundles) or anything a new user reads to set up (the docs). They run fully offline.

const repoRoot = process.cwd();
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

// Everything that ships to another user or is read during setup.
const SHIPPING = [
  "main.js",
  "dist/transcript-memory-vault/main.js",
  "dist/transcript-memory-vault/manifest.json",
  "dist/transcript-memory-vault/styles.css",
  "dist/mcp/server.cjs",
];
const DOCS = readdirSync(join(repoRoot, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`);

function walk(rel: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(repoRoot, rel))) {
    const child = `${rel}/${entry}`;
    if (statSync(join(repoRoot, child)).isDirectory()) walk(child, acc);
    else acc.push(child);
  }
  return acc;
}

// A real macOS/Linux home path (e.g. /Users/alice/… or /home/alice/…). Placeholders like
// `/absolute/path/to/…` and `<vault>/…` are fine — they do not match a user directory under /Users or /home.
const HOME_PATH = /\/Users\/[^/\s"'`]+\/|\/home\/[a-z_][^/\s"'`]*\//;
const REAL_KEY = /sk-[A-Za-z0-9]{20,}/;

describe("portability: no developer-specific paths, identifiers, or secrets leak", () => {
  it("shipping artifacts and docs contain no developer home path", () => {
    for (const file of [...SHIPPING, ...DOCS]) {
      expect(read(file), `${file} contains a developer home path`).not.toMatch(HOME_PATH);
    }
  });

  it("shipping artifacts contain no real-looking API key", () => {
    for (const file of SHIPPING) {
      expect(read(file), `${file} contains an sk- API key`).not.toMatch(REAL_KEY);
    }
  });

  it("no source, script, doc, or shipping file embeds the developer username", () => {
    // Precise username check (does NOT flag verify-dist.mjs's generic `/Users/<name>/` detection regex).
    for (const file of [...walk("src"), ...walk("scripts"), ...DOCS, ...SHIPPING]) {
      expect(read(file).toLowerCase(), `${file} embeds a developer username`).not.toContain("baiyangchen");
    }
  });

  it("install:vault refuses to run without an explicit vault path (no hardcoded developer vault)", () => {
    let status: number | null = 0;
    let stderr = "";
    try {
      // Force the env override empty so the script cannot fall back to a developer's TRANSCRIPT_MEMORY_VAULT.
      execFileSync("node", ["scripts/install-to-vault.mjs"], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, TRANSCRIPT_MEMORY_VAULT: "" } });
    } catch (error) {
      const e = error as { status?: number | null; stderr?: string };
      status = e.status ?? null;
      stderr = String(e.stderr ?? "");
    }
    expect(status).not.toBe(0); // exits non-zero
    expect(stderr).toMatch(/path-to-vault|TRANSCRIPT_MEMORY_VAULT/); // with a clear usage message
  });
});
