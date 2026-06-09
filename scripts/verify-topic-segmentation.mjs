import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { createOpenAiJsonClient } from "../src/openAiJsonClient.mjs";
import {
  segmentTranscriptTopics,
  shouldSkipTopicSegmentation,
  writeTopicSegmentationFile,
} from "../src/topicSegmentationAgent.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "topic-segmentation-"));
const vaultPath = path.join(tempRoot, "vault");
const rawDirectory = path.join(vaultPath, "01 Transcripts", "Raw");
const processedDirectory = path.join(vaultPath, "01 Transcripts", "Processed");
const topicDirectory = path.join(vaultPath, "02 Topic Analyses");

function makeProcessed(turnCount = 4, transcriptId = "topic_fixture") {
  return {
    schema_version: "processed_transcript.v1",
    analysis_version: "v1",
    generated: true,
    generator: "transcript_pipeline",
    transcript_id: transcriptId,
    metadata: {
      title: "Topic Fixture",
      source_file: "Topic Fixture.md",
      participants: ["Andy"],
      language: null,
      interview_date: null,
    },
    turns: Array.from({ length: turnCount }, (_, index) => ({
      turn_id: `turn_${String(index + 1).padStart(3, "0")}`,
      speaker: index % 2 ? "Unknown" : "Andy",
      speaker_id: index % 2 ? "speaker_unknown" : "speaker_andy",
      text: `Turn ${index + 1} opening sentence. Turn ${index + 1} closing sentence.`,
      position: index + 1,
      source_line_start: index + 1,
      source_line_end: index + 1,
    })),
    summaries: [],
    topics: [],
    evidence_candidates: [],
    source: {
      raw_path: "vault/01 Transcripts/Raw/Topic Fixture.md",
      raw_filename: "Topic Fixture.md",
      source_hash: "raw-hash",
      modified_at: "2026-06-09T01:00:00.000Z",
    },
    processed_at: "2026-06-09T01:30:00.000Z",
    warnings: [],
  };
}

function topic(topicNumber, startTurn, endTurn, keySpans = []) {
  return {
    topic_id: `topic_${String(topicNumber).padStart(3, "0")}`,
    title: `Topic ${topicNumber}`,
    start_turn: startTurn,
    end_turn: endTurn,
    summary: `Summary ${topicNumber}`,
    key_spans: keySpans,
  };
}

function validResponse(turnCount = 4) {
  return {
    segments: [
      {
        segment_id: "turn_002_seg_001",
        turn_id: "turn_002",
        anchor_start: "Turn 2 opening sentence.",
        anchor_end: "Turn 2 closing sentence.",
        summary: "Important bridge.",
      },
    ],
    topics: [
      topic(1, "turn_001", "turn_002", [
        { segment_id: "turn_002_seg_001", reason: "Supports first topic." },
      ]),
      topic(2, "turn_003", `turn_${String(turnCount).padStart(3, "0")}`, [
        { segment_id: "turn_002_seg_001", reason: "Bridges second topic." },
      ]),
    ],
  };
}

function mockAi(response, model = "mock-topic-model") {
  return {
    model,
    async generateJson() {
      return { json: structuredClone(response), model };
    },
  };
}

async function segment(processed, response, options = {}) {
  return segmentTranscriptTopics(processed, mockAi(response), {
    prompt: "mock prompt",
    sourceProcessedFile: `vault/01 Transcripts/Processed/${processed.transcript_id}.processed.json`,
    sourceSha256: options.sourceSha256 ?? "processed-sha",
    generatedAt: options.generatedAt ?? "2026-06-09T02:00:00.000Z",
  });
}

async function rejects(processed, response, pattern) {
  await assert.rejects(segment(processed, response), pattern);
}

