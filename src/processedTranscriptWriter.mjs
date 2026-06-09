import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  cleanedTranscriptTitle,
  isCanonicalTranscriptId,
} from "./transcriptId.mjs";

export const PROCESSED_TRANSCRIPT_SCHEMA_VERSION = "processed_transcript.v1";
export const ANALYSIS_VERSION = "v1";
export const GENERATOR = "transcript_pipeline";

const PROCESSED_TRANSCRIPTS_PATH = path.join("01 Transcripts", "Processed");

function structuredWarning(value, stage) {
  if (
    value &&
    typeof value === "object" &&
    typeof value.code === "string" &&
    typeof value.message === "string"
  ) {
    return {
      code: value.code,
      stage: value.stage ?? stage,
      line: value.line ?? null,
      message: value.message,
    };
  }

  return {
    code: "UPSTREAM_WARNING",
    stage,
    line: null,
    message: String(value),
  };
}

function normalizeRawPath(filePath, fileName) {
  const relativePath =
    filePath || path.posix.join("01 Transcripts", "Raw", fileName);
  const normalized = String(relativePath).replaceAll("\\", "/");
  return normalized.startsWith("vault/") ? normalized : `vault/${normalized}`;
}

export function buildProcessedTranscript(rawTranscript, metadata, speakerTurns) {
  if (!rawTranscript?.transcript_id) {
    throw new Error("Processed transcript build requires transcript_id");
  }

  const fileName = rawTranscript.fileName ?? rawTranscript.source_file ?? null;
  const warnings = [
    ...(rawTranscript.transcriptIdWarnings ?? []).map((item) =>
      structuredWarning(item, "raw_transcript_loader"),
    ),
    ...(metadata?.warnings ?? []).map((item) =>
      structuredWarning(item, "metadata_parser"),
    ),
    ...(speakerTurns?.warnings ?? []).map((item) =>
      structuredWarning(item, "speaker_turn_parser"),
    ),
  ];

  return {
    schema_version: PROCESSED_TRANSCRIPT_SCHEMA_VERSION,
    analysis_version: ANALYSIS_VERSION,
    generated: true,
    generator: GENERATOR,
    transcript_id: rawTranscript.transcript_id,
    metadata: {
      title:
        metadata?.title ??
        (fileName ? cleanedTranscriptTitle(fileName) || null : null),
      source_file: metadata?.source_file ?? fileName,
      participants: Array.isArray(metadata?.participants)
        ? metadata.participants
        : [],
      language: metadata?.language ?? null,
      interview_date: metadata?.interview_date ?? metadata?.date ?? null,
    },
    turns: Array.isArray(speakerTurns?.turns) ? speakerTurns.turns : [],
    summaries: [],
    topics: [],
    evidence_candidates: [],
    source: {
      raw_path: normalizeRawPath(rawTranscript.filePath, fileName),
      raw_filename: fileName,
      source_hash: rawTranscript.fileHash ?? rawTranscript.source_hash ?? null,
      modified_at:
        rawTranscript.lastModified ?? rawTranscript.modified_at ?? null,
    },
    processed_at: null,
    warnings,
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

export function validateProcessedTranscript(processedTranscript) {
  const errors = [];
  const add = (condition, message) => {
    if (!condition) {
      errors.push(message);
    }
  };

  add(isObject(processedTranscript), "Processed transcript must be an object");
  if (!isObject(processedTranscript)) {
    return errors;
  }

  add(
    processedTranscript.schema_version === PROCESSED_TRANSCRIPT_SCHEMA_VERSION,
    `schema_version must equal '${PROCESSED_TRANSCRIPT_SCHEMA_VERSION}'`,
  );
  add(
    isNonEmptyString(processedTranscript.analysis_version),
    "analysis_version must be a non-empty string",
  );
  add(processedTranscript.generated === true, "generated must equal true");
  add(
    processedTranscript.generator === GENERATOR,
    `generator must equal '${GENERATOR}'`,
  );
  add(
    isCanonicalTranscriptId(processedTranscript.transcript_id),
    "transcript_id must be a canonical non-empty string",
  );
  add(isObject(processedTranscript.metadata), "metadata must be an object");
  add(Array.isArray(processedTranscript.turns), "turns must be an array");
  add(
    Array.isArray(processedTranscript.summaries),
    "summaries must be an array",
  );
  add(Array.isArray(processedTranscript.topics), "topics must be an array");
  add(
    Array.isArray(processedTranscript.evidence_candidates),
    "evidence_candidates must be an array",
  );
  add(isObject(processedTranscript.source), "source must be an object");
  add(
    isNonEmptyString(processedTranscript.source?.raw_path),
    "source.raw_path must be a non-empty string",
  );
  add(
    isNonEmptyString(processedTranscript.source?.raw_filename),
    "source.raw_filename must be a non-empty string",
  );
  add(
    isNonEmptyString(processedTranscript.source?.source_hash),
    "source.source_hash must be a non-empty string",
  );
  add(
    processedTranscript.source?.modified_at !== null &&
      processedTranscript.source?.modified_at !== undefined,
    "source.modified_at must exist",
  );
  add(
    processedTranscript.processed_at !== null &&
      processedTranscript.processed_at !== undefined,
    "processed_at must exist",
  );
  add(Array.isArray(processedTranscript.warnings), "warnings must be an array");

  if (Array.isArray(processedTranscript.turns)) {
    processedTranscript.turns.forEach((turn, index) => {
      const prefix = `turns[${index}]`;
      add(isObject(turn), `${prefix} must be an object`);
      if (!isObject(turn)) {
        return;
      }
      add(isNonEmptyString(turn.turn_id), `${prefix}.turn_id must be non-empty`);
      add(typeof turn.speaker === "string", `${prefix}.speaker must be a string`);
      add(
        typeof turn.speaker_id === "string",
        `${prefix}.speaker_id must be a string`,
      );
      add(typeof turn.text === "string", `${prefix}.text must be a string`);
      add(
        typeof turn.position === "number" && Number.isFinite(turn.position),
        `${prefix}.position must be a number`,
      );
      if (turn.source_line_start !== undefined) {
        add(
          typeof turn.source_line_start === "number" &&
            Number.isFinite(turn.source_line_start),
          `${prefix}.source_line_start must be a number if present`,
        );
      }
      if (turn.source_line_end !== undefined) {
        add(
          typeof turn.source_line_end === "number" &&
            Number.isFinite(turn.source_line_end),
          `${prefix}.source_line_end must be a number if present`,
        );
      }
    });
  }

  return errors;
}

function validationError(errors) {
  return new Error(`Processed transcript validation failed: ${errors.join("; ")}`);
}

async function readExistingProcessed(outputPath) {
  try {
    return JSON.parse(await readFile(outputPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

function existingMatches(existing, candidate) {
  return (
    validateProcessedTranscript(existing).length === 0 &&
    existing.source.source_hash === candidate.source.source_hash &&
    existing.schema_version === candidate.schema_version &&
    existing.analysis_version === candidate.analysis_version
  );
}

export async function writeProcessedTranscript(
  processedTranscript,
  {
    vaultPath = path.resolve(process.cwd(), "vault"),
    force = false,
    now = () => new Date(),
  } = {},
) {
  if (!isCanonicalTranscriptId(processedTranscript?.transcript_id)) {
    throw new Error(
      `Processed transcript requires canonical transcript_id: ${processedTranscript?.transcript_id}`,
    );
  }

  const outputDirectory = path.resolve(vaultPath, PROCESSED_TRANSCRIPTS_PATH);
  const outputPath = path.join(
    outputDirectory,
    `${processedTranscript.transcript_id}.processed.json`,
  );
  await mkdir(outputDirectory, { recursive: true });

  if (!force) {
    const existing = await readExistingProcessed(outputPath);
    if (existing && existingMatches(existing, processedTranscript)) {
      return {
        status: "skipped",
        outputPath,
        processedTranscript: existing,
      };
    }
  }

  const timestamp = now();
  const candidate = {
    ...processedTranscript,
    processed_at:
      timestamp instanceof Date ? timestamp.toISOString() : String(timestamp),
  };
  const errors = validateProcessedTranscript(candidate);
  if (errors.length > 0) {
    throw validationError(errors);
  }

  const tempPath = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  return {
    status: "written",
    outputPath,
    processedTranscript: candidate,
  };
}

