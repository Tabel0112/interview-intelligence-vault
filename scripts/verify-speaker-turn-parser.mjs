import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadRawTranscripts } from "../src/rawTranscriptLoader.mjs";
import {
  detectSpeakerLabel,
  normalizeSpeakerId,
  parseSpeakerTurns,
  writeProcessedTranscript,
} from "../src/speakerTurnParser.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "speaker-turn-parser-"));
const rawDirectory = path.join(tempRoot, "01 Transcripts", "Raw");
const rawFileName = "Speaker Test.md";
const rawText = `Interview preamble
Note: this is not a speaker

**Andy：** Hello
Andy: second turn
**Aloha:** Hi
**Kiwi Yeah**: First line
second line
third line
**Andy**：
Hello below
**Empty：**
**Aloha：** Yeah`;

try {
  assert.deepEqual(detectSpeakerLabel("**Andy：** Hello"), {
    type: "speaker",
    speaker: "Andy",
    text: "Hello",
    labelStyle: "bold",
  });
  assert.equal(detectSpeakerLabel("**Andy:** Hello").speaker, "Andy");
  assert.equal(detectSpeakerLabel("**Andy**: Hello").speaker, "Andy");
  assert.equal(detectSpeakerLabel("**Andy**：Hello").speaker, "Andy");
  assert.equal(detectSpeakerLabel("**Andy：**").text, "");
  assert.equal(
    detectSpeakerLabel("Andy: Hello", { knownSpeakers: ["Andy"] }).speaker,
    "Andy",
  );
  assert.equal(detectSpeakerLabel("I was thinking: maybe this is too hard.").type, "suspicious");
  assert.equal(detectSpeakerLabel("Note: this is not a speaker").type, "suspicious");
  assert.equal(normalizeSpeakerId("Kiwi Yeah"), "speaker_kiwi_yeah");

  await mkdir(rawDirectory, { recursive: true });
  const rawPath = path.join(rawDirectory, rawFileName);
  await writeFile(rawPath, rawText, "utf8");
  const rawBefore = {
    text: await readFile(rawPath, "utf8"),
    modified: (await stat(rawPath)).mtimeMs,
  };

  const [rawTranscript] = await loadRawTranscripts({ vaultPath: tempRoot });
  const processed = parseSpeakerTurns(rawTranscript);

  assert.equal(processed.transcript_id, "speaker_test");
  assert.equal(processed.source_file, rawFileName);
  assert.equal(processed.parser_version, "speaker-turn-parser-v1");
  assert.equal(
    processed.preamble_text,
    "Interview preamble\nNote: this is not a speaker",
  );
  assert.deepEqual(processed.speakers, ["Andy", "Aloha", "Kiwi Yeah"]);
  assert.equal(processed.turns.length, 6);
  assert.deepEqual(processed.turns[0], {
    turn_id: "turn_001",
    speaker: "Andy",
    speaker_id: "speaker_andy",
    text: "Hello",
    position: 1,
    source_line_start: 4,
    source_line_end: 4,
  });
  assert.deepEqual(processed.turns[1], {
    turn_id: "turn_002",
    speaker: "Andy",
    speaker_id: "speaker_andy",
    text: "second turn",
    position: 2,
    source_line_start: 5,
    source_line_end: 5,
  });
  assert.equal(processed.turns[3].text, "First line\nsecond line\nthird line");
  assert.equal(processed.turns[3].source_line_start, 7);
  assert.equal(processed.turns[3].source_line_end, 9);
  assert.equal(processed.turns[4].text, "Hello below");
  assert.equal(processed.turns[4].source_line_start, 10);
  assert.equal(processed.turns[4].source_line_end, 11);
  assert(
    processed.warnings.some(
      (item) => item.code === "SUSPICIOUS_SPEAKER_LABEL_IGNORED" && item.line === 2,
    ),
  );
  assert(
    processed.warnings.some(
      (item) => item.code === "EMPTY_TURN_SKIPPED" && item.line === 12,
    ),
  );

  const noTurnsText = "Preamble only\nNote: still not a known speaker";
  const noTurns = parseSpeakerTurns({
    transcript_id: "no_turns",
    fileName: "No Turns.md",
    fileHash: "hash",
    rawText: noTurnsText,
  });
  assert.equal(noTurns.preamble_text, noTurnsText);
  assert.deepEqual(noTurns.turns, []);
  assert.deepEqual(noTurns.speakers, []);
  assert(noTurns.warnings.some((item) => item.code === "NO_SPEAKER_TURNS_FOUND"));

  const metadataKnown = parseSpeakerTurns(
    {
      transcript_id: "metadata_known",
      fileName: "Metadata Known.md",
      fileHash: "hash",
      rawText: "Aloha: Known from metadata",
    },
    { knownSpeakers: ["Aloha"] },
  );
  assert.equal(metadataKnown.turns.length, 1);
  assert.equal(metadataKnown.turns[0].speaker, "Aloha");

  const metadataWarning = {
    code: "METADATA_SPEAKER_LOAD_FAILED",
    line: null,
    message: "Could not load metadata speakers: fixture error",
  };
  const withMetadataWarning = parseSpeakerTurns(
    {
      transcript_id: "metadata_warning",
      fileName: "Metadata Warning.md",
      fileHash: "hash",
      rawText: "**Andy:** Hello",
    },
    { warnings: [metadataWarning] },
  );
  assert(withMetadataWarning.warnings.includes(metadataWarning));

  const outputPath = await writeProcessedTranscript(processed, {
    vaultPath: tempRoot,
  });
  assert.equal(
    outputPath,
    path.join(
      tempRoot,
      "01 Transcripts",
      "Processed",
      "speaker_test.processed.json",
    ),
  );
  const processedFiles = await readdir(
    path.join(tempRoot, "01 Transcripts", "Processed"),
  );
  assert.deepEqual(processedFiles, ["speaker_test.processed.json"]);
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), processed);
  await assert.rejects(
    writeProcessedTranscript(
      { ...processed, transcript_id: "../outside-processed-directory" },
      { vaultPath: tempRoot },
    ),
    /canonical transcript_id/,
  );

  assert.equal(await readFile(rawPath, "utf8"), rawBefore.text);
  assert.equal((await stat(rawPath)).mtimeMs, rawBefore.modified);

  console.log("Speaker turn parser verification passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
