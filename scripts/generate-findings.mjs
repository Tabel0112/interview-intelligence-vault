import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateFindings } from "../src/findingGenerator.mjs";
import { createOpenAiJsonClient } from "../src/openAiJsonClient.mjs";

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
  const summary = await generateFindings({ aiClient: lazyAiClient, projectPath, force });
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(`Fatal error: ${error.message}`);
  process.exitCode = 1;
}
