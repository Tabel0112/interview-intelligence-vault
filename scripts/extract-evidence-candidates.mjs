import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractAllEvidenceCandidates } from "../src/evidenceCandidateExtractor.mjs";
import { createOpenAiJsonClient } from "../src/openAiJsonClient.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectPath = path.resolve(scriptDirectory, "..");
const args = process.argv.slice(2);
const force = args.includes("--force");
const transcriptIndex = args.indexOf("--transcript");
const transcriptId = transcriptIndex === -1 ? null : args[transcriptIndex + 1];

if (transcriptIndex !== -1 && !transcriptId) {
  console.error("--transcript requires a transcript_id");
  process.exitCode = 1;
} else {
  let realClient = null;
  const lazyAiClient = {
    async generateJson(request) {
      realClient ??= createOpenAiJsonClient();
      return realClient.generateJson(request);
    },
  };

  try {
    const results = await extractAllEvidenceCandidates({
      aiClient: lazyAiClient,
      projectPath,
      force,
      transcriptId,
    });
    for (const warning of results.warnings) console.warn(`Warning: ${warning}`);
    for (const failure of results.failed) {
      console.error(`Failed ${failure.transcript_id}: ${failure.error}`);
    }
    console.log(`Transcripts processed: ${results.processed.length}`);
    console.log(`Transcripts skipped: ${results.skipped.length}`);
    console.log(`Candidates written: ${results.candidateCount}`);
    console.log(`Warnings: ${results.warnings.length}`);
    console.log(`Failures: ${results.failed.length}`);
    if (results.failed.length > 0) process.exitCode = 1;
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
    process.exitCode = 1;
  }
}
