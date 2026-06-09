import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EVIDENCE_CANDIDATE_RESPONSE_SCHEMA,
  EVIDENCE_CATEGORIES,
  EVIDENCE_STRENGTHS,
  buildEvidenceCandidatePrompt,
} from "./evidenceCandidatePrompt.mjs";
import { selectTopicTurns } from "./topicAnalysisWriter.mjs";
import { validateTopicSegmentationOutput } from "./topicSegmentationAgent.mjs";

export const EVIDENCE_CANDIDATES_SCHEMA_VERSION = "evidence_candidates.v1";
export const EVIDENCE_CANDIDATES_PATH = path.join("03 Evidence", "Candidates");
export const EVIDENCE_CANDIDATE_AGENT_PATH =
  "vault/99 System/Agents/Evidence_Candidate_Extractor_Agent.md";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function warning(code, message, topicId = null, candidateIndex = null) {
  return {
    code,
    stage: "evidence_candidate_extraction",
    topic_id: topicId,
    candidate_index: candidateIndex,
    message,
  };
}

function outputPathFor(vaultPath, transcriptId) {
  return path.join(
    vaultPath,
    EVIDENCE_CANDIDATES_PATH,
    `${transcriptId}.evidence_candidates.json`,
  );
}

export function parseEvidenceCandidateResponse(response) {
  const value = response?.json ?? response?.output ?? response;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid JSON from evidence candidate AI: ${error.message}`);
    }
  }
  if (!isObject(value)) {
    throw new Error("Invalid evidence candidate AI response");
  }
  return value;
}

function validateResponseShape(response) {
  if (!Array.isArray(response.candidates)) {
    throw new Error("Evidence candidate AI response must include candidates array");
  }
  if (response.candidates.some((candidate) => !isObject(candidate))) {
    throw new Error("Evidence candidate AI candidates must be objects");
  }
}

function normalizedQuote(quote) {
  return quote.toLowerCase().replace(/\s+/g, " ").trim();
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function validateTopicCandidates({
  response,
  topic,
  processedTranscript,
}) {
  validateResponseShape(response);
  const warnings = [];
  const selectedTurns = selectTopicTurns(processedTranscript, topic);
  const turns = new Map(selectedTurns.map((turn) => [turn.turn_id, turn]));
  const turnOrder = new Map(
    selectedTurns.map((turn, index) => [turn.turn_id, index]),
  );
  const accepted = [];
  const seenQuotes = new Set();

  if (response.candidates.length > 5) {
    warnings.push(
      warning(
        "candidate_limit_exceeded",
        `Topic ${topic.topic_id} returned ${response.candidates.length} candidates; validated output is capped at 5`,
        topic.topic_id,
      ),
    );
  }

  response.candidates.forEach((candidate, index) => {
    const reject = (code, message) => {
      warnings.push(warning(code, message, topic.topic_id, index));
    };
    if (
      !nonEmptyString(candidate.quote) ||
      !nonEmptyString(candidate.context) ||
      !nonEmptyString(candidate.meaning)
    ) {
      reject("invalid_candidate_text", "Candidate quote, context, and meaning must be non-empty");
      return;
    }
    if (!EVIDENCE_CATEGORIES.includes(candidate.evidence_category)) {
      reject("invalid_evidence_category", `Invalid evidence category: ${candidate.evidence_category}`);
      return;
    }
    if (!EVIDENCE_STRENGTHS.includes(candidate.strength)) {
      reject("invalid_evidence_strength", `Invalid evidence strength: ${candidate.strength}`);
      return;
    }
    if (
      !Array.isArray(candidate.suggested_tags) ||
      candidate.suggested_tags.some((tag) => !nonEmptyString(tag))
    ) {
      reject("invalid_suggested_tags", "Suggested tags must be non-empty strings");
      return;
    }
    if (!Array.isArray(candidate.source_refs) || candidate.source_refs.length !== 1) {
      reject("invalid_source_refs", "Candidate must contain exactly one source reference");
      return;
    }
    const sourceRef = candidate.source_refs[0];
    const turn = turns.get(sourceRef?.turn_id);
    if (!turn) {
      reject("invalid_source_turn", `Source turn is outside the selected topic: ${sourceRef?.turn_id}`);
      return;
    }
    if (
      !Number.isInteger(sourceRef.start_char) ||
      !Number.isInteger(sourceRef.end_char) ||
      sourceRef.start_char < 0 ||
      sourceRef.end_char <= sourceRef.start_char ||
      sourceRef.end_char > turn.text.length
    ) {
      reject("invalid_source_offsets", "Source reference character offsets are invalid");
      return;
    }
    if (turn.text.slice(sourceRef.start_char, sourceRef.end_char) !== candidate.quote) {
      reject("quote_pointer_mismatch", "Candidate quote does not exactly match its source pointer");
      return;
    }
    const quoteKey = normalizedQuote(candidate.quote);
    if (seenQuotes.has(quoteKey)) {
      reject("duplicate_candidate", "Duplicate quote candidate removed");
      return;
    }
    seenQuotes.add(quoteKey);
    accepted.push({
      topic_id: topic.topic_id,
      quote: candidate.quote,
      speaker: turn.speaker,
      source_refs: [
        {
          turn_id: sourceRef.turn_id,
          start_char: sourceRef.start_char,
          end_char: sourceRef.end_char,
        },
      ],
      context: candidate.context.trim(),
      meaning: candidate.meaning.trim(),
      evidence_category: candidate.evidence_category,
      suggested_tags: [...new Set(candidate.suggested_tags.map((tag) => tag.trim()))],
      strength: candidate.strength,
      status: "candidate",
    });
  });

  accepted.sort((left, right) => {
    const leftRef = left.source_refs[0];
    const rightRef = right.source_refs[0];
    return (
      turnOrder.get(leftRef.turn_id) - turnOrder.get(rightRef.turn_id) ||
      leftRef.start_char - rightRef.start_char ||
      leftRef.end_char - rightRef.end_char ||
      compareStrings(left.quote, right.quote) ||
      compareStrings(left.meaning, right.meaning)
    );
  });
  return { candidates: accepted.slice(0, 5), warnings };
}

export async function extractEvidenceCandidatesForTranscript({
  processedTranscript,
  topicSegmentation,
  aiClient,
  sourceHash,
  agentInstructions = "",
  generatedAt = new Date().toISOString(),
}) {
  if (!aiClient || typeof aiClient.generateJson !== "function") {
    throw new Error("Evidence candidate extraction requires aiClient.generateJson");
  }
  if (processedTranscript.transcript_id !== topicSegmentation.transcript_id) {
    throw new Error("Processed transcript and topic segmentation IDs do not match");
  }
  if (!Array.isArray(processedTranscript.turns) || !Array.isArray(topicSegmentation.topics)) {
    throw new Error("Evidence candidate extraction requires turns and topics arrays");
  }
  const topicValidationErrors = validateTopicSegmentationOutput(topicSegmentation);
  if (topicValidationErrors.length > 0) {
    throw new Error(
      `Invalid Part 6 topic segmentation: ${topicValidationErrors.join("; ")}`,
    );
  }
  if (!nonEmptyString(sourceHash)) {
    throw new Error("Evidence candidate extraction requires sourceHash");
  }

  const evidenceCandidates = [];
  const warnings = [];
  for (const topic of topicSegmentation.topics) {
    const selectedTurns = selectTopicTurns(processedTranscript, topic);
    const inputTurns = selectedTurns.map(
      ({ turn_id, speaker, speaker_id, text, position }) => ({
        turn_id,
        speaker,
        speaker_id,
        text,
        position,
      }),
    );
    const response = parseEvidenceCandidateResponse(
      await aiClient.generateJson({
        prompt: buildEvidenceCandidatePrompt({
          agentInstructions,
          topic,
          turns: inputTurns,
        }),
        input: { topic, turns: inputTurns },
        schema: EVIDENCE_CANDIDATE_RESPONSE_SCHEMA,
        schemaName: "evidence_candidates",
        reasoningEffort: "medium",
      }),
    );
    const validated = validateTopicCandidates({
      response,
      topic,
      processedTranscript,
    });
    warnings.push(...validated.warnings);
    validated.candidates.forEach((candidate, index) => {
      evidenceCandidates.push({
        candidate_id: `${processedTranscript.transcript_id}_${topic.topic_id}_ev_${String(index + 1).padStart(3, "0")}`,
        ...candidate,
      });
    });
  }

  return {
    schema_version: EVIDENCE_CANDIDATES_SCHEMA_VERSION,
    transcript_id: processedTranscript.transcript_id,
    source_hash: sourceHash,
    generated_at: generatedAt,
    evidence_candidates: evidenceCandidates,
    warnings,
  };
}

export function validateEvidenceCandidatesOutput(output) {
  const errors = [];
  if (output?.schema_version !== EVIDENCE_CANDIDATES_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${EVIDENCE_CANDIDATES_SCHEMA_VERSION}`);
  }
  if (!nonEmptyString(output?.transcript_id)) errors.push("transcript_id is required");
  if (!nonEmptyString(output?.source_hash)) errors.push("source_hash is required");
  if (!nonEmptyString(output?.generated_at)) errors.push("generated_at is required");
  if (!Array.isArray(output?.evidence_candidates)) errors.push("evidence_candidates must be an array");
  if (!Array.isArray(output?.warnings)) errors.push("warnings must be an array");
  const ids = new Set();
  const topicCounts = new Map();
  for (const candidate of output?.evidence_candidates ?? []) {
    if (!isObject(candidate)) {
      errors.push("evidence candidates must be objects");
      continue;
    }
    const candidateId = candidate.candidate_id;
    if (!nonEmptyString(candidateId) || ids.has(candidateId)) {
      errors.push("candidate IDs must be non-empty and unique");
    }
    ids.add(candidateId);
    const topicSequence = (topicCounts.get(candidate.topic_id) ?? 0) + 1;
    topicCounts.set(candidate.topic_id, topicSequence);
    if (
      !nonEmptyString(candidate.topic_id) ||
      candidateId !==
        `${output.transcript_id}_${candidate.topic_id}_ev_${String(topicSequence).padStart(3, "0")}`
    ) {
      errors.push("candidate ID must match transcript_id, topic_id, and sequence");
    }
    if (topicSequence > 5) {
      errors.push(`topic ${candidate.topic_id} exceeds the 5-candidate limit`);
    }
    for (const field of ["quote", "speaker", "context", "meaning"]) {
      if (!nonEmptyString(candidate[field])) errors.push(`${field} is required`);
    }
    if (
      !Array.isArray(candidate.source_refs) ||
      candidate.source_refs.length !== 1 ||
      !nonEmptyString(candidate.source_refs[0]?.turn_id) ||
      !Number.isInteger(candidate.source_refs[0]?.start_char) ||
      !Number.isInteger(candidate.source_refs[0]?.end_char) ||
      candidate.source_refs[0]?.start_char < 0 ||
      candidate.source_refs[0]?.end_char <= candidate.source_refs[0]?.start_char
    ) {
      errors.push("candidate source_refs must contain one valid character range");
    }
    if (
      !Array.isArray(candidate.suggested_tags) ||
      candidate.suggested_tags.some((tag) => !nonEmptyString(tag))
    ) {
      errors.push("candidate suggested_tags must contain only non-empty strings");
    }
    if (candidate.status !== "candidate") errors.push("candidate status must be candidate");
    if (!EVIDENCE_CATEGORIES.includes(candidate.evidence_category)) errors.push("invalid evidence category");
    if (!EVIDENCE_STRENGTHS.includes(candidate.strength)) errors.push("invalid evidence strength");
  }
  if (errors.length > 0) {
    throw new Error(`Evidence candidate output validation failed: ${errors.join("; ")}`);
  }
}

