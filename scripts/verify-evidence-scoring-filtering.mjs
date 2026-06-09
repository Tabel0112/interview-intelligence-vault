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
  scoreAllEvidenceCandidates,
  scoreAndFilterEvidenceCandidates,
  validateScoredEvidenceOutput,
  validateScoringResponse,
} from "../src/evidenceScoringFiltering.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "evidence-scoring-"));
const projectPath = path.join(tempRoot, "project");
const vaultPath = path.join(projectPath, "vault");
const rawDirectory = path.join(vaultPath, "01 Transcripts", "Raw");
const inputDirectory = path.join(vaultPath, "03 Evidence", "Candidates");
const outputDirectory = path.join(vaultPath, "03 Analysis", "Evidence_Candidates");
const agentsDirectory = path.join(vaultPath, "99 System", "Agents");
const rawPath = path.join(rawDirectory, "Fixture Interview.md");
const inputPath = path.join(
  inputDirectory,
  "fixture_interview.evidence_candidates.json",
);
const outputPath = path.join(
  outputDirectory,
  "fixture_interview.scored_evidence.json",
);

function makeCandidate({
  transcriptId = "fixture_interview",
  topic = 1,
  sequence = 1,
  quote = `insightcode${topic}x${sequence} addresses issue${topic}x${sequence}`,
  turn = (topic - 1) * 10 + sequence,
  meaning = `meaningcode${topic}x${sequence} affects decision${topic}x${sequence}`,
} = {}) {
  const topicId = `topic_${String(topic).padStart(3, "0")}`;
  return {
    candidate_id: `${transcriptId}_${topicId}_ev_${String(sequence).padStart(3, "0")}`,
    topic_id: topicId,
    quote,
    speaker: "Participant",
    source_refs: [
      {
        turn_id: `turn_${String(turn).padStart(3, "0")}`,
        start_char: 0,
        end_char: quote.length,
      },
    ],
    context: `Context ${topic}-${sequence}`,
    meaning,
    evidence_category: "user_need",
    suggested_tags: [`candidate_${topic}_${sequence}`],
    strength: "strong",
    status: "candidate",
  };
}

function makeSource(candidates, transcriptId = "fixture_interview") {
  return {
    schema_version: "evidence_candidates.v1",
    transcript_id: transcriptId,
    source_hash: `source-hash-${transcriptId}`,
    generated_at: "2026-06-09T03:00:00.000Z",
    evidence_candidates: candidates,
    warnings: [],
  };
}

function reasons(score) {
  const keys = [
    "specific_quote",
    "product_user_market_strategy_related",
    "future_decision_useful",
    "supports_or_challenges_theme",
    "non_obvious_insight",
  ];
  return Object.fromEntries(keys.map((key, index) => [key, index < score]));
}

function scoringResponse(source, scoreById = new Map()) {
  return {
    candidates: source.evidence_candidates.map((candidate) => ({
      candidate_id: candidate.candidate_id,
      score_reasons: reasons(scoreById.get(candidate.candidate_id) ?? 5),
      score_rationale: `Auditable rationale for ${candidate.candidate_id}`,
    })),
  };
}

function mockAi(responses, captured = []) {
  let call = 0;
  return {
    async generateJson(request) {
      captured.push(structuredClone(request));
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (response instanceof Error) throw response;
      return typeof response === "string"
        ? response
        : { json: structuredClone(response) };
    },
  };
}

const smallCandidates = [
  makeCandidate({ topic: 1, sequence: 1, quote: "Exact repeated insight" }),
  makeCandidate({ topic: 1, sequence: 2 }),
  makeCandidate({ topic: 1, sequence: 3 }),
  makeCandidate({ topic: 1, sequence: 4 }),
  makeCandidate({ topic: 1, sequence: 5 }),
  makeCandidate({
    topic: 2,
    sequence: 1,
    quote: "Exact repeated insight",
    turn: 20,
    meaning: "Repeated insight",
  }),
  makeCandidate({ topic: 2, sequence: 2 }),
  makeCandidate({ topic: 2, sequence: 3 }),
];
const source = makeSource(smallCandidates);
const scoreById = new Map([
  [smallCandidates[0].candidate_id, 5],
  [smallCandidates[1].candidate_id, 5],
  [smallCandidates[2].candidate_id, 4],
  [smallCandidates[3].candidate_id, 4],
  [smallCandidates[4].candidate_id, 3],
  [smallCandidates[5].candidate_id, 5],
  [smallCandidates[6].candidate_id, 1],
  [smallCandidates[7].candidate_id, 2],
]);