try {
  await mkdir(rawDirectory, { recursive: true });
  await mkdir(processedDirectory, { recursive: true });
  const rawPath = path.join(rawDirectory, "Topic Fixture.md");
  await writeFile(rawPath, "raw source truth", "utf8");
  const rawBefore = {
    text: await readFile(rawPath, "utf8"),
    modified: (await stat(rawPath)).mtimeMs,
  };

  const processed = makeProcessed();
  const valid = await segment(processed, validResponse());
  assert.equal(valid.schema, "topic_segmentation.v1");
  assert.equal(valid.model, "mock-topic-model");
  assert.equal(valid.segments[0].start_char, 0);
  assert.equal(
    processed.turns[1].text.slice(
      valid.segments[0].start_char,
      valid.segments[0].end_char,
    ),
    processed.turns[1].text,
  );
  assert(!("anchor_start" in valid.segments[0]));
  assert(!("anchor_end" in valid.segments[0]));
  assert.equal(valid.topics[0].key_spans[0].segment_id, "turn_002_seg_001");
  assert.equal(valid.topics[1].key_spans[0].segment_id, "turn_002_seg_001");

  const outputPath = await writeTopicSegmentationFile(valid, { vaultPath });
  assert.equal(
    outputPath,
    path.join(topicDirectory, "topic_fixture.topics.json"),
  );
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), valid);
  assert.equal(
    await shouldSkipTopicSegmentation(outputPath, "processed-sha"),
    true,
  );
  assert.equal(
    await shouldSkipTopicSegmentation(outputPath, "processed-sha", {
      force: true,
    }),
    false,
  );
  const forced = await segment(processed, validResponse(), {
    generatedAt: "2026-06-09T03:00:00.000Z",
  });
  await writeTopicSegmentationFile(forced, { vaultPath });
  assert.equal(
    JSON.parse(await readFile(outputPath, "utf8")).generated_at,
    "2026-06-09T03:00:00.000Z",
  );
  assert.throws(
    () => createOpenAiJsonClient({ apiKey: "", fetchImpl: async () => {} }),
    /OPENAI_API_KEY/,
  );
  let openAiRequestBody = null;
  const adapter = createOpenAiJsonClient({
    apiKey: "mock-key",
    model: "mock-openai-model",
    fetchImpl: async (_url, options) => {
      openAiRequestBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            model: "mock-openai-model",
            output_text: JSON.stringify(validResponse()),
          };
        },
      };
    },
  });
  const adapterResult = await adapter.generateJson({
    prompt: "mock prompt",
    input: { turns: [] },
    schema: { type: "object" },
  });
  assert.equal(openAiRequestBody.text.format.type, "json_schema");
  assert.equal(adapterResult.model, "mock-openai-model");
  assert(Array.isArray(adapterResult.json.topics));
  assert.equal(
    await shouldSkipTopicSegmentation(outputPath, "different-sha"),
    false,
  );

  await assert.rejects(
    segmentTranscriptTopics(
      processed,
      {
        async generateJson() {
          return "{bad json";
        },
      },
      {},
    ),
    /Invalid JSON/,
  );
  await rejects(processed, { topics: [] }, /segments must be an array/);

  const gap = validResponse();
  gap.topics[1].start_turn = "turn_004";
  await rejects(processed, gap, /gap or overlap|cover every turn/);

  const overlap = validResponse();
  overlap.topics[1].start_turn = "turn_002";
  await rejects(processed, overlap, /gap or overlap/);

  const missingTurn = validResponse();
  missingTurn.topics[0].end_turn = "turn_999";
  await rejects(processed, missingTurn, /nonexistent end_turn/);

  const wrongTopicId = validResponse();
  wrongTopicId.topics[1].topic_id = "topic_003";
  await rejects(processed, wrongTopicId, /Expected topic_id/);

  const missingAnchor = validResponse();
  missingAnchor.segments[0].anchor_start = "not present";
  await rejects(processed, missingAnchor, /could not be matched uniquely/);

  const duplicateSegment = validResponse();
  duplicateSegment.segments.push(structuredClone(duplicateSegment.segments[0]));
  await rejects(processed, duplicateSegment, /Duplicate segment_id|overlap/);

  const nonexistentSegmentTurn = validResponse();
  nonexistentSegmentTurn.segments[0].segment_id = "turn_999_seg_001";
  nonexistentSegmentTurn.segments[0].turn_id = "turn_999";
  await rejects(processed, nonexistentSegmentTurn, /missing turn_id/);

  const overlappingSegments = validResponse();
  overlappingSegments.segments = [
    {
      segment_id: "turn_002_seg_001",
      turn_id: "turn_002",
      anchor_start: "Turn 2 opening sentence.",
      anchor_end: "Turn 2 closing sentence.",
      summary: "Full turn.",
    },
    {
      segment_id: "turn_002_seg_002",
      turn_id: "turn_002",
      anchor_start: "Turn 2 closing sentence.",
      anchor_end: "Turn 2 closing sentence.",
      summary: "Overlapping ending.",
    },
  ];
  overlappingSegments.topics.forEach((item) => {
    item.key_spans = [];
  });
  await rejects(processed, overlappingSegments, /Segments overlap/);

  const missingKeySpan = validResponse();
  missingKeySpan.topics[0].key_spans[0].segment_id = "turn_001_seg_999";
  await rejects(processed, missingKeySpan, /missing segment_id/);

  const normalLong = makeProcessed(40, "normal_long");
  const tooFew = {
    segments: [],
    topics: [topic(1, "turn_001", "turn_040")],
  };
  const tooFewOutput = await segment(normalLong, tooFew);
  assert(tooFewOutput.warnings.some((item) => item.code === "TOPIC_COUNT_LOW"));

  const tooMany = {
    segments: [],
    topics: Array.from({ length: 16 }, (_, index) => {
      const start = index === 15 ? 31 : index * 2 + 1;
      const end = index === 15 ? 40 : index * 2 + 2;
      return topic(
        index + 1,
        `turn_${String(start).padStart(3, "0")}`,
        `turn_${String(end).padStart(3, "0")}`,
      );
    }),
  };
  const tooManyOutput = await segment(normalLong, tooMany);
  assert(tooManyOutput.warnings.some((item) => item.code === "TOPIC_COUNT_HIGH"));

  const shortOutput = await segment(makeProcessed(4, "short"), {
    segments: [],
    topics: [topic(1, "turn_001", "turn_004")],
  });
  assert(!shortOutput.warnings.some((item) => item.code === "TOPIC_COUNT_LOW"));

  let failures = 0;
  let writes = 0;
  for (const [fixture, response] of [
    [makeProcessed(4, "failed_fixture"), gap],
    [makeProcessed(4, "continued_fixture"), validResponse()],
  ]) {
    try {
      const result = await segment(fixture, response);
      await writeTopicSegmentationFile(result, { vaultPath });
      writes += 1;
    } catch {
      failures += 1;
    }
  }
  assert.equal(failures, 1);
  assert.equal(writes, 1);

  const files = await readdir(topicDirectory);
  assert(files.includes("topic_fixture.topics.json"));
  assert(files.includes("continued_fixture.topics.json"));
  assert(files.every((fileName) => !fileName.includes(".tmp-")));
  assert.equal(await readFile(rawPath, "utf8"), rawBefore.text);
  assert.equal((await stat(rawPath)).mtimeMs, rawBefore.modified);

  const topicFileHash = createHash("sha256")
    .update(await readFile(outputPath))
    .digest("hex");
  assert(nonEmptyString(topicFileHash));

  console.log("Topic segmentation verification passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
