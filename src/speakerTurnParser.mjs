import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isCanonicalTranscriptId,
  normalizeTranscriptId,
} from "./transcriptId.mjs";

export const SPEAKER_TURN_PARSER_VERSION = "speaker-turn-parser-v1";
const PROCESSED_TRANSCRIPTS_PATH = path.join("01 Transcripts", "Processed");

function warning(code, line, message) {
  return { code, line, message };
}

function cleanSpeakerName(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeSpeakerId(name) {
  const normalized = normalizeTranscriptId(cleanSpeakerName(name));
  return normalized ? `speaker_${normalized}` : "speaker_unknown";
}

function knownSpeakerMap(knownSpeakers = []) {
  const speakers = new Map();
  for (const speaker of knownSpeakers) {
    const displayName = cleanSpeakerName(speaker);
    if (displayName) {
      speakers.set(normalizeSpeakerId(displayName), displayName);
    }
  }
  return speakers;
}

function looksLikePlainLabel(label) {
  const cleaned = cleanSpeakerName(label);
  return (
    cleaned.length > 0 &&
    cleaned.length <= 60 &&
    cleaned.split(/\s+/).length <= 8 &&
    !/[.!?()[\]{}]/.test(cleaned)
  );
}

/**
 * Detects a valid speaker label or a suspicious unknown plain label.
 *
 * @param {string} line
 * @param {{knownSpeakers?: string[]}} options
 * @returns {{
 *   type: "speaker",
 *   speaker: string,
 *   text: string,
 *   labelStyle: "bold" | "plain"
 * } | {
 *   type: "suspicious",
 *   label: string
 * } | null}
 */
export function detectSpeakerLabel(line, { knownSpeakers = [] } = {}) {
  const boldMatch = String(line).match(
    /^\s*\*\*(.+?)(?:(?:[:：]\*\*)|(?:\*\*[:：]))[ \t]*(.*)$/,
  );
  if (boldMatch) {
    const speaker = cleanSpeakerName(boldMatch[1]);
    if (speaker && !speaker.includes("**")) {
      return {
        type: "speaker",
        speaker,
        text: boldMatch[2],
        labelStyle: "bold",
      };
    }
  }

  const plainMatch = String(line).match(/^\s*([^:：]+?)[:：][ \t]*(.*)$/);
  if (!plainMatch) {
    return null;
  }

  const label = cleanSpeakerName(plainMatch[1]);
  const speakers = knownSpeakerMap(knownSpeakers);
  const knownSpeaker = speakers.get(normalizeSpeakerId(label));
  if (knownSpeaker) {
    return {
      type: "speaker",
      speaker: knownSpeaker,
      text: plainMatch[2],
      labelStyle: "plain",
    };
  }

  return looksLikePlainLabel(label) ? { type: "suspicious", label } : null;
}

function trimOuterBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") {
    start += 1;
  }
  while (end > start && lines[end - 1].trim() === "") {
    end -= 1;
  }
  return lines.slice(start, end);
}

function buildTurn(currentTurn, position, warnings) {
  const text = trimOuterBlankLines(currentTurn.lines).join("\n");
  if (!text.trim()) {
    warnings.push(
      warning(
        "EMPTY_TURN_SKIPPED",
        currentTurn.sourceLineStart,
        `Skipped empty turn for speaker ${currentTurn.speaker}.`,
      ),
    );
    return null;
  }

  return {
    turn_id: `turn_${String(position).padStart(3, "0")}`,
    speaker: currentTurn.speaker,
    speaker_id: normalizeSpeakerId(currentTurn.speaker),
    text,
    position,
    source_line_start: currentTurn.sourceLineStart,
    source_line_end: currentTurn.sourceLineEnd,
  };
}

/**
 * Converts a raw transcript into strict, source-traceable speaker turns.
 *
 * @param {{
 *   transcript_id: string,
 *   fileName?: string,
 *   source_file?: string,
 *   fileHash?: string,
 *   source_hash?: string,
 *   rawText?: string,
 *   raw_text?: string
 * }} rawTranscript
 * @param {{knownSpeakers?: string[], warnings?: object[]}} options
 */
