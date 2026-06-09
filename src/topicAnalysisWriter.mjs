import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { TOPIC_ANALYSIS_RESPONSE_SCHEMA, buildTopicAnalysisPrompt } from "./topicAnalysisPrompt.mjs";
import { normalizeTranscriptId } from "./transcriptId.mjs";

export const TOPIC_ANALYSIS_SCHEMA_VERSION = "topic_analysis.v1";
export const TOPIC_ANALYSIS_GENERATED_MARKER =
  "<!-- generated: topic-analysis-writer -->";
export const TOPIC_ANALYSIS_AGENT_PATH =
  "vault/99 System/Agents/Topic_Analysis_Writer_Agent.md";

const TOPIC_ANALYSES_PATH = "02 Topic Analyses";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function sourceTranscriptName(processedTranscript) {
  return (
    processedTranscript.metadata?.title ||
    path.basename(
      processedTranscript.metadata?.source_file ??
        processedTranscript.source?.raw_filename ??
        processedTranscript.transcript_id,
      path.extname(
        processedTranscript.metadata?.source_file ??
          processedTranscript.source?.raw_filename ??
          "",
      ),
    )
  );
}

function inputHash(processedTranscript, topicSegmentation, topic, prompt) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        processed_source_hash: processedTranscript.source?.source_hash,
        processed_at: processedTranscript.processed_at,
        topic_source_sha256: topicSegmentation.source_sha256,
        topic,
        prompt,
      }),
    )
    .digest("hex");
}

export function topicSlug(topic) {
  return (
    topic?.analysis_slug ||
    normalizeTranscriptId(topic?.title) ||
    normalizeTranscriptId(topic?.topic_id)
  );
}

export function selectTopicTurns(processedTranscript, topic) {
  const startIndex = processedTranscript.turns.findIndex(
    (turn) => turn.turn_id === topic.start_turn,
  );
  const endIndex = processedTranscript.turns.findIndex(
    (turn) => turn.turn_id === topic.end_turn,
  );
  if (startIndex === -1 || endIndex === -1 || startIndex > endIndex) {
    throw new Error(`Invalid turn range for ${topic.topic_id}`);
  }
  return processedTranscript.turns.slice(startIndex, endIndex + 1);
}

export function parseTopicAnalysisResponse(response) {
  const value = response?.json ?? response?.output ?? response;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid JSON from topic analysis AI: ${error.message}`);
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid topic analysis AI response");
  }
  return value;
}

export function validateTopicAnalysisResponse(analysis, selectedTurns) {
  const errors = [];
  if (!nonEmptyString(analysis.summary)) {
    errors.push("summary must be a non-empty string");
  }
  for (const field of ["key_points", "design_implications", "warnings"]) {
    if (!Array.isArray(analysis[field])) {
      errors.push(`${field} must be an array`);
    } else if (analysis[field].some((item) => !nonEmptyString(item))) {
      errors.push(`${field} must contain only non-empty strings`);
    }
  }
  if (!["low", "medium", "high"].includes(analysis.confidence)) {
    errors.push("confidence must be low, medium, or high");
  }

  const generatedText = [
    analysis.summary,
    ...(analysis.key_points ?? []),
    ...(analysis.design_implications ?? []),
  ].join("\n");
  for (const turn of selectedTurns) {
    if (turn.text.length >= 40 && generatedText.includes(turn.text)) {
      errors.push(`analysis copies full transcript turn ${turn.turn_id}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Topic analysis validation failed: ${errors.join("; ")}`);
  }
}

export function renderTopicAnalysisMarkdown({
  processedTranscript,
  topic,
  analysis,
  inputSha256,
}) {
  const sourceName = sourceTranscriptName(processedTranscript);
  const slug = topicSlug(topic);
  const lines = [
    "---",
    "type: topic_analysis",
    `schema_version: ${TOPIC_ANALYSIS_SCHEMA_VERSION}`,
    `transcript_id: ${processedTranscript.transcript_id}`,
    `topic_id: ${topic.topic_id}`,
    `topic_slug: ${slug}`,
    `topic_title: ${yamlString(topic.title)}`,
    `source_transcript: ${yamlString(sourceName)}`,
    `input_sha256: ${inputSha256}`,
    "turn_ranges:",
    `  - ${topic.start_turn} - ${topic.end_turn}`,
    "generated_from: topic_segmentation.v1",
    "---",
    "",
    TOPIC_ANALYSIS_GENERATED_MARKER,
    "",
    `# Topic Analysis - ${topic.title}`,
    "",
    "## Summary",
    analysis.summary.trim(),
    "",
    "## Key Points",
  ];
  for (const point of analysis.key_points) {
    lines.push(`- ${point.trim()}`, "");
  }
  if (analysis.design_implications.length > 0) {
    lines.push("## Design Implications");
    for (const implication of analysis.design_implications) {
      lines.push(`- ${implication.trim()}`);
    }
    lines.push("");
  }
  lines.push(
    "## Source",
    `- [[${sourceName}]]`,
    "",
    "## Turn Range",
    `- ${topic.start_turn} - ${topic.end_turn}`,
    "",
  );
  return lines.join("\n");
}

