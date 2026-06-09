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
  TOPIC_ANALYSIS_GENERATED_MARKER,
  writeAllTopicAnalyses,
  writeTopicAnalysisNote,
} from "../src/topicAnalysisWriter.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "topic-analysis-writer-"));
const projectPath = path.join(tempRoot, "project");
const vaultPath = path.join(projectPath, "vault");
const processedDirectory = path.join(vaultPath, "01 Transcripts", "Processed");
const topicDirectory = path.join(vaultPath, "02 Topic Analyses");
const agentsDirectory = path.join(vaultPath, "99 System", "Agents");

const processedTranscript = {
  schema_version: "processed_transcript.v1",
  analysis_version: "v1",
  generated: true,
  generator: "transcript_pipeline",
  transcript_id: "fixture_interview",
  metadata: {
    title: "Fixture Interview",
    source_file: "Fixture Interview.md",
    participants: ["Andy"],
    language: null,
    interview_date: "2026-06-09",
  },
  turns: [
    {
      turn_id: "turn_001",
      speaker: "Andy",
      speaker_id: "speaker_andy",
      text: "Participants need clear controls before they trust automated decisions.",
      position: 1,
      source_line_start: 1,
      source_line_end: 1,
    },
    {
      turn_id: "turn_002",
      speaker: "Unknown",
      speaker_id: "speaker_unknown",
      text: "The setup flow hides important privacy choices until the final screen.",
      position: 2,
      source_line_start: 2,
      source_line_end: 2,
    },
    {
      turn_id: "turn_003",
      speaker: "Andy",
      speaker_id: "speaker_andy",
      text: "A short explanation during onboarding would make the controls easier to understand.",
      position: 3,
      source_line_start: 3,
      source_line_end: 3,
    },
    {
      turn_id: "turn_004",
      speaker: "Andy",
      speaker_id: "speaker_andy",
      text: "Participants also wanted exports to be easier to find.",
      position: 4,
      source_line_start: 4,
      source_line_end: 4,
    },
  ],
  summaries: [],
  topics: [],
  evidence_candidates: [],
  source: {
    raw_path: "vault/01 Transcripts/Raw/Fixture Interview.md",
    raw_filename: "Fixture Interview.md",
    source_hash: "raw-hash",
    modified_at: "2026-06-09T01:00:00.000Z",
  },
  processed_at: "2026-06-09T01:30:00.000Z",
  warnings: [],
};

const topicSegmentation = {
  schema: "topic_segmentation.v1",
  transcript_id: "fixture_interview",
  source_processed_file:
    "vault/01 Transcripts/Processed/fixture_interview.processed.json",
  source_sha256: "processed-sha",
  generated_at: "2026-06-09T02:00:00.000Z",
  agent_prompt: "vault/99 System/Agents/Topic_Segmentation_Agent.md",
  model: "mock-segmentation-model",
  segments: [],
  topics: [
    {
      topic_id: "topic_001",
      title: "Privacy and User Control",
      start_turn: "turn_001",
      end_turn: "turn_003",
      summary: "Privacy controls and onboarding.",
      key_spans: [],
    },
    {
      topic_id: "topic_002",
      title: "Export Discoverability",
      start_turn: "turn_004",
      end_turn: "turn_004",
      summary: "Export discovery.",
      key_spans: [],
    },
  ],
  warnings: [],
};

function validAnalysis({ implications = true, suffix = "" } = {}) {
  return {
    summary: `Participants connected trust to visible, understandable controls${suffix}.`,
    key_points: [
      "Privacy choices were difficult to discover during setup, which weakened confidence in the automated experience.",
      "A concise explanation during onboarding could make existing controls easier to understand without changing their purpose.",
    ],
    design_implications: implications
      ? ["Surface supported privacy controls earlier in onboarding."]
      : [],
    confidence: "high",
    warnings: [],
  };
}

function mockAi(responses) {
  let call = 0;
  return {
    model: "mock-analysis-model",
    async generateJson() {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (response instanceof Error) {
        throw response;
      }
      return { json: structuredClone(response), model: "mock-analysis-model" };
    },
  };
}

