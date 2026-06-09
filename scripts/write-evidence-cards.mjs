import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeAllEvidenceCards } from "../src/evidenceCardWriter.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectPath = path.resolve(scriptDirectory, "..");
const force = process.argv.slice(2).includes("--force");

try {
  const results = await writeAllEvidenceCards({ projectPath, force });
  for (const warning of results.warnings) console.warn(`Warning: ${warning}`);
  for (const failure of results.failed) {
    console.error(`Failed ${failure.transcript_id}: ${failure.error}`);
  }
  console.log(`Cards written: ${results.written.length}`);
  console.log(`Cards skipped unchanged: ${results.skippedUnchanged.length}`);
  console.log(`Cards skipped manual: ${results.skippedManual.length}`);
  console.log(`Candidates rejected invalid: ${results.rejected.length}`);
  console.log(
    `Candidates rejected quote verification: ${
      results.rejected.filter((item) => item.code === "quote_verification_failed").length
    }`,
  );
  console.log(`Candidates deduplicated: ${results.deduplicated.length}`);
  console.log(`Transcripts failed: ${results.failed.length}`);
  if (results.failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(`Fatal error: ${error.message}`);
  process.exitCode = 1;
}
