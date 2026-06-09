import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildProcessedTranscript,
  writeProcessedTranscript,
} from "../src/processedTranscriptWriter.mjs";
import { loadRawTranscripts } from "../src/rawTranscriptLoader.mjs";
import { parseSpeakerTurns } from "../src/speakerTurnParser.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const vaultPath = path.resolve(scriptDirectory, "..", "vault");
const metadataIndexPath = path.join(
  vaultPath,
  "02 Transcripts",
  "Metadata",
  "metadata_index.json",
);
const force = process.argv.slice(2).includes("--force");

async function loadMetadataByTranscript() {
  try {
    const metadata = JSON.parse(await readFile(metadataIndexPath, "utf8"));
    if (!Array.isArray(metadata)) {
      throw new Error("metadata_index.json must contain an array");
    }
    return {
      metadataByTranscript: new Map(
        metadata.map((item) => [item.transcript_id, item]),
      ),
      warning: null,
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { metadataByTranscript: new Map(), warning: null };
    }

    return {
      metadataByTranscript: new Map(),
      warning: {
        code: "METADATA_SPEAKER_LOAD_FAILED",
        stage: "metadata_parser",
        line: null,
        message: `Could not load metadata speakers: ${error.message}`,
      },
    };
  }
}

let rawCount = 0;
let writtenCount = 0;
let skippedCount = 0;
let failedCount = 0;
let totalTurns = 0;
let totalWarnings = 0;
const zeroTurnTranscripts = [];
const failedTranscripts = [];

try {
  const loaderWarnings = [];
  const rawTranscripts = await loadRawTranscripts({
    vaultPath,
    onWarning: (message) => loaderWarnings.push(message),
  });
  const { metadataByTranscript, warning } = await loadMetadataByTranscript();
  rawCount = rawTranscripts.length;
  totalWarnings += loaderWarnings.length;

  for (const transcript of rawTranscripts) {
    try {
      const metadata = metadataByTranscript.get(transcript.transcript_id) ?? null;
      const speakerTurns = parseSpeakerTurns(transcript, {
        knownSpeakers: Array.isArray(metadata?.participants)
          ? metadata.participants
          : [],
        warnings: warning ? [warning] : [],
      });
      const processed = buildProcessedTranscript(
        transcript,
        metadata,
        speakerTurns,
      );
      const result = await writeProcessedTranscript(processed, {
        vaultPath,
        force,
      });

      if (result.status === "written") {
        writtenCount += 1;
      } else {
        skippedCount += 1;
      }
      totalTurns += speakerTurns.turns.length;
      totalWarnings += processed.warnings.length;
      if (speakerTurns.turns.length === 0) {
        zeroTurnTranscripts.push(processed.transcript_id);
      }
    } catch (error) {
      failedCount += 1;
      failedTranscripts.push(transcript.transcript_id);
      console.error(`Failed ${transcript.transcript_id}: ${error.message}`);
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
console.log(`Unchanged transcripts skipped: ${skippedCount}`);
console.log(`Failed transcripts: ${failedCount}`);
console.log(`Total turns parsed: ${totalTurns}`);
console.log(`Total warnings: ${totalWarnings}`);
console.log(
  `Transcripts with zero turns: ${
    zeroTurnTranscripts.length ? zeroTurnTranscripts.join(", ") : "none"
  }`,
);
console.log(
  `Failed transcript IDs: ${
    failedTranscripts.length ? failedTranscripts.join(", ") : "none"
  }`,
);
