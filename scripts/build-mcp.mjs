// Build the standalone stdio MCP server bundle (separate from the Obsidian plugin bundle).
// Output: dist/mcp/server.cjs (+ dist/mcp/migrations/*.sql, read from disk at runtime).
// Launch with: node dist/mcp/server.cjs   (configured via TMV_* env vars).
import esbuild from "esbuild";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const outDir = "dist/mcp";
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: ["src/mcp/server.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  outfile: join(outDir, "server.cjs"),
  // Native module: resolved from node_modules at runtime, never bundled.
  external: ["better-sqlite3"],
  logLevel: "info",
});

// Migrations are loaded from the filesystem at runtime; ship them beside the bundle so the server can
// open/upgrade a fresh database. (Normally it opens an already-migrated vault DB; this is idempotent.)
const migrationsOut = join(outDir, "migrations");
mkdirSync(migrationsOut, { recursive: true });
for (const file of readdirSync("src/db/migrations").filter((name) => name.endsWith(".sql"))) {
  cpSync(join("src/db/migrations", file), join(migrationsOut, file));
}
console.log(`MCP server built -> ${join(outDir, "server.cjs")} (+ migrations/)`);
