import esbuild from "esbuild";
import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

mkdirSync("migrations", { recursive: true });
for (const file of readdirSync("src/db/migrations").filter((name) => name.endsWith(".sql"))) {
  cpSync(join("src/db/migrations", file), join("migrations", file));
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
mkdirSync(distribution, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) cpSync(file, join(distribution, file));
cpSync("migrations", join(distribution, "migrations"), { recursive: true });
for (const dependency of ["better-sqlite3", "bindings", "file-uri-to-path"]) {
  const destination = join(distribution, "node_modules", dependency);
  mkdirSync(destination, { recursive: true });
  cpSync(join("node_modules", dependency), destination, { recursive: true });
}
cpSync(
  "native/electron-39.8.3/better_sqlite3.node",
  join(distribution, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
);