export function parseSpeakerTurns(
  rawTranscript,
  { knownSpeakers = [], warnings: initialWarnings = [] } = {},
) {
  if (!rawTranscript?.transcript_id) {
    throw new Error("Speaker turn parsing requires transcript_id");
  }

  const rawText = rawTranscript.rawText ?? rawTranscript.raw_text;
  if (typeof rawText !== "string") {
    throw new Error(
      `Speaker turn parsing requires raw text for ${rawTranscript.transcript_id}`,
    );
  }

  const warnings = [...initialWarnings];
  const lines = rawText.replace(/\r\n?/g, "\n").split("\n");
  const known = knownSpeakerMap(knownSpeakers);
  const preambleLines = [];
  const turns = [];
  let currentTurn = null;
  let foundFirstSpeaker = false;

  const finalizeCurrentTurn = (sourceLineEnd) => {
    if (!currentTurn) {
      return;
    }
    currentTurn.sourceLineEnd = sourceLineEnd;
    const turn = buildTurn(currentTurn, turns.length + 1, warnings);
    if (turn) {
      turns.push(turn);
    }
    currentTurn = null;
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const detection = detectSpeakerLabel(line, {
      knownSpeakers: [...known.values()],
    });

    if (detection?.type === "speaker") {
      finalizeCurrentTurn(lineNumber - 1);
      foundFirstSpeaker = true;
      known.set(normalizeSpeakerId(detection.speaker), detection.speaker);
      currentTurn = {
        speaker: detection.speaker,
        lines: detection.text ? [detection.text] : [],
        sourceLineStart: lineNumber,
        sourceLineEnd: lineNumber,
      };
      return;
    }

    if (detection?.type === "suspicious") {
      warnings.push(
        warning(
          "SUSPICIOUS_SPEAKER_LABEL_IGNORED",
          lineNumber,
          `Ignored unknown plain speaker label '${detection.label}'.`,
        ),
      );
    }

    if (currentTurn) {
      currentTurn.lines.push(line);
      currentTurn.sourceLineEnd = lineNumber;
    } else if (!foundFirstSpeaker) {
      preambleLines.push(line);
    }
  });

  finalizeCurrentTurn(lines.length);

  if (turns.length === 0) {
    warnings.push(
      warning(
        "NO_SPEAKER_TURNS_FOUND",
        null,
        "No valid speaker turns were found.",
      ),
    );
  }

  const speakers = [];
  const speakerIds = new Set();
  for (const turn of turns) {
    if (!speakerIds.has(turn.speaker_id)) {
      speakers.push(turn.speaker);
      speakerIds.add(turn.speaker_id);
    }
  }

  return {
    transcript_id: rawTranscript.transcript_id,
    source_file: rawTranscript.source_file ?? rawTranscript.fileName ?? null,
    source_hash: rawTranscript.source_hash ?? rawTranscript.fileHash ?? null,
    parser_version: SPEAKER_TURN_PARSER_VERSION,
    preamble_text:
      turns.length === 0
        ? rawText
        : trimOuterBlankLines(preambleLines).join("\n"),
    speakers,
    warnings,
    turns,
  };
}

export async function writeProcessedTranscript(
  processedTranscript,
  { vaultPath = path.resolve(process.cwd(), "vault") } = {},
) {
  if (!processedTranscript?.transcript_id) {
    throw new Error("Processed transcript requires transcript_id");
  }
  if (!isCanonicalTranscriptId(processedTranscript.transcript_id)) {
    throw new Error(
      `Processed transcript requires canonical transcript_id: ${processedTranscript.transcript_id}`,
    );
  }

  const outputDirectory = path.resolve(vaultPath, PROCESSED_TRANSCRIPTS_PATH);
  const outputPath = path.join(
    outputDirectory,
    `${processedTranscript.transcript_id}.processed.json`,
  );
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(processedTranscript, null, 2)}\n`,
    "utf8",
  );
  return outputPath;
}
