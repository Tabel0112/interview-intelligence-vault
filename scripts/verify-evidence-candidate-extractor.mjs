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
  extractAllEvidenceCandidates,
  validateTopicCandidates,
} from "../src/evidenceCandidateExtractor.mjs";
import { writeTopicSegmentationFile } from "../src/topicSegmentationAgent.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "evidence-candidates-"));
const projectPath = path.join(tempRoot, "project");
const vaultPath = path.join(projectPath, "vault");
const rawDirectory = path.join(vaultPath, "01 Transcripts", "Raw");
const processedDirectory = path.join(vaultPath, "01 Transcripts", "Processed");
const topicDirectory = path.join(vaultPath, "02 Topic Analyses");
const outputDirectory = path.join(vaultPath, "03 Evidence", "Candidates");
const agentsDirectory = path.join(vaultPath, "99 System", "Agents");
const rawPath = path.join(rawDirectory, "Fixture Interview.md");
const outputPath = path.join(
  outputDirectory,
  "fixture_interview.evidence_candidates.json",
);

const processedTranscript = {
  schema_version: "processed_transcript.v1",
  analysis_version: "v1",
  generated: true,
  generator: "transcript_pipeline",
  transcript_id: "fixture_interview",
  metadata: {
    title: "Fixture Interview",
    source_file: "Fixture Interview.md",
    participants: ["Aloha", "Interviewer"],
    language: "en",
    interview_date: "2026-06-09",
  },
  turns: [
    {
      turn_id: "turn_001",
      speaker: "Aloha",
      speaker_id: "speaker_aloha",
      text: "I need a faster way to find privacy controls.",
      position: 1,
      source_line_start: 1,
      source_line_end: 1,
    },
    {
      turn_id: "turn_002",
      speaker: "Aloha",
      speaker_id: "speaker_aloha",
      text: "I currently write the settings down on paper.",
      position: 2,
      source_line_start: 2,
      source_line_end: 2,
    },
    {
      turn_id: "turn_003",
      speaker: "Interviewer",
      speaker_id: "speaker_interviewer",
      text: "What would make exports easier?",
      position: 3,
      source_line_start: 3,
      source_line_end: 3,
    },
  ],
  summaries: [],
  topics: [],
  evidence_candidates: [],
  source: {
    raw_path: "vault/01 Transcripts/Raw/Fixture Interview.md",
    raw_filename: "Fixture Interview.md",
    source_hash: "raw-source-hash",
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
  source_sha256: "processed-source-hash",
  generated_at: "2026-06-09T02:00:00.000Z",
  agent_prompt: "vault/99 System/Agents/Topic_Segmentation_Agent.md",
  model: "mock-topic-model",
  segments: [],
  topics: [
    {
      topic_id: "topic_001",
      title: "Privacy workflow",
      start_turn: "turn_001",
      end_turn: "turn_002",
      summary: "Finding and recording privacy controls.",
      key_spans: [],
    },
    {
      topic_id: "topic_002",
      title: "Exports",
      start_turn: "turn_003",
      end_turn: "turn_003",
      summary: "Export discoverability.",
      key_spans: [],
    },
  ],
  warnings: [],
};

function sourceCandidate({
  quote = "a faster way",
  turnId = "turn_001",
  startChar = 7,
  endChar = 19,
  category = "user_need",
  strength = "strong",
} = {}) {
  return {
    quote,
    source_refs: [
      { turn_id: turnId, start_char: startChar, end_char: endChar },
    ],
    context: "The participant is describing difficulty finding controls.",
    meaning: "Control discovery needs improvement.",
    evidence_category: category,
    suggested_tags: ["privacy_controls"],
    strength,
  };
}

function candidateFromQuote(turnId, quote, overrides = {}) {
  const turn = processedTranscript.turns.find((item) => item.turn_id === turnId);
  const startChar = turn.text.indexOf(quote);
  assert.notEqual(startChar, -1);
  return sourceCandidate({
    quote,
    turnId,
    startChar,
    endChar: startChar + quote.length,
    ...overrides,
  });
}

function mockAi(responses, captured = []) {
  let call = 0;
  return {
    async generateJson(request) {
      captured.push(structuredClone(request));
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (response instanceof Error) throw response;
      return typeof response === "string" ? response : { json: structuredClone(response) };
    },
  };
}

try {
  await mkdir(rawDirectory, { recursive: true });
  await mkdir(processedDirectory, { recursive: true });
  await mkdir(topicDirectory, { recursive: true });
  await mkdir(agentsDirectory, { recursive: true });
  await writeFile(
    path.join(agentsDirectory, "Evidence_Candidate_Extractor_Agent.md"),
    "Mock evidence candidate agent instructions.",
    "utf8",
  );
  await writeFile(rawPath, "# Immutable raw transcript\n", "utf8");
  await writeFile(
    path.join(processedDirectory, "fixture_interview.processed.json"),
    JSON.stringify(processedTranscript),
    "utf8",
  );
  const part6TopicPath = await writeTopicSegmentationFile(topicSegmentation, {
    vaultPath,
  });
  assert.equal(
    part6TopicPath,
    path.join(topicDirectory, "fixture_interview.topics.json"),
  );
  const rawBefore = await readFile(rawPath, "utf8");
  const captured = [];

  const first = await extractAllEvidenceCandidates({
    aiClient: mockAi(
      [
        {
          candidates: [
            candidateFromQuote("turn_002", "write the settings", {
              category: "workaround",
            }),
            sourceCandidate(),
            sourceCandidate({ quote: "hallucinated quote" }),
            sourceCandidate(),
          ],
        },
        { candidates: [] },
      ],
      captured,
    ),
    projectPath,
  });
  assert.equal(first.processed.length, 1);
  assert.equal(first.failed.length, 0);
  assert.equal(first.candidateCount, 2);
  const output = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(output.schema_version, "evidence_candidates.v1");
  assert.equal(output.transcript_id, "fixture_interview");
  assert.equal(
    output.evidence_candidates[0].candidate_id,
    "fixture_interview_topic_001_ev_001",
  );
  assert.equal(
    output.evidence_candidates[1].candidate_id,
    "fixture_interview_topic_001_ev_002",
  );
  assert.equal(output.evidence_candidates[0].topic_id, "topic_001");
  assert.equal(output.evidence_candidates[0].speaker, "Aloha");
  assert.equal(output.evidence_candidates[1].quote, "write the settings");
  assert(
    output.warnings.some((item) => item.code === "quote_pointer_mismatch"),
  );
  assert(output.warnings.some((item) => item.code === "duplicate_candidate"));
  const ref = output.evidence_candidates[0].source_refs[0];
  assert.equal(
    processedTranscript.turns[0].text.slice(ref.start_char, ref.end_char),
    output.evidence_candidates[0].quote,
  );
  assert.equal(captured.length, 2);
  assert.equal(captured[0].input.turns.length, 2);
  assert.equal(captured[1].input.turns.length, 1);
  assert(!captured[0].prompt.includes(processedTranscript.turns[2].text));
  assert(captured[0].prompt.includes("Mock evidence candidate agent instructions."));
  assert.equal(captured[0].reasoningEffort, "medium");

  const topic = topicSegmentation.topics[0];
  const direct = validateTopicCandidates({
    topic,
    processedTranscript,
    response: {
      candidates: [
        sourceCandidate(),
        sourceCandidate(),
        sourceCandidate({ quote: "wrong quote" }),
        sourceCandidate({ category: "invalid_category" }),
        sourceCandidate({ strength: "invalid_strength" }),
        sourceCandidate(),
        sourceCandidate(),
      ],
    },
  });
  assert.equal(direct.candidates.length, 1);
  assert(direct.warnings.some((item) => item.code === "candidate_limit_exceeded"));
  assert(direct.warnings.some((item) => item.code === "duplicate_candidate"));
  assert(direct.warnings.some((item) => item.code === "quote_pointer_mismatch"));
  assert(direct.warnings.some((item) => item.code === "invalid_evidence_category"));
  assert(direct.warnings.some((item) => item.code === "invalid_evidence_strength"));

  const overLimit = validateTopicCandidates({
    topic,
    processedTranscript,
    response: {
      candidates: [
        candidateFromQuote("turn_001", "I need"),
        candidateFromQuote("turn_001", "need"),
        candidateFromQuote("turn_001", "a faster way"),
        candidateFromQuote("turn_001", "find"),
        candidateFromQuote("turn_001", "privacy"),
        candidateFromQuote("turn_001", "controls"),
        candidateFromQuote("turn_002", "write the settings", {
          category: "workaround",
        }),
        sourceCandidate({ quote: "hallucinated quote" }),
      ],
    },
  });
  assert.equal(overLimit.candidates.length, 5);
  assert(
    overLimit.warnings.some((item) => item.code === "candidate_limit_exceeded"),
  );
  assert(
    overLimit.warnings.some((item) => item.code === "quote_pointer_mismatch"),
  );

  const sorted = validateTopicCandidates({
    topic,
    processedTranscript,
    response: {
      candidates: [
        sourceCandidate({
          quote: "write the settings",
          turnId: "turn_002",
          startChar: 12,
          endChar: 30,
          category: "workaround",
        }),
        sourceCandidate(),
      ],
    },
  });
  assert.deepEqual(
    sorted.candidates.map((candidate) => candidate.source_refs[0].turn_id),
    ["turn_001", "turn_002"],
  );

  const mixedText = "设置里找不到 privacy controls，很麻烦。";
  const mixedQuote = "privacy controls，很麻烦";
  const mixedStart = mixedText.indexOf(mixedQuote);
  const multilingual = validateTopicCandidates({
    topic: {
      topic_id: "topic_001",
      start_turn: "turn_001",
      end_turn: "turn_001",
    },
    processedTranscript: {
      turns: [
        {
          turn_id: "turn_001",
          speaker: "参与者",
          text: mixedText,
        },
      ],
    },
    response: {
      candidates: [
        {
          ...sourceCandidate({ quote: mixedQuote }),
          source_refs: [
            {
              turn_id: "turn_001",
              start_char: mixedStart,
              end_char: mixedStart + mixedQuote.length,
            },
          ],
        },
      ],
    },
  });
  assert.equal(multilingual.candidates.length, 1);
  assert.equal(
    mixedText.slice(
      multilingual.candidates[0].source_refs[0].start_char,
      multilingual.candidates[0].source_refs[0].end_char,
    ),
    mixedQuote,
  );

  const beforeSkip = (await stat(outputPath)).mtimeMs;
  const skipped = await extractAllEvidenceCandidates({
    aiClient: mockAi([new Error("AI should not be called")]),
    projectPath,
  });
  assert.equal(skipped.skipped[0].reason, "unchanged");
  assert.equal((await stat(outputPath)).mtimeMs, beforeSkip);

  const forced = await extractAllEvidenceCandidates({
    aiClient: mockAi([
      {
        candidates: [
          candidateFromQuote("turn_002", "write the settings", {
            category: "workaround",
          }),
          sourceCandidate(),
        ],
      },
      { candidates: [] },
    ]),
    projectPath,
    force: true,
  });
  assert.equal(forced.processed.length, 1);
  const forcedOutput = JSON.parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(
    forcedOutput.evidence_candidates.map(({ candidate_id, quote }) => ({
      candidate_id,
      quote,
    })),
    output.evidence_candidates.map(({ candidate_id, quote }) => ({
      candidate_id,
      quote,
    })),
  );

  const repeated = await extractAllEvidenceCandidates({
    aiClient: mockAi([
      {
        candidates: [
          candidateFromQuote("turn_002", "write the settings", {
            category: "workaround",
          }),
          sourceCandidate(),
        ],
      },
      { candidates: [] },
    ]),
    projectPath,
    force: true,
  });
  assert.equal(repeated.processed.length, 1);
  const repeatedOutput = JSON.parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(
    repeatedOutput.evidence_candidates.map((candidate) => candidate.candidate_id),
    forcedOutput.evidence_candidates.map((candidate) => candidate.candidate_id),
  );

  const validBeforeInvalid = await readFile(outputPath, "utf8");
  const invalid = await extractAllEvidenceCandidates({
    aiClient: mockAi(["not valid JSON"]),
    projectPath,
    force: true,
  });
  assert.equal(invalid.failed.length, 1);
  assert.equal(await readFile(outputPath, "utf8"), validBeforeInvalid);

  await writeFile(
    path.join(topicDirectory, "missing_processed.topics.json"),
    JSON.stringify({
      ...topicSegmentation,
      transcript_id: "missing_processed",
      source_processed_file:
        "vault/01 Transcripts/Processed/missing_processed.processed.json",
    }),
    "utf8",
  );
  const missingProcessed = await extractAllEvidenceCandidates({
    aiClient: mockAi([new Error("AI should not be called")]),
    projectPath,
    transcriptId: "missing_processed",
  });
  assert.equal(missingProcessed.skipped[0].reason, "missing_processed_transcript");
  assert.match(missingProcessed.warnings[0], /Missing processed transcript/);

  const missingTopic = await extractAllEvidenceCandidates({
    aiClient: mockAi([new Error("AI should not be called")]),
    projectPath,
    transcriptId: "missing_topic",
  });
  assert.equal(missingTopic.skipped[0].reason, "missing_topic_segmentation");
  assert.match(missingTopic.warnings[0], /Missing topic segmentation/);

  assert.equal(await readFile(rawPath, "utf8"), rawBefore);
  const outputEntries = await readdir(outputDirectory);
  assert.deepEqual(
    outputEntries.filter((name) => name.endsWith(".evidence_candidates.json")),
    ["fixture_interview.evidence_candidates.json"],
  );
  assert(outputEntries.every((name) => !name.includes(".tmp-")));
  console.log("Evidence candidate extractor verification passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
