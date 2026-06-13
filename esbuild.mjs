import esbuild from "esbuild";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

rmSync("migrations", { recursive: true, force: true });
mkdirSync("migrations", { recursive: true });
for (const file of readdirSync("src/db/migrations").filter((name) => name.endsWith(".sql"))) {
  cpSync(join("src/db/migrations", file), join("migrations", file));
}

const nativeTargets = readdirSync("native", { withFileTypes: true }).filter((entry) => entry.isDirectory());
if (nativeTargets.length === 0) throw new Error("At least one explicit native binding target must be packaged.");
for (const target of nativeTargets) {
  if (!/^[^-]+-[^-]+-abi\d+$/.test(target.name)) throw new Error(`Invalid native binding target directory: ${target.name}`);
}

await esbuild.build({
  entryPoints: ["main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2022",
  platform: "node",
  outfile: "main.js",
  define: {
    "import.meta.url": JSON.stringify("file:///__TRANSCRIPT_MEMORY_BUNDLE__/index.js"),
  },
  sourcemap: process.argv.includes("--production") ? false : "inline",
  logLevel: "info",
});

const distribution = "dist/transcript-memory-vault";
rmSync(distribution, { recursive: true, force: true });
mkdirSync(distribution, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) cpSync(file, join(distribution, file));
cpSync("migrations", join(distribution, "migrations"), { recursive: true });
cpSync("native", join(distribution, "native"), { recursive: true });