try {
  await mkdir(processedDirectory, { recursive: true });
  await mkdir(topicDirectory, { recursive: true });
  await mkdir(agentsDirectory, { recursive: true });
  await writeFile(
    path.join(agentsDirectory, "Topic_Analysis_Writer_Agent.md"),
    "Mock agent instructions.",
    "utf8",
  );
  await writeFile(
    path.join(processedDirectory, "fixture_interview.processed.json"),
    JSON.stringify(processedTranscript),
    "utf8",
  );
  await writeFile(
    path.join(topicDirectory, "fixture_interview.topics.json"),
    JSON.stringify(topicSegmentation),
    "utf8",
  );

  const first = await writeAllTopicAnalyses({
    aiClient: mockAi([validAnalysis(), validAnalysis({ implications: false })]),
    projectPath,
  });
  assert.equal(first.written.length, 2);
  assert.equal(first.failed.length, 0);

  const firstPath = path.join(
    topicDirectory,
    "fixture_interview__privacy_and_user_control.md",
  );
  const secondPath = path.join(
    topicDirectory,
    "fixture_interview__export_discoverability.md",
  );
  const firstMarkdown = await readFile(firstPath, "utf8");
  const secondMarkdown = await readFile(secondPath, "utf8");
  assert.match(firstMarkdown, /^---\n/m);
  assert(firstMarkdown.includes("type: topic_analysis"));
  assert(firstMarkdown.includes("schema_version: topic_analysis.v1"));
  assert(firstMarkdown.includes(TOPIC_ANALYSIS_GENERATED_MARKER));
  assert(firstMarkdown.includes("## Summary"));
  assert(firstMarkdown.includes("## Key Points"));
  assert(firstMarkdown.includes("## Design Implications"));
  assert(firstMarkdown.includes("## Source"));
  assert(firstMarkdown.includes("## Turn Range"));
  assert(firstMarkdown.includes("turn_001 - turn_003"));
  assert(!secondMarkdown.includes("## Design Implications"));
  for (const turn of processedTranscript.turns) {
    assert(!firstMarkdown.includes(turn.text));
    assert(!secondMarkdown.includes(turn.text));
  }

  const beforeSkip = (await stat(firstPath)).mtimeMs;
  const skipped = await writeAllTopicAnalyses({
    aiClient: mockAi([new Error("AI should not be called")]),
    projectPath,
  });
  assert.equal(skipped.skipped.length, 2);
  assert.equal((await stat(firstPath)).mtimeMs, beforeSkip);

  const forced = await writeAllTopicAnalyses({
    aiClient: mockAi([
      validAnalysis({ suffix: " after force" }),
      validAnalysis({ implications: false, suffix: " after force" }),
    ]),
    projectPath,
    force: true,
  });
  assert.equal(forced.written.length, 2);
  assert((await readFile(firstPath, "utf8")).includes("after force"));

  await writeFile(firstPath, "# Manual note without generated marker\n", "utf8");
  const protectedRun = await writeAllTopicAnalyses({
    aiClient: mockAi([validAnalysis({ implications: false })]),
    projectPath,
    force: true,
  });
  assert(
    protectedRun.skipped.some(
      (item) => item.reason === "manual_note_protected",
    ),
  );
  assert.equal(
    await readFile(firstPath, "utf8"),
    "# Manual note without generated marker\n",
  );

  const invalidTopic = topicSegmentation.topics[1];
  const existingSecond = await readFile(secondPath, "utf8");
  await assert.rejects(
    writeTopicAnalysisNote({
      processedTranscript,
      topicSegmentation,
      topic: invalidTopic,
      aiClient: mockAi([{ summary: "", key_points: [] }]),
      agentInstructions: "Mock",
      vaultPath,
      force: true,
    }),
    /Topic analysis validation failed/,
  );
  assert.equal(await readFile(secondPath, "utf8"), existingSecond);

  let capturedPrompt = "";
  await writeTopicAnalysisNote({
    processedTranscript,
    topicSegmentation,
    topic: { ...topicSegmentation.topics[0], analysis_slug: "prompt_scope_test" },
    aiClient: {
      async generateJson(request) {
        capturedPrompt = request.prompt;
        return { json: validAnalysis() };
      },
    },
    agentInstructions: "Mock",
    vaultPath,
    force: true,
  });
  assert(capturedPrompt.includes("turn_001"));
  assert(capturedPrompt.includes("turn_003"));
  assert(!capturedPrompt.includes("turn_004"));

  const duplicateTitleSegmentation = {
    ...topicSegmentation,
    transcript_id: "duplicate_titles",
    topics: [
      { ...topicSegmentation.topics[0], title: "Same Topic" },
      { ...topicSegmentation.topics[1], title: "Same Topic" },
    ],
  };
  await writeFile(
    path.join(processedDirectory, "duplicate_titles.processed.json"),
    JSON.stringify({ ...processedTranscript, transcript_id: "duplicate_titles" }),
    "utf8",
  );
  await writeFile(
    path.join(topicDirectory, "duplicate_titles.topics.json"),
    JSON.stringify(duplicateTitleSegmentation),
    "utf8",
  );
  const duplicateResult = await writeAllTopicAnalyses({
    aiClient: mockAi([validAnalysis(), validAnalysis()]),
    projectPath,
  });
  assert(
    duplicateResult.written.some((item) =>
      item.outputPath.endsWith("duplicate_titles__same_topic.md"),
    ),
  );
  assert(
    duplicateResult.written.some((item) =>
      item.outputPath.endsWith("duplicate_titles__same_topic_topic_002.md"),
    ),
  );

  await writeFile(
    path.join(topicDirectory, "missing_processed.topics.json"),
    JSON.stringify({ ...topicSegmentation, transcript_id: "missing_processed" }),
    "utf8",
  );
  const missingProcessed = await writeAllTopicAnalyses({
    aiClient: mockAi([validAnalysis()]),
    projectPath,
  });
  assert(
    missingProcessed.failed.some(
      (item) => item.transcript_id === "missing_processed",
    ),
  );

  const emptyProject = path.join(tempRoot, "empty-project");
  await mkdir(path.join(emptyProject, "vault", "99 System", "Agents"), {
    recursive: true,
  });
  await writeFile(
    path.join(
      emptyProject,
      "vault",
      "99 System",
      "Agents",
      "Topic_Analysis_Writer_Agent.md",
    ),
    "Mock",
    "utf8",
  );
  const noTopics = await writeAllTopicAnalyses({
    aiClient: mockAi([validAnalysis()]),
    projectPath: emptyProject,
  });
  assert.deepEqual(noTopics.written, []);
  assert.deepEqual(noTopics.failed, []);

  const continueProject = path.join(tempRoot, "continue-project");
  const continueVault = path.join(continueProject, "vault");
  await mkdir(path.join(continueVault, "01 Transcripts", "Processed"), {
    recursive: true,
  });
  await mkdir(path.join(continueVault, "02 Topic Analyses"), { recursive: true });
  await mkdir(path.join(continueVault, "99 System", "Agents"), {
    recursive: true,
  });
  await writeFile(
    path.join(
      continueVault,
      "01 Transcripts",
      "Processed",
      "fixture_interview.processed.json",
    ),
    JSON.stringify(processedTranscript),
    "utf8",
  );
  await writeFile(
    path.join(
      continueVault,
      "02 Topic Analyses",
      "fixture_interview.topics.json",
    ),
    JSON.stringify(topicSegmentation),
    "utf8",
  );
  await writeFile(
    path.join(
      continueVault,
      "99 System",
      "Agents",
      "Topic_Analysis_Writer_Agent.md",
    ),
    "Mock",
    "utf8",
  );
  const continued = await writeAllTopicAnalyses({
    aiClient: mockAi([{ summary: "", key_points: [] }, validAnalysis()]),
    projectPath: continueProject,
  });
  assert.equal(continued.failed.length, 1);
  assert.equal(continued.written.length, 1);
  assert(
    continued.written[0].outputPath.endsWith(
      "fixture_interview__export_discoverability.md",
    ),
  );

  const topicFiles = await readdir(topicDirectory);
  assert(topicFiles.every((fileName) => !fileName.includes(".tmp-")));
  assert(topicFiles.filter((fileName) => fileName.endsWith(".md")).length >= 4);

  console.log("Topic analysis writer verification passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
