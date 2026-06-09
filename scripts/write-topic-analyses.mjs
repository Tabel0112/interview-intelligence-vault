import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAiJsonClient } from "../src/openAiJsonClient.mjs";
import { writeAllTopicAnalyses } from "../src/topicAnalysisWriter.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectPath = path.resolve(scriptDirectory, "..");
const force = process.argv.slice(2).includes("--force");

let realClient = null;
const lazyAiClient = {
  get model() {
    return realClient?.model ?? process.env.OPENAI_MODEL ?? "unknown";
  },
  async generateJson(request) {
    realClient ??= createOpenAiJsonClient();
    return realClient.generateJson(request);
  },
};

try {
  const results = await writeAllTopicAnalyses({
    aiClient: lazyAiClient,
    projectPath,
    force,
  });
  for (const failure of results.failed) {
    console.error(
      `Failed ${failure.transcript_id}/${failure.topic_id ?? "all"}: ${failure.error}`,
    );
  }
  for (const warning of results.warnings) {
    console.warn(`Warning: ${warning}`);
  }
  console.log(`Topic analyses written: ${results.written.length}`);
  console.log(`Topic analyses skipped: ${results.skipped.length}`);
  console.log(`Topic analyses failed: ${results.failed.length}`);
  console.log(`Warnings: ${results.warnings.length}`);
  if (results.failed.length > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Fatal error: ${error.message}`);
  process.exitCode = 1;
}

