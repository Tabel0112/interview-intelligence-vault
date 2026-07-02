#!/usr/bin/env node
// Copy the BUILT plugin (dist/transcript-memory-vault) into an Obsidian test vault.
// Pure Node, no dependencies. NEVER overwrites an existing database or settings file.
//
// Usage:
//   npm run install:vault -- <path-to-vault>
//   TRANSCRIPT_MEMORY_VAULT=<path-to-vault> npm run install:vault
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST = "dist/transcript-memory-vault";
const PLUGIN_ID = "transcript-memory-vault";
// User-owned files that the build never contains and the installer must never clobber.
const PRESERVE = ["transcript-memory.sqlite", "transcript-memory.sqlite-shm", "transcript-memory.sqlite-wal", "data.json"];

const vaultArg = process.argv[2] ?? process.env.TRANSCRIPT_MEMORY_VAULT;
if (!vaultArg) {
  console.error("Usage: npm run install:vault -- <path-to-vault>   (or set TRANSCRIPT_MEMORY_VAULT)");
  process.exit(1);
}
const vault = resolve(vaultArg);

if (!existsSync(DIST) || !existsSync(join(DIST, "main.js")) || !existsSync(join(DIST, "manifest.json"))) {
  console.error(`Built plugin not found at ${DIST}. Run \`npm run build\` (then \`npm run verify:dist\`) first.`);
  process.exit(1);
}
if (!existsSync(vault)) {
  console.error(`Vault path does not exist: ${vault}`);
  process.exit(1);
}
const dotObsidian = join(vault, ".obsidian");
if (!existsSync(dotObsidian)) {
  console.error(`No .obsidian folder in ${vault}. Open the folder as a vault in Obsidian once, then re-run.`);
  process.exit(1);
}

const target = join(dotObsidian, "plugins", PLUGIN_ID);
mkdirSync(target, { recursive: true });

const preserved = PRESERVE.filter((file) => existsSync(join(target, file)));

// Replace only plugin-owned files. Remove stale migrations/ and native/ subtrees first
// (no user data lives there); the database and settings at the plugin root are left untouched.
for (const dir of ["migrations", "native"]) rmSync(join(target, dir), { recursive: true, force: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) cpSync(join(DIST, file), join(target, file));
for (const dir of ["migrations", "native"]) cpSync(join(DIST, dir), join(target, dir), { recursive: true });

console.log(`Installed ${PLUGIN_ID} -> ${target}`);
console.log("  files: main.js, manifest.json, styles.css, migrations/, native/");
if (preserved.length > 0) console.log(`  preserved existing: ${preserved.join(", ")}`);
console.log("Restart Obsidian (or toggle the plugin) and enable it under Settings -> Community plugins.");
