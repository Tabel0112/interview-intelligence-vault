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
  prepareEvidenceCards,
  writeAllEvidenceCards,
  writeEvidenceCardsForTranscript,
} from "../src/evidenceCardWriter.mjs";
import { EVIDENCE_CARD_GENERATED_MARKER } from "../src/evidenceCardTemplate.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "evidence-card-writer-"));
const projectPath = path.join(tempRoot, "project");
const vaultPath = path.join(projectPath, "vault");
const rawDirectory = path.join(vaultPath, "01 Transcripts", "Raw");
const processedDirectory = path.join(vaultPath, "01 Transcripts", "Processed");
const topicDirectory = path.join(vaultPath, "02 Topic Analyses");
const scoredDirectory = path.join(vaultPath, "03 Analysis", "Evidence_Candidates");
const cardDirectory = path.join(vaultPath, "03 Evidence Cards");
const rawPath = path.join(rawDirectory, "Fixture Interview.md");

const processedTranscript = {
  schema_version: "processed_transcript.v1",
  analysis_version: "v1",
  generated: true,
  generator: "transcript_pipeline",
  transcript_id: "fixture_interview",
  metadata: {
    title: "Fixture Interview",
    source_file: "Fixture Interview.md",
    participants: ["Aloha"],
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
      text: "设置里找不到 privacy controls，很麻烦。",
      position: 2,
      source_line_start: 2,
      source_line_end: 2,
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
  model: "mock-topic-model",
  segments: [],
  topics: [
    {
      topic_id: "topic_001",
      title: "Privacy & User Control",
      start_turn: "turn_001",
      end_turn: "turn_002",
      summary: "Privacy controls.",
      key_spans: [],
    },
  ],
  warnings: [],
};

function candidate({
  candidateId,
  quote = "a faster way",
  turnId = "turn_001",
  startChar = 7,
  speaker = "Aloha",
  context = "The participant is trying to find privacy controls.",
  meaning = "Privacy controls need better discoverability.",
  strength = "strong",
  score = 5,
  decision = "create_evidence_card",
} = {}) {
  return {
    candidate_id: candidateId,
    topic_id: "topic_001",
    quote,
    speaker,
    source_refs: [
      { turn_id: turnId, start_char: startChar, end_char: startChar + quote.length },
    ],
    context,
    meaning,
    evidence_category: "user_need",
    suggested_tags: ["privacy_controls"],
    strength,
    status: "candidate",
    source_turn_ids: [turnId],
    score_reasons: {
      specific_quote: true,
      product_user_market_strategy_related: true,
      future_decision_useful: true,
      supports_or_challenges_theme: score >= 4,
      non_obvious_insight: score >= 5,
    },
    score,
    score_rationale: "Specific evidence useful for a future product decision.",
    filter_decision: decision,
    dedupe_status: "kept",
    dedupe_of: null,
    rank: 1,
  };
}

const valid = candidate({ candidateId: "valid" });
const mixedQuote = "privacy controls，很麻烦";
const mixedText = processedTranscript.turns[1].text;
const mixed = candidate({
  candidateId: "mixed",
  quote: mixedQuote,
  turnId: "turn_002",
  startChar: mixedText.indexOf(mixedQuote),
  meaning: "Mixed-language users cannot find privacy controls.",
});
const duplicate = { ...structuredClone(valid), candidate_id: "duplicate" };
const ignored = candidate({
  candidateId: "ignored",
  decision: "keep_in_topic_analysis",
});
const lowScore = candidate({ candidateId: "low", score: 3 });
const missingQuote = candidate({ candidateId: "missing_quote", quote: "" });
const missingContext = candidate({ candidateId: "missing_context", context: "" });
const missingMeaning = candidate({ candidateId: "missing_meaning", meaning: "" });
const missingConfidence = candidate({
  candidateId: "missing_confidence",
  strength: "",
});
const missingScoreReason = candidate({ candidateId: "missing_score_reason" });
missingScoreReason.score_rationale = "";
const invalidTopic = candidate({ candidateId: "invalid_topic" });
invalidTopic.topic_id = "topic_999";
const hallucinated = candidate({
  candidateId: "hallucinated",
  quote: "hallucinated quote",
});
const speakerMismatch = candidate({
  candidateId: "speaker_mismatch",
  speaker: "Other",
});
const greeting = candidate({
  candidateId: "greeting",
  quote: "Hello",
  startChar: 0,
});

function scored(candidates) {
  return {
    schema_version: "scored_evidence_candidates.v1",
    transcript_id: "fixture_interview",
    source_candidate_file:
      "vault/03 Evidence/Candidates/fixture_interview.evidence_candidates.json",
    source_hash: "scored-source-hash",
    generated_at: "2026-06-09T03:00:00.000Z",
    selection_limits: {
      max_cards_per_topic: 3,
      target_cards_per_transcript_min: 10,
      target_cards_per_transcript_max: 15,
      hard_max_cards_per_transcript: 20,
    },
    scored_evidence_candidates: candidates,
    summary: {},
    warnings: [],
  };
}

try {
  const scoredEvidence = scored([
    valid,
    mixed,
    duplicate,
    ignored,
    lowScore,
    missingQuote,
    missingContext,
    missingMeaning,
    missingConfidence,
    missingScoreReason,
    invalidTopic,
    hallucinated,
    speakerMismatch,
    greeting,
  ]);
  const prepared = prepareEvidenceCards({
    scoredEvidence,
    processedTranscript,
    topicSegmentation,
  });
  assert.equal(prepared.cards.length, 2);
  assert.equal(prepared.deduplicated.length, 1);
  assert.equal(prepared.ignored.length, 2);
  assert.equal(prepared.rejected.length, 9);
  assert(
    prepared.rejected.some((item) => item.code === "quote_verification_failed"),
  );
  assert.deepEqual(
    prepared.cards.map((card) => card.evidence_id),
    [
      "fixture_interview__topic_001__evidence_001",
      "fixture_interview__topic_001__evidence_002",
    ],
  );
  assert.equal(prepared.cards[0].confidence, "high");
  assert.equal(prepared.cards[0].score_reason, valid.score_rationale);
  assert.throws(
    () =>
      prepareEvidenceCards({
        scoredEvidence,
        processedTranscript: {
          ...processedTranscript,
          metadata: {},
          source: { source_hash: "raw-hash" },
        },
        topicSegmentation,
      }),
    /source transcript title is required/,
  );

  await mkdir(rawDirectory, { recursive: true });
  await mkdir(processedDirectory, { recursive: true });
  await mkdir(topicDirectory, { recursive: true });
  await mkdir(scoredDirectory, { recursive: true });
  await writeFile(rawPath, "# Immutable raw transcript\n", "utf8");
  const rawBefore = await readFile(rawPath, "utf8");

  const first = await writeEvidenceCardsForTranscript({
    scoredEvidence,
    processedTranscript,
    topicSegmentation,
    vaultPath,
  });
  assert.equal(first.written.length, 2);
  assert.equal(first.rejected.length, 9);
  assert.equal(first.deduplicated.length, 1);
  const firstFiles = (await readdir(cardDirectory)).filter((name) => name.endsWith(".md"));
  assert.equal(firstFiles.length, 2);
  const firstPath = path.join(cardDirectory, firstFiles[0]);
  const firstMarkdown = await readFile(firstPath, "utf8");
  assert(firstMarkdown.includes(EVIDENCE_CARD_GENERATED_MARKER));
  assert(firstMarkdown.includes("type: evidence"));
  assert(firstMarkdown.includes('source_transcript_title: "Fixture Interview"'));
  assert(firstMarkdown.includes('topic_title: "Privacy & User Control"'));
  assert(firstMarkdown.includes("## Quote"));
  assert(firstMarkdown.includes("> a faster way"));
  assert(firstMarkdown.includes("[[Fixture Interview]]"));
  assert(firstMarkdown.includes("[[Topic Analysis - Privacy & User Control]]"));
  assert(!firstMarkdown.match(/^quote:/m));

  const beforeSkip = (await stat(firstPath)).mtimeMs;
  const unchanged = await writeEvidenceCardsForTranscript({
    scoredEvidence,
    processedTranscript,
    topicSegmentation,
    vaultPath,
  });
  assert.equal(unchanged.skippedUnchanged.length, 2);
  assert.equal((await stat(firstPath)).mtimeMs, beforeSkip);

  const forced = await writeEvidenceCardsForTranscript({
    scoredEvidence,
    processedTranscript,
    topicSegmentation,
    vaultPath,
    force: true,
  });
  assert.equal(forced.written.length, 2);
  assert.deepEqual(
    (await readdir(cardDirectory)).filter((name) => name.endsWith(".md")).sort(),
    firstFiles.sort(),
  );

  const changed = structuredClone(scoredEvidence);
  changed.scored_evidence_candidates.find(
    (item) => item.candidate_id === "valid",
  ).meaning = "A renamed evidence title that changes the deterministic slug.";
  changed.scored_evidence_candidates.find(
    (item) => item.candidate_id === "duplicate",
  ).filter_decision = "keep_in_topic_analysis";
  const beforeRename = (await readdir(cardDirectory)).filter((name) =>
    name.includes("evidence_001"),
  );
  const renamed = await writeEvidenceCardsForTranscript({
    scoredEvidence: changed,
    processedTranscript,
    topicSegmentation,
    vaultPath,
  });
  assert.equal(renamed.written.length, 1);
  const afterRename = (await readdir(cardDirectory)).filter((name) =>
    name.includes("evidence_001"),
  );
  assert.equal(beforeRename.length, 1);
  assert.equal(afterRename.length, 1);
  assert.notEqual(beforeRename[0], afterRename[0]);

  const manualPath = path.join(cardDirectory, afterRename[0]);
  await writeFile(
    manualPath,
    "---\nevidence_id: fixture_interview__topic_001__evidence_001\n---\n# Manual\n",
    "utf8",
  );
  const manual = await writeEvidenceCardsForTranscript({
    scoredEvidence: changed,
    processedTranscript,
    topicSegmentation,
    vaultPath,
    force: true,
  });
  assert.equal(manual.skippedManual.length, 1);
  assert.equal(
    await readFile(manualPath, "utf8"),
    "---\nevidence_id: fixture_interview__topic_001__evidence_001\n---\n# Manual\n",
  );

  const conflictScored = structuredClone(changed);
  conflictScored.scored_evidence_candidates.find(
    (item) => item.candidate_id === "valid",
  ).meaning = "Another title slug collision test.";
  const conflictPrepared = prepareEvidenceCards({
    scoredEvidence: conflictScored,
    processedTranscript,
    topicSegmentation,
  });
  const conflictCard = conflictPrepared.cards.find(
    (item) => item.evidence_id === "fixture_interview__topic_001__evidence_001",
  );
  const conflictFilename = `${conflictCard.evidence_id}__another_title_slug_collision_test.md`;
  const conflictPath = path.join(cardDirectory, conflictFilename);
  await writeFile(conflictPath, "# Conflicting manual note\n", "utf8");
  const conflict = await writeEvidenceCardsForTranscript({
    scoredEvidence: conflictScored,
    processedTranscript,
    topicSegmentation,
    vaultPath,
    force: true,
  });
  assert(
    conflict.skippedManual.some((item) => item.outputPath === conflictPath),
  );
  assert.equal(await readFile(conflictPath, "utf8"), "# Conflicting manual note\n");

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
  await writeFile(
    path.join(scoredDirectory, "fixture_interview.scored_evidence.json"),
    JSON.stringify(scoredEvidence),
    "utf8",
  );
  await writeFile(
    path.join(scoredDirectory, "missing_fixture.scored_evidence.json"),
    JSON.stringify({ ...scoredEvidence, transcript_id: "missing_fixture" }),
    "utf8",
  );
  const batch = await writeAllEvidenceCards({ projectPath, force: true });
  assert.equal(batch.failed.length, 1);
  assert(batch.written.length >= 1);
  assert.equal(await readFile(rawPath, "utf8"), rawBefore);
  const cardFiles = await readdir(cardDirectory);
  assert(cardFiles.every((name) => !name.includes(".tmp-")));
  console.log("Evidence card writer verification passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
