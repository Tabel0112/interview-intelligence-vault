#!/usr/bin/env node
// Verify the built plugin in dist/ is complete and portable BEFORE a packaged smoke test.
// Pure Node, no dependencies. Prints a checklist and exits non-zero if anything is wrong.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST = "dist/transcript-memory-vault";
const ok = [];
const problems = [];
const fail = (message) => problems.push(message);

if (!existsSync(DIST)) {
  console.error(`✗ ${DIST} is missing. Run \`npm run build\` first.`);
  process.exit(1);
}

// Required top-level files.
for (const file of ["manifest.json", "main.js", "styles.css"]) {
  if (existsSync(join(DIST, file))) ok.push(file);
  else fail(`missing ${file}`);
}

// manifest id must match the install directory name.
try {
  const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
  if (manifest.id !== "transcript-memory-vault") fail(`manifest.id is "${manifest.id}", expected "transcript-memory-vault"`);
  else ok.push(`manifest.id ${manifest.id} v${manifest.version}`);
} catch (error) {
  fail(`manifest.json unreadable: ${error.message}`);
}

// Packaged migrations must match the source set exactly, with the initial schema present.
try {
  const source = readdirSync("src/db/migrations").filter((file) => file.endsWith(".sql"));
  const packaged = existsSync(join(DIST, "migrations"))
    ? readdirSync(join(DIST, "migrations")).filter((file) => file.endsWith(".sql"))
    : [];
  if (packaged.length !== source.length) fail(`packaged migrations ${packaged.length} != source ${source.length}`);
  else if (!packaged.includes("001_initial_schema.sql")) fail("001_initial_schema.sql missing from packaged migrations");
  else ok.push(`migrations ${packaged.length}/${source.length}`);
} catch (error) {
  fail(`migrations check failed: ${error.message}`);
}

// At least one valid native target directory carrying the binding.
try {
  const nativeDir = join(DIST, "native");
  const targets = readdirSync(nativeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[^-]+-[^-]+-abi\d+$/.test(entry.name) && existsSync(join(nativeDir, entry.name, "better_sqlite3.node")))
    .map((entry) => entry.name);
  if (targets.length === 0) fail("no valid native target (e.g. darwin-arm64-abi140/better_sqlite3.node)");
  else ok.push(`native targets: ${targets.join(", ")}`);
} catch (error) {
  fail(`native check failed: ${error.message}`);
}

// node_modules must never be shipped.
if (existsSync(join(DIST, "node_modules"))) fail("node_modules must not be packaged");

// No developer absolute paths baked into the bundle.
try {
  const main = readFileSync(join(DIST, "main.js"), "utf8");
  if (main.includes(resolve("."))) fail("main.js contains the repository absolute path");
  else if (/\/Users\/[^/]+\//.test(main)) fail("main.js contains a developer home path (/Users/<name>/)");
  else ok.push("main.js has no developer paths");
} catch (error) {
  fail(`main.js scan failed: ${error.message}`);
}

for (const line of ok) console.log(`✓ ${line}`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  console.error(`\nverify:dist FAILED (${problems.length} problem(s)). Run \`npm run build\` and re-check.`);
  process.exit(1);
}
console.log("\nverify:dist OK — dist/transcript-memory-vault is complete and portable.");
