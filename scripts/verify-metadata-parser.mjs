import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  parseAllTranscriptMetadata,
  writeMetadataFiles,
} from "../src/metadataParser.mjs";
import { loadRawTranscripts } from "../src/rawTranscriptLoader.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "metadata-parser-"));
const rawDirectory = path.join(tempRoot, "01 Transcripts", "Raw");

const files = {
  "Kiwi Yeah - Ailoha 368e47236f2d801295a1d80de8937aa7.md": `---
title: Kiwi Research Session
status: reviewed
category: Coffee Chat
date: May 21, 2026
participants: [Andy, Aloha, Andy]
created_time: 2026-05-20T10:00:00Z
last edited: 2026-05-21T11:30:00-04:00
---

Andy: Dialogue is not parsed as metadata.
`,
  "Plain Properties.md": `# Interview Notes

Status: needs cleanup
Type: Product Discovery
Interview Date: 2026/05/21
Interviewer: Abel and Aloha
Interviewee: Kiwi / Aloha

## Transcript
Speaker: This is dialogue.
`,
  "Missing Metadata.md": `Andy: Hello.
Aloha: Welcome.
`,
  "Ambiguous Date.md": `Date: 05/06/2026
Status: processed
Category: User Interview

Transcript begins here.
`,
  "Duplicate 11111111111111111111111111111111.md": `Status: verified
Category: user interview
Date: 2026-05-21
Participants: One
`,
  "Duplicate 22222222222222222222222222222222.md": `Status: verified
Category: user interview
Date: 2026-05-22
Participants: Two
`,
  "empty.md": " \n",
  "notes.txt": "not a transcript",
  ".hidden.md": "hidden",
};

try {
  await mkdir(path.join(rawDirectory, "nested"), { recursive: true });
  for (const [fileName, contents] of Object.entries(files)) {
    await writeFile(path.join(rawDirectory, fileName), contents, "utf8");
  }
  await writeFile(path.join(rawDirectory, "nested", "Nested.md"), "nested", "utf8");

  const unreadablePath = path.join(rawDirectory, "Unreadable.md");
  await writeFile(unreadablePath, "cannot read", "utf8");
  await chmod(unreadablePath, 0o000);

  const before = new Map();
  for (const fileName of Object.keys(files).filter((name) => name.endsWith(".md"))) {
    const filePath = path.join(rawDirectory, fileName);
    const fileStats = await stat(filePath);
    before.set(fileName, {
      contents: await readFile(filePath, "utf8"),
      modified: fileStats.mtimeMs,
    });
  }

  const loaderWarnings = [];
  const transcripts = await loadRawTranscripts({
    vaultPath: tempRoot,
    onWarning: (message) => loaderWarnings.push(message),
  });
  const metadata = parseAllTranscriptMetadata(transcripts);
  await writeMetadataFiles(metadata, { vaultPath: tempRoot });

  assert.equal(transcripts.length, 6);
  assert(loaderWarnings.some((warning) => warning.includes("empty.md")));
  assert(loaderWarnings.some((warning) => warning.includes("Unreadable.md")));
  for (const item of metadata) {
    assert.equal(
      item.transcript_id,
      transcripts.find((transcript) => transcript.fileName === item.source_file)
        .transcript_id,
    );
  }

  const yaml = metadata.find((item) => item.title === "Kiwi Research Session");
  assert.equal(yaml.transcript_id, "kiwi_yeah_ailoha");
  assert.equal(
    transcripts.find((item) => item.fileName === yaml.source_file).transcript_id,
    "kiwi_yeah_ailoha",
  );
  assert.equal(yaml.status, "verified");
  assert.equal(yaml.category, "coffee_chat");
  assert.equal(yaml.date, "2026-05-21");
  assert.deepEqual(yaml.participants, ["Andy", "Aloha"]);
  assert.equal(yaml.created_time, "2026-05-20T10:00:00.000Z");
  assert.equal(yaml.last_edited_time, "2026-05-21T15:30:00.000Z");

  const plain = metadata.find((item) => item.source_file === "Plain Properties.md");
  assert.equal(plain.status, "needs_review");
  assert.equal(plain.category, "product_discovery");
  assert.equal(plain.date, "2026-05-21");
  assert.deepEqual(plain.participants, ["Abel", "Aloha", "Kiwi"]);
  assert(
    plain.warnings.includes(
      "New category 'Product Discovery' normalized to 'product_discovery'",
    ),
  );

  const missing = metadata.find((item) => item.source_file === "Missing Metadata.md");
  assert.equal(missing.status, "unverified");
  assert.equal(missing.category, "uncategorized");
  assert.equal(missing.date, null);
  assert.deepEqual(missing.participants, []);
  assert(missing.warnings.includes("No participants found"));

  const ambiguous = metadata.find((item) => item.source_file === "Ambiguous Date.md");
  assert.equal(ambiguous.date, null);
  assert(
    ambiguous.warnings.includes(
      "Ambiguous date format '05/06/2026'; date set to null",
    ),
  );

  const duplicates = metadata.filter((item) => item.title === "Duplicate");
  assert.equal(duplicates.length, 2);
  assert.equal(duplicates.filter((item) => item.transcript_id === "duplicate").length, 1);
  assert.equal(
    duplicates.filter((item) => /^duplicate_[a-f0-9]{8}$/.test(item.transcript_id))
      .length,
    1,
  );
  assert(
    duplicates.some((item) =>
      item.warnings.some((warning) => warning.startsWith("Duplicate transcript_id")),
    ),
  );

  const index = JSON.parse(
    await readFile(
      path.join(tempRoot, "02 Transcripts", "Metadata", "metadata_index.json"),
      "utf8",
    ),
  );
  assert.deepEqual(
    index.map((item) => item.transcript_id),
    [...index.map((item) => item.transcript_id)].sort(),
  );
  for (const item of metadata) {
    await stat(
      path.join(
        tempRoot,
        "02 Transcripts",
        "Metadata",
        `${item.transcript_id}.metadata.json`,
      ),
    );
  }

  for (const [fileName, snapshot] of before) {
    const filePath = path.join(rawDirectory, fileName);
    const fileStats = await stat(filePath);
    assert.equal(await readFile(filePath, "utf8"), snapshot.contents);
    assert.equal(fileStats.mtimeMs, snapshot.modified);
  }

  const duplicateLoaderRoot = path.join(tempRoot, "duplicate-loader");
  const duplicateLoaderRaw = path.join(duplicateLoaderRoot, "01 Transcripts", "Raw");
  await mkdir(duplicateLoaderRaw, { recursive: true });
  await writeFile(path.join(duplicateLoaderRaw, "Same!.md"), "one", "utf8");
  await writeFile(path.join(duplicateLoaderRaw, "Same?.md"), "two", "utf8");
  const duplicateLoaderWarnings = [];
  const duplicateLoaderResults = await loadRawTranscripts({
    vaultPath: duplicateLoaderRoot,
    onWarning: (message) => duplicateLoaderWarnings.push(message),
  });
  assert.deepEqual(
    duplicateLoaderResults.map((item) => item.transcript_id).sort(),
    [
      "same",
      duplicateLoaderResults
        .map((item) => item.transcript_id)
        .find((id) => /^same_[a-f0-9]{8}$/.test(id)),
    ].sort(),
  );
  assert(
    duplicateLoaderWarnings.some((warning) =>
      warning.startsWith("Duplicate transcript_id"),
    ),
  );

  console.log("Metadata parser verification passed.");
} finally {
  await chmod(path.join(rawDirectory, "Unreadable.md"), 0o600).catch(() => {});
  await rm(tempRoot, { recursive: true, force: true });
}
