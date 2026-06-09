import path from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenAiJsonClient } from "../src/openAiJsonClient.mjs";
import { classifyAllEvidenceTags } from "../src/tagThemeDecisionAgent.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectPath = path.resolve(scriptDirectory, "..");
const force = process.argv.slice(2).includes("--force");
let realClient = null;
const lazyAiClient = {
  async generateJson(request) {
    realClient ??= createOpenAiJsonClient();
    return realClient.generateJson(request);
  },
};

try {
  const results = await classifyAllEvidenceTags({
    aiClient: lazyAiClient,
    projectPath,
    force,
  });
  for (const warning of results.warnings) console.warn(`Warning: ${warning}`);
  for (const failure of results.failed) {
    console.error(`Failed ${failure.evidence_id}: ${failure.error}`);
  }
  console.log(`Tag decisions written: ${results.written.length}`);
  console.log(`Tag decisions skipped: ${results.skipped.length}`);
  console.log(`Tag decisions failed: ${results.failed.length}`);
  console.log(`Warnings: ${results.warnings.length}`);
  if (results.failed.length > 0) process.exitCode = 1;
} catch (error) {
  console.error(`Fatal error: ${error.message}`);
  process.exitCode = 1;
}
