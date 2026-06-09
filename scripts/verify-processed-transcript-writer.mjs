import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ANALYSIS_VERSION,
  GENERATOR,
  PROCESSED_TRANSCRIPT_SCHEMA_VERSION,
  buildProcessedTranscript,
  validateProcessedTranscript,
  writeProcessedTranscript,
} from "../src/processedTranscriptWriter.mjs";
import { loadRawTranscripts } from "../src/rawTranscriptLoader.mjs";
import { parseSpeakerTurns } from "../src/speakerTurnParser.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "processed-writer-"));
const rawDirectory = path.join(tempRoot, "01 Transcripts", "Raw");
const rawFileName = "Writer Test.md";
const rawText = "**Andy:** Original wording\n**Aloha:** Reply";

try {
  await mkdir(rawDirectory, { recursive: true });
  const rawPath = path.join(rawDirectory, rawFileName);
  await writeFile(rawPath, rawText, "utf8");
  const rawBefore = {
    text: await readFile(rawPath, "utf8"),
    modified: (await stat(rawPath)).mtimeMs,
  };

  const [rawTranscript] = await loadRawTranscripts({ vaultPath: tempRoot });
  const metadata = {
    transcript_id: rawTranscript.transcript_id,
    source_file: rawFileName,
    source_hash: rawTranscript.fileHash,
    title: "Writer Test",
    participants: ["Andy", "Aloha"],
    date: "2026-06-09",
    warnings: ["Metadata fixture warning"],
  };
  const speakerTurns = parseSpeakerTurns(rawTranscript, {
    knownSpeakers: metadata.participants,
  });
  const processed = buildProcessedTranscript(
    rawTranscript,
    metadata,
    speakerTurns,
  );

  assert.equal(processed.schema_version, PROCESSED_TRANSCRIPT_SCHEMA_VERSION);
  assert.equal(processed.analysis_version, ANALYSIS_VERSION);
  assert.equal(processed.generated, true);
  assert.equal(processed.generator, GENERATOR);
  assert.equal(processed.transcript_id, "writer_test");
  assert.deepEqual(processed.metadata, {
    title: "Writer Test",
    source_file: rawFileName,
    participants: ["Andy", "Aloha"],
    language: null,
    interview_date: "2026-06-09",
  });
  assert.deepEqual(processed.summaries, []);
  assert.deepEqual(processed.topics, []);
  assert.deepEqual(processed.evidence_candidates, []);
  assert.equal(processed.source.raw_path, "vault/01 Transcripts/Raw/Writer Test.md");
  assert.equal(processed.source.raw_filename, rawFileName);
  assert.equal(processed.source.source_hash, rawTranscript.fileHash);
  assert.equal(processed.source.modified_at, rawTranscript.lastModified);
  assert.equal(processed.processed_at, null);
  assert.equal(processed.warnings[0].stage, "metadata_parser");

  const firstWrite = await writeProcessedTranscript(processed, {
    vaultPath: tempRoot,
    now: () => new Date("2026-06-09T01:30:00.000Z"),
  });
  assert.equal(firstWrite.status, "written");
  assert.equal(
    firstWrite.outputPath,
    path.join(
      tempRoot,
      "01 Transcripts",
      "Processed",
      "writer_test.processed.json",
    ),
  );
  assert.equal(
    firstWrite.processedTranscript.processed_at,
    "2026-06-09T01:30:00.000Z",
  );
  assert.deepEqual(validateProcessedTranscript(firstWrite.processedTranscript), []);
  assert((await readFile(firstWrite.outputPath, "utf8")).endsWith("\n"));

  const skipped = await writeProcessedTranscript(processed, {
    vaultPath: tempRoot,
    now: () => new Date("2026-06-09T02:00:00.000Z"),
  });
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.processedTranscript.processed_at, "2026-06-09T01:30:00.000Z");

  const changedSource = {
    ...processed,
    source: { ...processed.source, source_hash: "changed-source-hash" },
  };
  const changedWrite = await writeProcessedTranscript(changedSource, {
    vaultPath: tempRoot,
    now: () => new Date("2026-06-09T02:15:00.000Z"),
  });
  assert.equal(changedWrite.status, "written");
  assert.equal(
    changedWrite.processedTranscript.processed_at,
    "2026-06-09T02:15:00.000Z",
  );

  const forced = await writeProcessedTranscript(processed, {
    vaultPath: tempRoot,
    force: true,
    now: () => new Date("2026-06-09T02:30:00.000Z"),
  });
  assert.equal(forced.status, "written");
  assert.equal(forced.processedTranscript.processed_at, "2026-06-09T02:30:00.000Z");

  const validExistingContents = await readFile(forced.outputPath, "utf8");
  const invalid = {
    ...processed,
    turns: [{ ...processed.turns[0], position: "invalid" }],
  };
  await assert.rejects(
    writeProcessedTranscript(invalid, {
      vaultPath: tempRoot,
      force: true,
      now: () => new Date("2026-06-09T03:00:00.000Z"),
    }),
    /Processed transcript validation failed/,
  );
  assert.equal(await readFile(forced.outputPath, "utf8"), validExistingContents);

  await assert.rejects(
    writeProcessedTranscript(
      { ...processed, transcript_id: "../outside" },
      { vaultPath: tempRoot, force: true },
    ),
    /canonical transcript_id/,
  );

  const continuedValid = {
    ...processed,
    transcript_id: "continued_valid",
    source: {
      ...processed.source,
      raw_filename: "Continued Valid.md",
      raw_path: "vault/01 Transcripts/Raw/Continued Valid.md",
    },
  };
  let failures = 0;
  let writes = 0;
  for (const item of [invalid, continuedValid]) {
    try {
      const result = await writeProcessedTranscript(item, {
        vaultPath: tempRoot,
        force: true,
        now: () => new Date("2026-06-09T04:00:00.000Z"),
      });
      writes += result.status === "written" ? 1 : 0;
    } catch {
      failures += 1;
    }
  }
  assert.equal(failures, 1);
  assert.equal(writes, 1);

  const processedFiles = await readdir(
    path.join(tempRoot, "01 Transcripts", "Processed"),
  );
  assert(processedFiles.includes("writer_test.processed.json"));
  assert(processedFiles.includes("continued_valid.processed.json"));
  assert(processedFiles.every((fileName) => !fileName.includes(".tmp-")));

  assert.equal(await readFile(rawPath, "utf8"), rawBefore.text);
  assert.equal((await stat(rawPath)).mtimeMs, rawBefore.modified);

  console.log("Processed transcript writer verification passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
