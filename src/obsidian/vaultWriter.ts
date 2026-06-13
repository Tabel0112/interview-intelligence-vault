import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import type { GeneratedFile } from "./types.js";

const safeTarget = (root: string, relativePath: string) => {
  if (isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) throw new Error(`Unsafe generated path: ${relativePath}`);
  const target = resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error(`Generated path escapes output root: ${relativePath}`);
  return target;
};
export async function writeGeneratedVault(outputRoot: string, files: GeneratedFile[], cleanBeforeWrite = false): Promise<{ filesWritten: number; filesSkipped: number; errors: string[] }> {
  const root = resolve(outputRoot), errors: string[] = [];
  await mkdir(root, { recursive: true });
  for (const directory of ["Transcripts", "Memories/Facts", "Memories/Preferences", "Memories/Decisions", "Memories/Tasks", "Memories/Questions", "Memories/Other", "People", "Topics", "Decisions", "Evidence", "Answers", "Conflicts", "Graphs", "_system"]) {
    await mkdir(safeTarget(root, directory), { recursive: true });
  }
  if (cleanBeforeWrite) {
    try {
      const old = JSON.parse(await readFile(safeTarget(root, "_system/view-manifest.json"), "utf8")) as { files?: Array<{ relativePath: string }> };
      for (const file of old.files ?? []) await rm(safeTarget(root, file.relativePath), { force: true });
    } catch { /* No prior generated manifest. Never delete untracked user files. */ }
  }
  let filesWritten = 0, filesSkipped = 0;
  for (const file of files) {
    try {
      const target = safeTarget(root, file.relativePath);
      await mkdir(dirname(target), { recursive: true });
      try { if (await readFile(target, "utf8") === file.content) { filesSkipped++; continue; } } catch { /* Write missing file. */ }
      await writeFile(target, file.content, "utf8"); filesWritten++;
    } catch (error) { errors.push(`${file.relativePath}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { filesWritten, filesSkipped, errors };
}
