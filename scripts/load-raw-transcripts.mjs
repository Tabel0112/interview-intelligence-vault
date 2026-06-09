import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRawTranscripts } from "../src/rawTranscriptLoader.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const vaultPath = path.resolve(scriptDirectory, "..", "vault");

try {
  const transcripts = await loadRawTranscripts({ vaultPath });

  console.log(`Loaded ${transcripts.length} raw transcript(s).`);
  console.table(
    transcripts.map(({ transcript_id, filePath, fileHash, lastModified }) => ({
      transcript_id,
      filePath,
      fileHash,
      lastModified,
    })),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

