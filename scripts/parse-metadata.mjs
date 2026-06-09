import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAllTranscriptMetadata,
  writeMetadataFiles,
} from "../src/metadataParser.mjs";
import { loadRawTranscripts } from "../src/rawTranscriptLoader.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const vaultPath = path.resolve(scriptDirectory, "..", "vault");

let parsedCount = 0;
let filesWritten = 0;
let warningCount = 0;
let fatalErrors = 0;

try {
  const loaderWarnings = [];
  const transcripts = await loadRawTranscripts({
    vaultPath,
    onWarning: (message) => loaderWarnings.push(message),
  });
  const metadata = parseAllTranscriptMetadata(transcripts);
  const result = await writeMetadataFiles(metadata, { vaultPath });

  parsedCount = metadata.length;
  filesWritten = result.metadataFilesWritten + 1;
  warningCount =
    loaderWarnings.length +
    metadata.reduce((total, item) => total + item.warnings.length, 0);

  for (const warning of loaderWarnings) {
    console.warn(`Warning: ${warning}`);
  }
} catch (error) {
  fatalErrors += 1;
  console.error(`Fatal error: ${error.message}`);
  process.exitCode = 1;
}

console.log(`Transcripts parsed: ${parsedCount}`);
console.log(`Metadata files written: ${filesWritten}`);
console.log(`Warnings: ${warningCount}`);
console.log(`Fatal errors: ${fatalErrors}`);