function existingInputHash(markdown) {
  return markdown.match(/^input_sha256:\s*(\S+)\s*$/m)?.[1] ?? null;
}

async function writeMarkdownAtomically(outputPath, markdown) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, markdown, "utf8");
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeTopicAnalysisNote({
  processedTranscript,
  topicSegmentation,
  topic,
  aiClient,
  agentInstructions,
  vaultPath = path.resolve(process.cwd(), "vault"),
  force = false,
}) {
  if (!aiClient || typeof aiClient.generateJson !== "function") {
    throw new Error("Topic analysis note requires aiClient.generateJson");
  }
  if (processedTranscript.transcript_id !== topicSegmentation.transcript_id) {
    throw new Error("Processed transcript and topic segmentation IDs do not match");
  }
  for (const field of ["topic_id", "title", "start_turn", "end_turn"]) {
    if (!nonEmptyString(topic?.[field])) {
      throw new Error(`Topic ${field} must be a non-empty string`);
    }
  }
  const selectedTurns = selectTopicTurns(processedTranscript, topic);
  const prompt = buildTopicAnalysisPrompt({
    agentInstructions,
    topic,
    transcriptMetadata: processedTranscript.metadata ?? {},
    turns: selectedTurns.map(({ turn_id, speaker, speaker_id, text, position }) => ({
      turn_id,
      speaker,
      speaker_id,
      text,
      position,
    })),
  });
  const inputSha256 = inputHash(processedTranscript, topicSegmentation, topic, prompt);
  const slug = topicSlug(topic);
  if (!slug) {
    throw new Error(`Unable to generate topic slug for ${topic.topic_id}`);
  }
  const outputPath = path.join(
    vaultPath,
    TOPIC_ANALYSES_PATH,
    `${processedTranscript.transcript_id}__${slug}.md`,
  );

  try {
    const existing = await readFile(outputPath, "utf8");
    if (!existing.includes(TOPIC_ANALYSIS_GENERATED_MARKER)) {
      return {
        status: "skipped",
        reason: "manual_note_protected",
        outputPath,
        warnings: [`Protected manual note: ${path.basename(outputPath)}`],
      };
    }
    if (!force && existingInputHash(existing) === inputSha256) {
      return { status: "skipped", reason: "unchanged", outputPath, warnings: [] };
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const response = await aiClient.generateJson({
    prompt,
    input: {
      topic,
      transcript_metadata: processedTranscript.metadata ?? {},
      turns: selectedTurns,
    },
    schema: TOPIC_ANALYSIS_RESPONSE_SCHEMA,
    schemaName: "topic_analysis",
  });
  const analysis = parseTopicAnalysisResponse(response);
  validateTopicAnalysisResponse(analysis, selectedTurns);
  const markdown = renderTopicAnalysisMarkdown({
    processedTranscript,
    topic,
    analysis,
    inputSha256,
  });
  await writeMarkdownAtomically(outputPath, markdown);
  return {
    status: "written",
    outputPath,
    warnings: analysis.warnings,
    model: response?.model ?? aiClient.model ?? "unknown",
  };
}

export async function writeAllTopicAnalyses({
  aiClient,
  projectPath = process.cwd(),
  vaultPath = path.resolve(projectPath, "vault"),
  force = false,
}) {
  if (!aiClient || typeof aiClient.generateJson !== "function") {
    throw new Error("Topic analysis writer requires aiClient.generateJson");
  }
  const agentInstructions = await readFile(
    path.resolve(projectPath, TOPIC_ANALYSIS_AGENT_PATH),
    "utf8",
  );
  const topicDirectory = path.join(vaultPath, TOPIC_ANALYSES_PATH);
  let entries;
  try {
    entries = await readdir(topicDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { written: [], skipped: [], failed: [], warnings: [] };
    }
    throw error;
  }
  const topicFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith(".") &&
        entry.name.endsWith(".topics.json"),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  const results = { written: [], skipped: [], failed: [], warnings: [] };
  for (const topicFile of topicFiles) {
    const fileTranscriptId = topicFile.name.replace(/\.topics\.json$/, "");
    let transcriptId = fileTranscriptId;
    try {
      const topicSegmentation = JSON.parse(
        await readFile(path.join(topicDirectory, topicFile.name), "utf8"),
      );
      transcriptId = topicSegmentation.transcript_id ?? transcriptId;
      if (topicSegmentation.transcript_id !== fileTranscriptId) {
        throw new Error(
          "Topic segmentation transcript_id does not match its filename",
        );
      }
      const processedPath = path.join(
        vaultPath,
        "01 Transcripts",
        "Processed",
        `${transcriptId}.processed.json`,
      );
      const processedTranscript = JSON.parse(await readFile(processedPath, "utf8"));
      if (processedTranscript.transcript_id !== transcriptId) {
        throw new Error("Processed transcript_id does not match topic segmentation");
      }
      if (!Array.isArray(processedTranscript.turns)) {
        throw new Error("Processed transcript turns must be an array");
      }
      if (!Array.isArray(topicSegmentation.topics)) {
        throw new Error("Topic segmentation topics must be an array");
      }

      const slugCounts = new Map();
      const topicsWithSlugs = topicSegmentation.topics.map((topic) => {
        const baseSlug =
          normalizeTranscriptId(topic.title) || normalizeTranscriptId(topic.topic_id);
        const count = (slugCounts.get(baseSlug) ?? 0) + 1;
        slugCounts.set(baseSlug, count);
        return {
          ...topic,
          analysis_slug:
            count === 1 ? baseSlug : `${baseSlug}_${normalizeTranscriptId(topic.topic_id)}`,
        };
      });

      for (const topic of topicsWithSlugs) {
        try {
          const result = await writeTopicAnalysisNote({
            processedTranscript,
            topicSegmentation,
            topic,
            aiClient,
            agentInstructions,
            vaultPath,
            force,
          });
          results[result.status].push({
            transcript_id: transcriptId,
            topic_id: topic.topic_id,
            outputPath: result.outputPath,
            reason: result.reason,
          });
          results.warnings.push(...result.warnings);
        } catch (error) {
          results.failed.push({
            transcript_id: transcriptId,
            topic_id: topic.topic_id,
            error: error.message,
          });
        }
      }
    } catch (error) {
      results.failed.push({
        transcript_id: transcriptId,
        topic_id: null,
        error: error.message,
      });
    }
  }
  return results;
}