try {
  const captured = [];
  const firstOutput = await scoreAndFilterEvidenceCandidates({
    sourceCandidates: source,
    aiClient: mockAi([scoringResponse(source, scoreById)], captured),
    sourceCandidateFile:
      "vault/03 Evidence/Candidates/fixture_interview.evidence_candidates.json",
    sourceHash: "fixture-input-sha",
    agentInstructions: "Mock scoring agent instructions.",
    generatedAt: "2026-06-09T04:00:00.000Z",
  });
  assert.equal(captured[0].reasoningEffort, "high");
  assert(captured[0].prompt.includes("Mock scoring agent instructions."));
  assert.equal(firstOutput.scored_evidence_candidates.length, source.evidence_candidates.length);
  assert.equal(firstOutput.summary.total_candidates, source.evidence_candidates.length);
  assert.equal(firstOutput.summary.selected_for_evidence_cards, 3);
  assert.equal(firstOutput.summary.duplicates_marked, 1);

  const byId = new Map(
    firstOutput.scored_evidence_candidates.map((candidate) => [
      candidate.candidate_id,
      candidate,
    ]),
  );
  assert.equal(byId.get(smallCandidates[0].candidate_id).score, 5);
  assert.equal(
    byId.get(smallCandidates[0].candidate_id).filter_decision,
    "create_evidence_card",
  );
  assert.equal(
    byId.get(smallCandidates[4].candidate_id).filter_decision,
    "keep_in_topic_analysis",
  );
  assert.equal(
    byId.get(smallCandidates[6].candidate_id).filter_decision,
    "raw_only",
  );
  assert.equal(
    byId.get(smallCandidates[3].candidate_id).filter_decision,
    "keep_in_topic_analysis",
  );
  assert.equal(byId.get(smallCandidates[5].candidate_id).dedupe_status, "duplicate");
  assert.equal(
    byId.get(smallCandidates[5].candidate_id).dedupe_of,
    smallCandidates[0].candidate_id,
  );
  assert.equal(
    byId.get(smallCandidates[5].candidate_id).filter_decision,
    "keep_in_topic_analysis",
  );
  assert.equal(byId.get(smallCandidates[0].candidate_id).quote, smallCandidates[0].quote);
  assert.deepEqual(
    byId.get(smallCandidates[0].candidate_id).source_refs,
    smallCandidates[0].source_refs,
  );

  const repeatedOutput = await scoreAndFilterEvidenceCandidates({
    sourceCandidates: source,
    aiClient: mockAi([scoringResponse(source, scoreById)]),
    sourceCandidateFile:
      "vault/03 Evidence/Candidates/fixture_interview.evidence_candidates.json",
    sourceHash: "fixture-input-sha",
    generatedAt: "2026-06-09T05:00:00.000Z",
  });
  assert.deepEqual(
    repeatedOutput.scored_evidence_candidates.map(({ candidate_id, rank, filter_decision, dedupe_status, dedupe_of }) => ({
      candidate_id,
      rank,
      filter_decision,
      dedupe_status,
      dedupe_of,
    })),
    firstOutput.scored_evidence_candidates.map(({ candidate_id, rank, filter_decision, dedupe_status, dedupe_of }) => ({
      candidate_id,
      rank,
      filter_decision,
      dedupe_status,
      dedupe_of,
    })),
  );

  const emptySource = makeSource([]);
  const emptyOutput = await scoreAndFilterEvidenceCandidates({
    sourceCandidates: emptySource,
    aiClient: mockAi([{ candidates: [] }]),
    sourceCandidateFile: "empty.json",
    sourceHash: "empty-hash",
  });
  assert.equal(emptyOutput.summary.total_candidates, 0);
  assert.deepEqual(emptyOutput.scored_evidence_candidates, []);

  const duplicatePriorityCandidates = [
    makeCandidate({
      topic: 1,
      sequence: 1,
      quote: "Same exact duplicate quote",
      turn: 1,
    }),
    makeCandidate({
      topic: 2,
      sequence: 1,
      quote: "Same exact duplicate quote",
      turn: 2,
    }),
  ];
  const duplicatePrioritySource = makeSource(duplicatePriorityCandidates);
  const duplicatePriorityResponse = scoringResponse(duplicatePrioritySource);
  duplicatePriorityResponse.candidates[0].score_reasons = {
    specific_quote: true,
    product_user_market_strategy_related: false,
    future_decision_useful: true,
    supports_or_challenges_theme: true,
    non_obvious_insight: true,
  };
  duplicatePriorityResponse.candidates[1].score_reasons = {
    specific_quote: false,
    product_user_market_strategy_related: true,
    future_decision_useful: true,
    supports_or_challenges_theme: true,
    non_obvious_insight: true,
  };
  const duplicatePriorityOutput = await scoreAndFilterEvidenceCandidates({
    sourceCandidates: duplicatePrioritySource,
    aiClient: mockAi([duplicatePriorityResponse]),
    sourceCandidateFile: "duplicate-priority.json",
    sourceHash: "duplicate-priority-hash",
  });
  assert.equal(
    duplicatePriorityOutput.scored_evidence_candidates.find(
      (candidate) => candidate.dedupe_status === "kept",
    ).candidate_id,
    duplicatePriorityCandidates[0].candidate_id,
  );

  const tamperedScore = structuredClone(firstOutput);
  tamperedScore.scored_evidence_candidates[0].score = 0;
  assert.throws(
    () => validateScoredEvidenceOutput(tamperedScore, source),
    /score does not match reasons/,
  );
  const tamperedQuote = structuredClone(firstOutput);
  tamperedQuote.scored_evidence_candidates[0].quote = "Rewritten quote";
  assert.throws(
    () => validateScoredEvidenceOutput(tamperedQuote, source),
    /quote changed/,
  );
  const missingSourceTurns = structuredClone(firstOutput);
  delete missingSourceTurns.scored_evidence_candidates[0].source_turn_ids;
  assert.throws(
    () => validateScoredEvidenceOutput(missingSourceTurns, source),
    /source_turn_ids/,
  );
  const tamperedDecision = structuredClone(firstOutput);
  tamperedDecision.scored_evidence_candidates.find(
    (candidate) => candidate.filter_decision === "create_evidence_card",
  ).filter_decision = "keep_in_topic_analysis";
  assert.throws(
    () => validateScoredEvidenceOutput(tamperedDecision, source),
    /filter_decision is not deterministic|summary does not match/,
  );
  const tamperedDedupe = structuredClone(firstOutput);
  tamperedDedupe.scored_evidence_candidates.find(
    (candidate) => candidate.dedupe_status === "duplicate",
  ).dedupe_status = "kept";
  assert.throws(
    () => validateScoredEvidenceOutput(tamperedDedupe, source),
    /dedupe_status|dedupe_of/,
  );
  const tamperedTranscript = structuredClone(firstOutput);
  tamperedTranscript.transcript_id = "different_transcript";
  assert.throws(
    () => validateScoredEvidenceOutput(tamperedTranscript, source),
    /transcript_id changed/,
  );

  const validResponse = scoringResponse(source, scoreById);
  const added = structuredClone(validResponse);
  added.candidates.push({
    candidate_id: "invented_candidate",
    score_reasons: reasons(5),
    score_rationale: "Invented",
  });
  assert.throws(
    () => validateScoringResponse(added, source.evidence_candidates),
    /created unknown candidate/,
  );
  const dropped = structuredClone(validResponse);
  dropped.candidates.pop();
  assert.throws(
    () => validateScoringResponse(dropped, source.evidence_candidates),
    /dropped candidates/,
  );
  const missingCandidateId = structuredClone(validResponse);
  delete missingCandidateId.candidates[0].candidate_id;
  assert.throws(
    () => validateScoringResponse(missingCandidateId, source.evidence_candidates),
    /unsupported or missing fields|missing candidate_id/,
  );
  const modifiedQuoteAttempt = structuredClone(validResponse);
  modifiedQuoteAttempt.candidates[0].quote = "Changed";
  assert.throws(
    () => validateScoringResponse(modifiedQuoteAttempt, source.evidence_candidates),
    /unsupported or missing fields/,
  );
  const proposedScoreMismatch = structuredClone(validResponse);
  proposedScoreMismatch.candidates[0].score = 0;
  delete proposedScoreMismatch.candidates[0].score;
  proposedScoreMismatch.candidates[0].proposed_score = 0;
  assert.doesNotThrow(
    () => validateScoringResponse(proposedScoreMismatch, source.evidence_candidates),
  );
  const ignoredProposedScore = await scoreAndFilterEvidenceCandidates({
    sourceCandidates: source,
    aiClient: mockAi([proposedScoreMismatch]),
    sourceCandidateFile: "proposed-score.json",
    sourceHash: "hash",
  });
  assert.equal(
    ignoredProposedScore.scored_evidence_candidates.find(
      (candidate) => candidate.candidate_id === smallCandidates[0].candidate_id,
    ).score,
    5,
  );
  const missingTopic = structuredClone(source);
  delete missingTopic.evidence_candidates[0].topic_id;
  await assert.rejects(
    scoreAndFilterEvidenceCandidates({
      sourceCandidates: missingTopic,
      aiClient: mockAi([validResponse]),
      sourceCandidateFile: "missing-topic.json",
      sourceHash: "hash",
    }),
    /topic_id/,
  );
  const missingSourceRef = structuredClone(source);
  delete missingSourceRef.evidence_candidates[0].source_refs;
  await assert.rejects(
    scoreAndFilterEvidenceCandidates({
      sourceCandidates: missingSourceRef,
      aiClient: mockAi([validResponse]),
      sourceCandidateFile: "missing-source.json",
      sourceHash: "hash",
    }),
    /source_refs/,
  );

  const manyCandidates = [];
  for (let topic = 1; topic <= 7; topic += 1) {
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      manyCandidates.push(
        makeCandidate({
          transcriptId: "many_fixture",
          topic,
          sequence,
          turn: topic * 100 + sequence,
        }),
      );
    }
  }
  const manySource = makeSource(manyCandidates, "many_fixture");
  const cappedOutput = await scoreAndFilterEvidenceCandidates({
    sourceCandidates: manySource,
    aiClient: mockAi([scoringResponse(manySource)]),
    sourceCandidateFile:
      "vault/03 Evidence/Candidates/many_fixture.evidence_candidates.json",
    sourceHash: "many-hash",
  });
  assert.equal(cappedOutput.summary.selected_for_evidence_cards, 20);
  for (let topic = 1; topic <= 7; topic += 1) {
    const topicId = `topic_${String(topic).padStart(3, "0")}`;
    assert(
      cappedOutput.scored_evidence_candidates.filter(
        (candidate) =>
          candidate.topic_id === topicId &&
          candidate.filter_decision === "create_evidence_card",
      ).length <= 3,
    );
  }
  assert(
    cappedOutput.scored_evidence_candidates.some(
      (candidate) =>
        candidate.score === 5 &&
        candidate.dedupe_status === "kept" &&
        candidate.filter_decision === "keep_in_topic_analysis",
    ),
  );

  const overlapSource = makeSource([
    makeCandidate({
      topic: 1,
      sequence: 1,
      quote: "Pricing approval blocks procurement",
      meaning: "Budget approval delays the purchase",
      turn: 1,
    }),
    {
      ...makeCandidate({
        topic: 2,
        sequence: 1,
        quote: "Navigation controls confuse new users",
        meaning: "Onboarding requires clearer controls",
        turn: 1,
      }),
      source_refs: [{ turn_id: "turn_001", start_char: 5, end_char: 25 }],
    },
  ]);
  const overlapOutput = await scoreAndFilterEvidenceCandidates({
    sourceCandidates: overlapSource,
    aiClient: mockAi([scoringResponse(overlapSource)]),
    sourceCandidateFile: "overlap.json",
    sourceHash: "overlap-hash",
  });
  assert.equal(overlapOutput.summary.duplicates_marked, 0);

  const priorityCandidates = [];
  for (let topic = 1; topic <= 7; topic += 1) {
    for (let sequence = 1; sequence <= 3; sequence += 1) {
      priorityCandidates.push(
        makeCandidate({
          transcriptId: "priority_fixture",
          topic,
          sequence,
          turn: topic * 100 + sequence,
        }),
      );
    }
  }
  const prioritySource = makeSource(priorityCandidates, "priority_fixture");
  const priorityResponse = scoringResponse(prioritySource);
  priorityResponse.candidates.forEach((result, index) => {
    result.score_reasons = index === priorityResponse.candidates.length - 1
      ? {
          specific_quote: true,
          product_user_market_strategy_related: true,
          future_decision_useful: false,
          supports_or_challenges_theme: true,
          non_obvious_insight: true,
        }
      : {
          specific_quote: true,
          product_user_market_strategy_related: true,
          future_decision_useful: true,
          supports_or_challenges_theme: true,
          non_obvious_insight: false,
        };
  });
  const priorityOutput = await scoreAndFilterEvidenceCandidates({
    sourceCandidates: prioritySource,
    aiClient: mockAi([priorityResponse]),
    sourceCandidateFile: "priority.json",
    sourceHash: "priority-hash",
  });
  assert.equal(priorityOutput.summary.selected_for_evidence_cards, 20);
  assert.equal(
    priorityOutput.scored_evidence_candidates.find(
      (candidate) =>
        candidate.candidate_id ===
        priorityCandidates[priorityCandidates.length - 1].candidate_id,
    ).filter_decision,
    "keep_in_topic_analysis",
  );

  await mkdir(rawDirectory, { recursive: true });
  await mkdir(inputDirectory, { recursive: true });
  await mkdir(agentsDirectory, { recursive: true });
  await writeFile(rawPath, "# Immutable raw transcript\n", "utf8");
  await writeFile(inputPath, `${JSON.stringify(source, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(agentsDirectory, "Evidence_Scoring_Filtering_Agent.md"),
    "Mock scoring agent instructions.",
    "utf8",
  );
  const rawBefore = await readFile(rawPath, "utf8");
  const batchFirst = await scoreAllEvidenceCandidates({
    aiClient: mockAi([validResponse]),
    projectPath,
  });
  assert.equal(batchFirst.processed.length, 1);
  assert.equal(batchFirst.failed.length, 0);
  assert.equal(batchFirst.selectedCount, 3);
  const written = JSON.parse(await readFile(outputPath, "utf8"));
  assert.equal(written.schema_version, "scored_evidence_candidates.v1");
  assert.equal(written.scored_evidence_candidates.length, source.evidence_candidates.length);

  const beforeSkip = (await stat(outputPath)).mtimeMs;
  const skipped = await scoreAllEvidenceCandidates({
    aiClient: mockAi([new Error("AI should not be called")]),
    projectPath,
  });
  assert.equal(skipped.skipped[0].reason, "unchanged");
  assert.equal((await stat(outputPath)).mtimeMs, beforeSkip);

  const forced = await scoreAllEvidenceCandidates({
    aiClient: mockAi([validResponse]),
    projectPath,
    force: true,
  });
  assert.equal(forced.processed.length, 1);
  const validBeforeInvalid = await readFile(outputPath, "utf8");
  const invalid = await scoreAllEvidenceCandidates({
    aiClient: mockAi(["not valid JSON"]),
    projectPath,
    force: true,
  });
  assert.equal(invalid.failed.length, 1);
  assert.equal(await readFile(outputPath, "utf8"), validBeforeInvalid);

  const secondSource = makeSource(
    [makeCandidate({ transcriptId: "second_fixture" })],
    "second_fixture",
  );
  await writeFile(
    path.join(inputDirectory, "second_fixture.evidence_candidates.json"),
    `${JSON.stringify(secondSource, null, 2)}\n`,
    "utf8",
  );
  const isolated = await scoreAllEvidenceCandidates({
    aiClient: mockAi([
      new Error("first transcript failed"),
      scoringResponse(secondSource),
    ]),
    projectPath,
    force: true,
  });
  assert.equal(isolated.failed.length, 1);
  assert.equal(isolated.processed.length, 1);
  assert.equal(isolated.processed[0].transcript_id, "second_fixture");

  const missing = await scoreAllEvidenceCandidates({
    aiClient: mockAi([new Error("AI should not be called")]),
    projectPath,
    transcriptId: "missing_fixture",
  });
  assert.equal(missing.skipped[0].reason, "missing_candidate_file");
  assert.equal(await readFile(rawPath, "utf8"), rawBefore);
  const outputEntries = await readdir(outputDirectory);
  assert(outputEntries.every((name) => !name.includes(".tmp-")));
  console.log("Evidence scoring/filtering verification passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
