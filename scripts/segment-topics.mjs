import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAiJsonClient } from "../src/openAiJsonClient.mjs";
import { validateProcessedTranscript } from "../src/processedTranscriptWriter.mjs";
import {
  loadTopicSegmentationPrompt,
  segmentTranscriptTopics,
  shouldSkipTopicSegmentation,
  writeTopicSegmentationFile,
} from "../src/topicSegmentationAgent.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectPath = path.resolve(scriptDirectory, "..");
const vaultPath = path.join(projectPath, "vault");
const processedDirectory = path.join(vaultPath, "01 Transcripts", "Processed");
const topicDirectory = path.join(vaultPath, "02 Topic Analyses");
const force = process.argv.slice(2).includes("--force");

let processedCount = 0;
let skippedCount = 0;
let failedCount = 0;
const failedTranscripts = [];

try {
  const prompt = await loadTopicSegmentationPrompt({ projectPath });
  const entries = await readdir(processedDirectory, { withFileTypes: true });
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith(".") &&
        entry.name.endsWith(".processed.json"),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  let aiClient = null;
  for (const file of files) {
    const processedPath = path.join(processedDirectory, file.name);
    let transcriptId = file.name.replace(/\.processed\.json$/, "");
    try {
      const contents = await readFile(processedPath);
      const sourceSha256 = createHash("sha256").update(contents).digest("hex");
      const processedTranscript = JSON.parse(contents.toString("utf8"));
      transcriptId = processedTranscript.transcript_id ?? transcriptId;
      const validationErrors = validateProcessedTranscript(processedTranscript);
      if (validationErrors.length > 0) {
        throw new Error(
          `Invalid processed transcript: ${validationErrors.join("; ")}`,
        );
      }

      const outputPath = path.join(
        topicDirectory,
        `${processedTranscript.transcript_id}.topics.json`,
      );
      if (
        await shouldSkipTopicSegmentation(outputPath, sourceSha256, { force })
      ) {
        skippedCount += 1;
        continue;
      }

      aiClient ??= createOpenAiJsonClient();
      const topicSegmentation = await segmentTranscriptTopics(
        processedTranscript,
        aiClient,
        {
          prompt,
          sourceProcessedFile: `vault/01 Transcripts/Processed/${file.name}`,
          sourceSha256,
        },
      );
      await writeTopicSegmentationFile(topicSegmentation, { vaultPath });
      processedCount += 1;
    } catch (error) {
      failedCount += 1;
      failedTranscripts.push(transcriptId);
      console.error(`Failed ${transcriptId}: ${error.message}`);
    }
  }
} catch (error) {
  console.error(`Fatal error: ${error.message}`);
  process.exitCode = 1;
}

console.log(`Topic files written: ${processedCount}`);
console.log(`Unchanged transcripts skipped: ${skippedCount}`);
console.log(`Failed transcripts: ${failedCount}`);
console.log(
  `Failed transcript IDs: ${
    failedTranscripts.length ? failedTranscripts.join(", ") : "none"
  }`,
);
if (failedCount > 0) {
  process.exitCode = 1;
}
