import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isCanonicalTranscriptId } from "./transcriptId.mjs";

export const TOPIC_SEGMENTATION_SCHEMA = "topic_segmentation.v1";
export const TOPIC_SEGMENTATION_PROMPT_PATH =
  "vault/99 System/Agents/Topic_Segmentation_Agent.md";

const TOPIC_ANALYSES_PATH = path.join("02 Topic Analyses");
const SEGMENT_ID_PATTERN = /^(turn_\d+)_seg_\d+$/;

export const TOPIC_SEGMENTATION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["segments", "topics"],
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "segment_id",
          "turn_id",
          "anchor_start",
          "anchor_end",
          "summary",
        ],
        properties: {
          segment_id: { type: "string" },
          turn_id: { type: "string" },
          anchor_start: { type: "string" },
          anchor_end: { type: "string" },
          summary: { type: "string" },
        },
      },
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "topic_id",
          "title",
          "start_turn",
          "end_turn",
          "summary",
          "key_spans",
        ],
        properties: {
          topic_id: { type: "string" },
          title: { type: "string" },
          start_turn: { type: "string" },
          end_turn: { type: "string" },
          summary: { type: "string" },
          key_spans: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["segment_id", "reason"],
              properties: {
                segment_id: { type: "string" },
                reason: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function qualityWarning(code, message) {
  return {
    code,
    stage: "topic_segmentation",
    line: null,
    message,
  };
}

function structuralError(errors) {
  return new Error(`Topic segmentation validation failed: ${errors.join("; ")}`);
}

export async function loadTopicSegmentationPrompt({
  projectPath = process.cwd(),
  promptPath = TOPIC_SEGMENTATION_PROMPT_PATH,
} = {}) {
  return readFile(path.resolve(projectPath, promptPath), "utf8");
}

export function buildTopicSegmentationInput(processedTranscript) {
  if (!isCanonicalTranscriptId(processedTranscript?.transcript_id)) {
    throw new Error("Topic segmentation requires canonical transcript_id");
  }
  if (!Array.isArray(processedTranscript.turns)) {
    throw new Error("Topic segmentation requires processed transcript turns");
  }

  return {
    transcript_id: processedTranscript.transcript_id,
    metadata: processedTranscript.metadata ?? {},
    turns: processedTranscript.turns.map(
      ({ turn_id, speaker, speaker_id, text, position }) => ({
        turn_id,
        speaker,
        speaker_id,
        text,
        position,
      }),
    ),
  };
}

export function parseTopicSegmentationResponse(response) {
  const value = response?.json ?? response?.output ?? response;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid JSON from topic segmentation AI: ${error.message}`);
    }
  }
  if (!isObject(value)) {
    throw new Error("Invalid topic segmentation AI response");
  }
  return value;
}

function validateAiResponseShape(parsed) {
  const errors = [];
  if (!Array.isArray(parsed.segments)) {
    errors.push("segments must be an array");
  } else {
    parsed.segments.forEach((segment, index) => {
      if (!isObject(segment)) {
        errors.push(`segments[${index}] must be an object`);
        return;
      }
      for (const field of [
        "segment_id",
        "turn_id",
        "anchor_start",
        "anchor_end",
        "summary",
      ]) {
        if (typeof segment[field] !== "string") {
          errors.push(`segments[${index}].${field} must be a string`);
        }
      }
    });
  }
  if (!Array.isArray(parsed.topics)) {
    errors.push("topics must be an array");
  } else {
    parsed.topics.forEach((topic, index) => {
      if (!isObject(topic)) {
        errors.push(`topics[${index}] must be an object`);
        return;
      }
      for (const field of [
        "topic_id",
        "title",
        "start_turn",
        "end_turn",
        "summary",
      ]) {
        if (typeof topic[field] !== "string") {
          errors.push(`topics[${index}].${field} must be a string`);
        }
      }
      if (!Array.isArray(topic.key_spans)) {
        errors.push(`topics[${index}].key_spans must be an array`);
      } else {
        topic.key_spans.forEach((keySpan, keySpanIndex) => {
          if (!isObject(keySpan)) {
            errors.push(
              `topics[${index}].key_spans[${keySpanIndex}] must be an object`,
            );
            return;
          }
          if (typeof keySpan.segment_id !== "string") {
            errors.push(
              `topics[${index}].key_spans[${keySpanIndex}].segment_id must be a string`,
            );
          }
          if (!nonEmptyString(keySpan.reason)) {
            errors.push(
              `topics[${index}].key_spans[${keySpanIndex}].reason must be non-empty`,
            );
          }
        });
      }
    });
  }
  if (errors.length > 0) {
    throw structuralError(errors);
  }
}

function allIndexes(text, search, fromIndex = 0) {
  const indexes = [];
  let index = text.indexOf(search, fromIndex);
  while (index !== -1) {
    indexes.push(index);
    index = text.indexOf(search, index + 1);
  }
  return indexes;
}

function resolveAnchorRange(turnText, anchorStart, anchorEnd, segmentId) {
  if (!nonEmptyString(anchorStart) || !nonEmptyString(anchorEnd)) {
    throw new Error(`Segment ${segmentId} anchors must be non-empty`);
  }

  const candidates = new Map();
  for (const startChar of allIndexes(turnText, anchorStart)) {
    const endSearchStart =
      anchorStart === anchorEnd ? startChar : startChar + anchorStart.length;
    for (const endIndex of allIndexes(turnText, anchorEnd, endSearchStart)) {
      const endChar = endIndex + anchorEnd.length;
      if (endChar >= startChar + anchorStart.length) {
        candidates.set(`${startChar}:${endChar}`, { startChar, endChar });
      }
    }
  }

  if (candidates.size !== 1) {
    throw new Error(
      `Segment ${segmentId} anchors could not be matched uniquely`,
    );
  }
  return [...candidates.values()][0];
}

export function convertSegmentAnchorsToOffsets(aiSegments, processedTranscript) {
  if (!Array.isArray(aiSegments)) {
    throw new Error("Topic segmentation response must include segments array");
  }
  const turns = new Map(
    processedTranscript.turns.map((turn) => [turn.turn_id, turn]),
  );

  return aiSegments.map((segment) => {
    const turn = turns.get(segment.turn_id);
    if (!turn) {
      throw new Error(`Segment ${segment.segment_id} references missing turn_id`);
    }
    const { startChar, endChar } = resolveAnchorRange(
      turn.text,
      segment.anchor_start,
      segment.anchor_end,
      segment.segment_id,
    );
    return {
      segment_id: segment.segment_id,
      turn_id: segment.turn_id,
      start_char: startChar,
      end_char: endChar,
      summary: segment.summary,
    };
  });
}

function validateSegments(segments, turns, errors) {
  const segmentIds = new Set();
  const byTurn = new Map();

  for (const segment of segments) {
    if (!isObject(segment)) {
      errors.push("Each segment must be an object");
      continue;
    }
    const match = String(segment.segment_id ?? "").match(SEGMENT_ID_PATTERN);
    if (!match) {
      errors.push(`Invalid segment_id '${segment.segment_id}'`);
    } else if (match[1] !== segment.turn_id) {
      errors.push(`Segment ${segment.segment_id} does not match its turn_id`);
    }
    if (segmentIds.has(segment.segment_id)) {
      errors.push(`Duplicate segment_id '${segment.segment_id}'`);
    }
    segmentIds.add(segment.segment_id);
    const turn = turns.get(segment.turn_id);
    if (!turn) {
      errors.push(`Segment ${segment.segment_id} references nonexistent turn_id`);
      continue;
    }
    if (
      !Number.isInteger(segment.start_char) ||
      !Number.isInteger(segment.end_char) ||
      segment.start_char < 0 ||
      segment.end_char <= segment.start_char ||
      segment.end_char > turn.text.length
    ) {
      errors.push(`Segment ${segment.segment_id} has invalid character offsets`);
    }
    const turnSegments = byTurn.get(segment.turn_id) ?? [];
    turnSegments.push(segment);
    byTurn.set(segment.turn_id, turnSegments);
  }

  for (const [turnId, turnSegments] of byTurn) {
    turnSegments.sort((left, right) => left.start_char - right.start_char);
    for (let index = 1; index < turnSegments.length; index += 1) {
      if (turnSegments[index].start_char < turnSegments[index - 1].end_char) {
        errors.push(`Segments overlap within ${turnId}`);
      }
    }
  }
  return segmentIds;
}

function validateTopics(topics, orderedTurns, segmentIds, errors) {
  const turnIndex = new Map(
    orderedTurns.map((turn, index) => [turn.turn_id, index]),
  );
  let expectedStartIndex = 0;

  topics.forEach((topic, index) => {
    const expectedId = `topic_${String(index + 1).padStart(3, "0")}`;
    if (topic.topic_id !== expectedId) {
      errors.push(`Expected topic_id '${expectedId}', received '${topic.topic_id}'`);
    }
    const startIndex = turnIndex.get(topic.start_turn);
    const endIndex = turnIndex.get(topic.end_turn);
    if (startIndex === undefined) {
      errors.push(`Topic ${topic.topic_id} has nonexistent start_turn`);
    }
    if (endIndex === undefined) {
      errors.push(`Topic ${topic.topic_id} has nonexistent end_turn`);
    }
    if (startIndex === undefined || endIndex === undefined) {
      return;
    }
    if (startIndex > endIndex) {
      errors.push(`Topic ${topic.topic_id} has reversed turn range`);
    }
    if (startIndex !== expectedStartIndex) {
      errors.push(`Topic ${topic.topic_id} creates a gap or overlap`);
    }
    expectedStartIndex = endIndex + 1;

    if (!Array.isArray(topic.key_spans)) {
      errors.push(`Topic ${topic.topic_id} key_spans must be an array`);
      return;
    }
    for (const keySpan of topic.key_spans) {
      if (!segmentIds.has(keySpan.segment_id)) {
        errors.push(
          `Topic ${topic.topic_id} key_span references missing segment_id`,
        );
      }
      if (!nonEmptyString(keySpan.reason)) {
        errors.push(`Topic ${topic.topic_id} key_span reason must be non-empty`);
      }
    }
  });

  if (expectedStartIndex !== orderedTurns.length) {
    errors.push("Topic ranges do not cover every turn exactly once");
  }
}

function collectQualityWarnings(topics, segments, turns) {
  const warnings = [];
  const turnCount = turns.length;
  const topicCount = topics.length;

  if (turnCount >= 40 && turnCount <= 200 && topicCount < 8) {
    warnings.push(
      qualityWarning(
        "TOPIC_COUNT_LOW",
        `Normal long transcript has only ${topicCount} topics; aim for 8-15.`,
      ),
    );
  }
  if (turnCount >= 40 && turnCount <= 200 && topicCount > 15) {
    warnings.push(
      qualityWarning(
        "TOPIC_COUNT_HIGH",
        `Normal long transcript has ${topicCount} topics; aim for 8-15.`,
      ),
    );
  }
  if (turnCount > 200 && (topicCount < 8 || topicCount > 25)) {
    warnings.push(
      qualityWarning(
        "TOPIC_COUNT_EXTREME",
        `Very long transcript has ${topicCount} topics; review segmentation quality.`,
      ),
    );
  }
  for (const topic of topics) {
    if (String(topic.title ?? "").length > 80) {
      warnings.push(
        qualityWarning(
          "TOPIC_TITLE_LONG",
          `Topic ${topic.topic_id} title is longer than 80 characters.`,
        ),
      );
    }
    if (String(topic.summary ?? "").length > 400) {
      warnings.push(
        qualityWarning(
          "TOPIC_SUMMARY_LONG",
          `Topic ${topic.topic_id} summary is longer than 400 characters.`,
        ),
      );
    }
  }

  if (topicCount >= 8) {
    const turnIndex = new Map(turns.map((turn, index) => [turn.turn_id, index]));
    const tinyCount = topics.filter(
      (topic) =>
        turnIndex.get(topic.end_turn) - turnIndex.get(topic.start_turn) + 1 <= 1,
    ).length;
    if (tinyCount / topicCount > 0.25) {
      warnings.push(
        qualityWarning(
          "TOO_MANY_TINY_TOPICS",
          `${tinyCount} of ${topicCount} topics cover only one turn.`,
        ),
      );
    }
  }

  const segmentedTurns = new Set(segments.map((segment) => segment.turn_id));
  for (const turn of turns) {
    if (turn.text.length >= 1200 && !segmentedTurns.has(turn.turn_id)) {
      warnings.push(
        qualityWarning(
          "LONG_TURN_WITHOUT_SEGMENTS",
          `${turn.turn_id} is long but has no precise segments.`,
        ),
      );
    }
  }
  if (
    turnCount >= 40 &&
    topics.length > 0 &&
    topics.every((topic) => topic.key_spans.length === 0)
  ) {
    warnings.push(
      qualityWarning(
        "NO_KEY_SPANS",
        "Long transcript topics contain no key_spans.",
      ),
    );
  }
  return warnings;
}

export function validateTopicSegmentation({ segments, topics }, processedTranscript) {
  const errors = [];
  if (!Array.isArray(segments)) {
    errors.push("segments must be an array");
  }
  if (!Array.isArray(topics)) {
    errors.push("topics must be an array");
  }
  if (errors.length > 0) {
    throw structuralError(errors);
  }

  const orderedTurns = processedTranscript.turns;
  const turns = new Map(orderedTurns.map((turn) => [turn.turn_id, turn]));
  const segmentIds = validateSegments(segments, turns, errors);
  validateTopics(topics, orderedTurns, segmentIds, errors);
  if (errors.length > 0) {
    throw structuralError(errors);
  }

  return collectQualityWarnings(topics, segments, orderedTurns);
}

export function buildTopicSegmentationOutput({
  processedTranscript,
  sourceProcessedFile,
  sourceSha256,
  model,
  segments,
  topics,
  warnings = [],
  generatedAt = new Date().toISOString(),
  agentPrompt = TOPIC_SEGMENTATION_PROMPT_PATH,
}) {
  return {
    schema: TOPIC_SEGMENTATION_SCHEMA,
    transcript_id: processedTranscript.transcript_id,
    source_processed_file: sourceProcessedFile,
    source_sha256: sourceSha256,
    generated_at: generatedAt,
    agent_prompt: agentPrompt,
    model,
    segments,
    topics,
    warnings,
  };
}

export function validateTopicSegmentationOutput(topicSegmentation) {
  const errors = [];
  if (!isObject(topicSegmentation)) {
    return ["Topic segmentation output must be an object"];
  }
  if (topicSegmentation.schema !== TOPIC_SEGMENTATION_SCHEMA) {
    errors.push(`schema must equal '${TOPIC_SEGMENTATION_SCHEMA}'`);
  }
  if (!isCanonicalTranscriptId(topicSegmentation.transcript_id)) {
    errors.push("transcript_id must be canonical");
  }
  for (const field of [
    "source_processed_file",
    "source_sha256",
    "generated_at",
    "agent_prompt",
    "model",
  ]) {
    if (!nonEmptyString(topicSegmentation[field])) {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  if (!Array.isArray(topicSegmentation.segments)) {
    errors.push("segments must be an array");
  }
  if (!Array.isArray(topicSegmentation.topics)) {
    errors.push("topics must be an array");
  }
  if (!Array.isArray(topicSegmentation.warnings)) {
    errors.push("warnings must be an array");
  }
  if (
    Array.isArray(topicSegmentation.segments) &&
    topicSegmentation.segments.some(
      (segment) => "anchor_start" in segment || "anchor_end" in segment,
    )
  ) {
    errors.push("Final segments must not contain anchor text");
  }
  return errors;
}

export async function segmentTranscriptTopics(
  processedTranscript,
  aiClient,
  {
    prompt,
    sourceProcessedFile,
    sourceSha256,
    generatedAt = new Date().toISOString(),
    agentPrompt = TOPIC_SEGMENTATION_PROMPT_PATH,
  } = {},
) {
  if (!aiClient || typeof aiClient.generateJson !== "function") {
    throw new Error("Topic segmentation requires injectable aiClient.generateJson");
  }
  const response = await aiClient.generateJson({
    prompt,
    input: buildTopicSegmentationInput(processedTranscript),
    schema: TOPIC_SEGMENTATION_RESPONSE_SCHEMA,
  });
  const parsed = parseTopicSegmentationResponse(response);
  validateAiResponseShape(parsed);
  const segments = convertSegmentAnchorsToOffsets(
    parsed.segments,
    processedTranscript,
  );
  const warnings = validateTopicSegmentation(
    { segments, topics: parsed.topics },
    processedTranscript,
  );
  return buildTopicSegmentationOutput({
    processedTranscript,
    sourceProcessedFile,
    sourceSha256,
    model: response?.model ?? aiClient.model ?? "unknown",
    segments,
    topics: parsed.topics,
    warnings,
    generatedAt,
    agentPrompt,
  });
}

export async function shouldSkipTopicSegmentation(
  outputPath,
  sourceSha256,
  { force = false } = {},
) {
  if (force) {
    return false;
  }
  try {
    const existing = JSON.parse(await readFile(outputPath, "utf8"));
    return (
      validateTopicSegmentationOutput(existing).length === 0 &&
      existing?.source_sha256 === sourceSha256
    );
  } catch {
    return false;
  }
}

export async function writeTopicSegmentationFile(
  topicSegmentation,
  { vaultPath = path.resolve(process.cwd(), "vault") } = {},
) {
  if (!isCanonicalTranscriptId(topicSegmentation?.transcript_id)) {
    throw new Error("Topic output requires canonical transcript_id");
  }
  const validationErrors = validateTopicSegmentationOutput(topicSegmentation);
  if (validationErrors.length > 0) {
    throw structuralError(validationErrors);
  }
  const outputDirectory = path.resolve(vaultPath, TOPIC_ANALYSES_PATH);
  const outputPath = path.join(
    outputDirectory,
    `${topicSegmentation.transcript_id}.topics.json`,
  );
  await mkdir(outputDirectory, { recursive: true });
  const tempPath = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(
      tempPath,
      `${JSON.stringify(topicSegmentation, null, 2)}\n`,
      "utf8",
    );
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
  return outputPath;
}
