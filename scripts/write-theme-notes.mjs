import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeThemeNotes } from "../src/themeNoteWriter.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectPath = path.resolve(scriptDirectory, "..");
const force = process.argv.slice(2).includes("--force");

try {
  const summary = await writeThemeNotes({ projectPath, force });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
