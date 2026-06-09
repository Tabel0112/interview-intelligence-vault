import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRawTranscripts } from "../src/rawTranscriptLoader.mjs";
import {
  parseSpeakerTurns,
  writeProcessedTranscript,
} from "../src/speakerTurnParser.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const vaultPath = path.resolve(scriptDirectory, "..", "vault");
const metadataIndexPath = path.join(
  vaultPath,
  "02 Transcripts",
  "Metadata",
  "metadata_index.json",
);

async function loadKnownSpeakersByTranscript() {
  try {
    const metadata = JSON.parse(await readFile(metadataIndexPath, "utf8"));
    return {
      speakersByTranscript: new Map(
        metadata.map((item) => [
          item.transcript_id,
          Array.isArray(item.participants) ? item.participants : [],
        ]),
      ),
      warning: null,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { speakersByTranscript: new Map(), warning: null };
    }

    return {
      speakersByTranscript: new Map(),
      warning: {
        code: "METADATA_SPEAKER_LOAD_FAILED",
        line: null,
        message: `Could not load metadata speakers: ${error.message}`,
      },
    };
  }
}

let rawCount = 0;
let writtenCount = 0;
let totalTurns = 0;
let totalWarnings = 0;
const zeroTurnTranscripts = [];

try {
  const loaderWarnings = [];
  const rawTranscripts = await loadRawTranscripts({
    vaultPath,
    onWarning: (message) => loaderWarnings.push(message),
  });
  const { speakersByTranscript, warning } = await loadKnownSpeakersByTranscript();
  rawCount = rawTranscripts.length;
  totalWarnings += loaderWarnings.length;

  for (const transcript of rawTranscripts) {
    const processed = parseSpeakerTurns(transcript, {
      knownSpeakers: speakersByTranscript.get(transcript.transcript_id) ?? [],
      warnings: warning ? [warning] : [],
    });
    await writeProcessedTranscript(processed, { vaultPath });
    writtenCount += 1;
    totalTurns += processed.turns.length;
    totalWarnings += processed.warnings.length;
    if (processed.turns.length === 0) {
      zeroTurnTranscripts.push(processed.transcript_id);
    }
  }

  for (const loaderWarning of loaderWarnings) {
    console.warn(`Warning: ${loaderWarning}`);
  }
} catch (error) {
  console.error(`Fatal error: ${error.message}`);
  process.exitCode = 1;
}

console.log(`Raw transcripts processed: ${rawCount}`);
console.log(`Processed JSON files written: ${writtenCount}`);
console.log(`Total turns parsed: ${totalTurns}`);
console.log(`Total warnings: ${totalWarnings}`);
console.log(
  `Transcripts with zero turns: ${
    zeroTurnTranscripts.length ? zeroTurnTranscripts.join(", ") : "none"
  }`,
);