async function writeJsonAtomically(outputPath, output) {
  validateEvidenceCandidatesOutput(output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function combinedSourceHash(processedText, topicText) {
  return createHash("sha256")
    .update(processedText)
    .update("\0")
    .update(topicText)
    .digest("hex");
}

async function unchangedValidOutput(outputPath, sourceHash) {
  try {
    const existing = JSON.parse(await readFile(outputPath, "utf8"));
    validateEvidenceCandidatesOutput(existing);
    return existing.source_hash === sourceHash;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    return false;
  }
}

export async function extractAllEvidenceCandidates({
  aiClient,
  projectPath = process.cwd(),
  vaultPath = path.resolve(projectPath, "vault"),
  force = false,
  transcriptId = null,
}) {
  if (!aiClient || typeof aiClient.generateJson !== "function") {
    throw new Error("Evidence candidate extraction requires aiClient.generateJson");
  }
  const topicDirectory = path.join(vaultPath, "02 Topic Analyses");
  const agentInstructions = await readFile(
    path.resolve(projectPath, EVIDENCE_CANDIDATE_AGENT_PATH),
    "utf8",
  );
  let entries = [];
  try {
    entries = await readdir(topicDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const topicFiles = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && entry.name.endsWith(".topics.json"))
    .filter((entry) => !transcriptId || entry.name === `${transcriptId}.topics.json`)
    .sort((left, right) => left.name.localeCompare(right.name));
  const results = { processed: [], skipped: [], failed: [], warnings: [], candidateCount: 0 };

  if (transcriptId && topicFiles.length === 0) {
    const message = `Missing topic segmentation for ${transcriptId}`;
    results.skipped.push({ transcript_id: transcriptId, reason: "missing_topic_segmentation" });
    results.warnings.push(message);
    return results;
  }

  if (!transcriptId) {
    const topicIds = new Set(
      topicFiles.map((entry) => entry.name.replace(/\.topics\.json$/, "")),
    );
    let processedEntries = [];
    try {
      processedEntries = await readdir(
        path.join(vaultPath, "01 Transcripts", "Processed"),
        { withFileTypes: true },
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    for (const entry of processedEntries) {
      if (
        entry.isFile() &&
        !entry.name.startsWith(".") &&
        entry.name.endsWith(".processed.json")
      ) {
        const id = entry.name.replace(/\.processed\.json$/, "");
        if (!topicIds.has(id)) {
          results.skipped.push({
            transcript_id: id,
            reason: "missing_topic_segmentation",
          });
          results.warnings.push(`Missing topic segmentation for ${id}`);
        }
      }
    }
  }

  for (const topicFile of topicFiles) {
    const fileTranscriptId = topicFile.name.replace(/\.topics\.json$/, "");
    try {
      const topicPath = path.join(topicDirectory, topicFile.name);
      const processedPath = path.join(vaultPath, "01 Transcripts", "Processed", `${fileTranscriptId}.processed.json`);
      const topicText = await readFile(topicPath, "utf8");
      let processedText;
      try {
        processedText = await readFile(processedPath, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        const message = `Missing processed transcript for ${fileTranscriptId}`;
        results.skipped.push({ transcript_id: fileTranscriptId, reason: "missing_processed_transcript" });
        results.warnings.push(message);
        continue;
      }
      const topicSegmentation = JSON.parse(topicText);
      const processedTranscript = JSON.parse(processedText);
      if (topicSegmentation.transcript_id !== fileTranscriptId || processedTranscript.transcript_id !== fileTranscriptId) {
        throw new Error("Transcript ID does not match input filename");
      }
      const sourceHash = combinedSourceHash(processedText, topicText);
      const outputPath = outputPathFor(vaultPath, fileTranscriptId);
      if (!force && (await unchangedValidOutput(outputPath, sourceHash))) {
        results.skipped.push({ transcript_id: fileTranscriptId, reason: "unchanged", outputPath });
        continue;
      }
      const output = await extractEvidenceCandidatesForTranscript({
        processedTranscript,
        topicSegmentation,
        aiClient,
        sourceHash,
        agentInstructions,
      });
      await writeJsonAtomically(outputPath, output);
      results.processed.push({ transcript_id: fileTranscriptId, outputPath });
      results.candidateCount += output.evidence_candidates.length;
      results.warnings.push(...output.warnings.map((item) => `${fileTranscriptId}: ${item.message}`));
    } catch (error) {
      results.failed.push({ transcript_id: fileTranscriptId, error: error.message });
    }
  }
  return results;
}
