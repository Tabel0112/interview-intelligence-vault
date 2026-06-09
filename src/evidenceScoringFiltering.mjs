import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateEvidenceCandidatesOutput } from "./evidenceCandidateExtractor.mjs";
import {
  EVIDENCE_SCORING_RESPONSE_SCHEMA,
  SCORE_REASON_KEYS,
  buildEvidenceScoringPrompt,
} from "./evidenceScoringPrompt.mjs";

export const SCORED_EVIDENCE_SCHEMA_VERSION = "scored_evidence_candidates.v1";
export const SCORED_EVIDENCE_PATH = path.join(
  "03 Analysis",
  "Evidence_Candidates",
);
export const EVIDENCE_SCORING_AGENT_PATH =
  "vault/99 System/Agents/Evidence_Scoring_Filtering_Agent.md";
export const SELECTION_LIMITS = {
  max_cards_per_topic: 3,
  target_cards_per_transcript_min: 10,
  target_cards_per_transcript_max: 15,
  hard_max_cards_per_transcript: 20,
};

const FILTER_DECISIONS = [
  "create_evidence_card",
  "keep_in_topic_analysis",
  "raw_only",
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizedText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokenSimilarity(left, right) {
  const units = (value) => {
    const normalized = normalizedText(value);
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length > 1 || normalized.length < 2) return new Set(tokens);
    return new Set(
      Array.from({ length: normalized.length - 1 }, (_, index) =>
        normalized.slice(index, index + 2),
      ),
    );
  };
  const leftTokens = units(left);
  const rightTokens = units(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token));
  const union = new Set([...leftTokens, ...rightTokens]);
  return intersection.length / union.size;
}

function sourcePosition(candidate) {
  const ref = candidate.source_refs?.[0];
  const turnMatch = ref?.turn_id?.match(/\d+$/);
  return {
    turn: turnMatch ? Number(turnMatch[0]) : Number.MAX_SAFE_INTEGER,
    start: Number.isInteger(ref?.start_char) ? ref.start_char : Number.MAX_SAFE_INTEGER,
  };
}

function rankingComparator(left, right) {
  const leftPosition = sourcePosition(left);
  const rightPosition = sourcePosition(right);
  return (
    right.score - left.score ||
    Number(right.score_reasons.future_decision_useful) -
      Number(left.score_reasons.future_decision_useful) ||
    Number(right.score_reasons.non_obvious_insight) -
      Number(left.score_reasons.non_obvious_insight) ||
    Number(right.score_reasons.supports_or_challenges_theme) -
      Number(left.score_reasons.supports_or_challenges_theme) ||
    Number(right.score_reasons.product_user_market_strategy_related) -
      Number(left.score_reasons.product_user_market_strategy_related) ||
    Number(left.dedupe_status === "duplicate") -
      Number(right.dedupe_status === "duplicate") ||
    leftPosition.turn - rightPosition.turn ||
    leftPosition.start - rightPosition.start ||
    compareStrings(left.candidate_id, right.candidate_id)
  );
}

function duplicateComparator(left, right) {
  const leftPosition = sourcePosition(left);
  const rightPosition = sourcePosition(right);
  return (
    right.score - left.score ||
    Number(right.score_reasons.future_decision_useful) -
      Number(left.score_reasons.future_decision_useful) ||
    Number(right.score_reasons.non_obvious_insight) -
      Number(left.score_reasons.non_obvious_insight) ||
    Number(right.score_reasons.supports_or_challenges_theme) -
      Number(left.score_reasons.supports_or_challenges_theme) ||
    leftPosition.turn - rightPosition.turn ||
    leftPosition.start - rightPosition.start ||
    compareStrings(left.candidate_id, right.candidate_id)
  );
}

function rankCandidates(scoredCandidates) {
  const sorted = [...scoredCandidates].sort(rankingComparator);
  const qualityGroups = new Map();
  for (const candidate of sorted) {
    const qualityKey = [
      candidate.score,
      Number(candidate.score_reasons.future_decision_useful),
      Number(candidate.score_reasons.non_obvious_insight),
      Number(candidate.score_reasons.supports_or_challenges_theme),
      Number(candidate.score_reasons.product_user_market_strategy_related),
      candidate.dedupe_status,
    ].join(":");
    const group = qualityGroups.get(qualityKey) ?? [];
    group.push(candidate);
    qualityGroups.set(qualityKey, group);
  }
  const ranked = [];
  for (const group of qualityGroups.values()) {
    const topicQueues = new Map();
    for (const candidate of group) {
      const queue = topicQueues.get(candidate.topic_id) ?? [];
      queue.push(candidate);
      topicQueues.set(candidate.topic_id, queue);
    }
    while ([...topicQueues.values()].some((queue) => queue.length > 0)) {
      const topicOrder = [...topicQueues.entries()]
        .filter(([, queue]) => queue.length > 0)
        .sort((left, right) => rankingComparator(left[1][0], right[1][0]));
      for (const [, queue] of topicOrder) ranked.push(queue.shift());
    }
  }
  return ranked;
}

function referencesOverlap(left, right) {
  return (left.source_refs ?? []).some((leftRef) =>
    (right.source_refs ?? []).some(
      (rightRef) =>
        leftRef.turn_id === rightRef.turn_id &&
        leftRef.start_char < rightRef.end_char &&
        rightRef.start_char < leftRef.end_char,
    ),
  );
}

function areDuplicates(left, right) {
  if (normalizedText(left.quote) === normalizedText(right.quote)) return true;
  const sameSpeaker = left.speaker === right.speaker;
  const sameTopic = left.topic_id === right.topic_id;
  const quoteSimilarity = tokenSimilarity(left.quote, right.quote);
  const meaningSimilarity = tokenSimilarity(left.meaning, right.meaning);
  return (
    sameSpeaker &&
    ((referencesOverlap(left, right) &&
      (sameTopic || quoteSimilarity >= 0.5 || meaningSimilarity >= 0.5)) ||
      quoteSimilarity >= 0.8 ||
      (sameTopic && meaningSimilarity >= 0.8))
  );
}

function parseScoringResponse(response) {
  const value = response?.json ?? response?.output ?? response;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid JSON from evidence scoring AI: ${error.message}`);
    }
  }
  if (!isObject(value)) throw new Error("Invalid evidence scoring AI response");
  return value;
}

function validateScoreReasons(scoreReasons, candidateId) {
  if (!isObject(scoreReasons)) {
    throw new Error(`Candidate ${candidateId} score_reasons must be an object`);
  }
  const keys = Object.keys(scoreReasons).sort();
  const expected = [...SCORE_REASON_KEYS].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      `Candidate ${candidateId} score_reasons must contain exactly the required keys`,
    );
  }
  if (SCORE_REASON_KEYS.some((key) => typeof scoreReasons[key] !== "boolean")) {
    throw new Error(`Candidate ${candidateId} score reasons must be booleans`);
  }
}

export function validateScoringResponse(response, sourceCandidates) {
  if (!isObject(response) || !Array.isArray(response.candidates)) {
    throw new Error("Evidence scoring AI response must include candidates array");
  }
  const expectedIds = sourceCandidates.map((candidate) => candidate.candidate_id);
  const expectedIdSet = new Set(expectedIds);
  const seen = new Set();
  const scoreMap = new Map();
  for (const result of response.candidates) {
    if (!isObject(result)) throw new Error("Scoring candidates must be objects");
    const keys = Object.keys(result).sort();
    const requiredKeys = [
      "candidate_id",
      "score_rationale",
      "score_reasons",
    ];
    const allowedKeys = new Set([...requiredKeys, "proposed_score"]);
    if (
      requiredKeys.some((key) => !keys.includes(key)) ||
      keys.some((key) => !allowedKeys.has(key))
    ) {
      throw new Error("AI scoring result contains unsupported or missing fields");
    }
    if (!nonEmptyString(result.candidate_id)) {
      throw new Error("AI scoring result is missing candidate_id");
    }
    if (!expectedIdSet.has(result.candidate_id)) {
      throw new Error(`AI created unknown candidate ${result.candidate_id}`);
    }
    if (seen.has(result.candidate_id)) {
      throw new Error(`AI returned duplicate candidate ${result.candidate_id}`);
    }
    if (!nonEmptyString(result.score_rationale)) {
      throw new Error(`Candidate ${result.candidate_id} score_rationale is required`);
    }
    validateScoreReasons(result.score_reasons, result.candidate_id);
    if (
      "proposed_score" in result &&
      (!Number.isInteger(result.proposed_score) ||
        result.proposed_score < 0 ||
        result.proposed_score > 5)
    ) {
      throw new Error(`Candidate ${result.candidate_id} proposed_score is invalid`);
    }
    seen.add(result.candidate_id);
    scoreMap.set(result.candidate_id, result);
  }
  const missing = expectedIds.filter((candidateId) => !seen.has(candidateId));
  if (missing.length > 0) {
    throw new Error(`AI dropped candidates: ${missing.join(", ")}`);
  }
  return scoreMap;
}

function markDuplicates(scoredCandidates) {
  const ordered = [...scoredCandidates].sort(duplicateComparator);
  const representatives = [];
  for (const candidate of ordered) {
    const representative = representatives.find((kept) =>
      areDuplicates(candidate, kept),
    );
    if (representative) {
      candidate.dedupe_status = "duplicate";
      candidate.dedupe_of = representative.candidate_id;
    } else {
      candidate.dedupe_status = "kept";
      candidate.dedupe_of = null;
      representatives.push(candidate);
    }
  }
}

function applySelections(scoredCandidates) {
  const eligible = rankCandidates(
    scoredCandidates.filter(
      (candidate) => candidate.score >= 4 && candidate.dedupe_status === "kept",
    ),
  );
  const selectedIds = new Set();
  const topicCounts = new Map();
  for (const candidate of eligible) {
    if (selectedIds.size >= SELECTION_LIMITS.hard_max_cards_per_transcript) break;
    const topicCount = topicCounts.get(candidate.topic_id) ?? 0;
    if (topicCount < SELECTION_LIMITS.max_cards_per_topic) {
      selectedIds.add(candidate.candidate_id);
      topicCounts.set(candidate.topic_id, topicCount + 1);
    }
  }
  for (const candidate of scoredCandidates) {
    candidate.filter_decision = selectedIds.has(candidate.candidate_id)
      ? "create_evidence_card"
      : candidate.score >= 2
        ? "keep_in_topic_analysis"
        : "raw_only";
  }
}

function summaryFor(scoredCandidates) {
  return {
    total_candidates: scoredCandidates.length,
    selected_for_evidence_cards: scoredCandidates.filter(
      (candidate) => candidate.filter_decision === "create_evidence_card",
    ).length,
    kept_in_topic_analysis: scoredCandidates.filter(
      (candidate) => candidate.filter_decision === "keep_in_topic_analysis",
    ).length,
    raw_only: scoredCandidates.filter(
      (candidate) => candidate.filter_decision === "raw_only",
    ).length,
    duplicates_marked: scoredCandidates.filter(
      (candidate) => candidate.dedupe_status === "duplicate",
    ).length,
  };
}

function expectedDeterministicCandidates(scoredCandidates) {
  const expected = scoredCandidates.map((candidate) => ({
    ...structuredClone(candidate),
    filter_decision: null,
    dedupe_status: null,
    dedupe_of: null,
    rank: null,
  }));
  markDuplicates(expected);
  applySelections(expected);
  const ranked = rankCandidates(expected);
  expected.splice(0, expected.length, ...ranked);
  expected.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });
  return expected;
}

export async function scoreAndFilterEvidenceCandidates({
  sourceCandidates,
  aiClient,
  sourceCandidateFile,
  sourceHash,
  agentInstructions = "",
  generatedAt = new Date().toISOString(),
}) {
  validateEvidenceCandidatesOutput(sourceCandidates);
  if (!aiClient || typeof aiClient.generateJson !== "function") {
    throw new Error("Evidence scoring requires aiClient.generateJson");
  }
  const candidates = sourceCandidates.evidence_candidates;
  const response = parseScoringResponse(
    await aiClient.generateJson({
      prompt: buildEvidenceScoringPrompt({
        agentInstructions,
        transcriptId: sourceCandidates.transcript_id,
        candidates,
      }),
      input: {
        transcript_id: sourceCandidates.transcript_id,
        candidates,
      },
      schema: EVIDENCE_SCORING_RESPONSE_SCHEMA,
      schemaName: "evidence_scoring",
      reasoningEffort: "high",
    }),
  );
  const scoreMap = validateScoringResponse(response, candidates);
  const scored = candidates.map((candidate) => {
    const aiScore = scoreMap.get(candidate.candidate_id);
    const score = SCORE_REASON_KEYS.filter(
      (key) => aiScore.score_reasons[key],
    ).length;
    return {
      ...structuredClone(candidate),
      source_turn_ids: candidate.source_refs.map((ref) => ref.turn_id),
      score_reasons: structuredClone(aiScore.score_reasons),
      score,
      score_rationale: aiScore.score_rationale.trim(),
      filter_decision: null,
      dedupe_status: null,
      dedupe_of: null,
      rank: null,
    };
  });
  markDuplicates(scored);
  applySelections(scored);
  const ranked = rankCandidates(scored);
  scored.splice(0, scored.length, ...ranked);
  scored.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });
  const output = {
    schema_version: SCORED_EVIDENCE_SCHEMA_VERSION,
    transcript_id: sourceCandidates.transcript_id,
    source_candidate_file: sourceCandidateFile,
    source_hash: sourceHash,
    generated_at: generatedAt,
    selection_limits: structuredClone(SELECTION_LIMITS),
    scored_evidence_candidates: scored,
    summary: summaryFor(scored),
    warnings: [],
  };
  validateScoredEvidenceOutput(output, sourceCandidates);
  return output;
}

export function validateScoredEvidenceOutput(output, sourceCandidates = null) {
  const errors = [];
  if (output?.schema_version !== SCORED_EVIDENCE_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCORED_EVIDENCE_SCHEMA_VERSION}`);
  }
  for (const field of [
    "transcript_id",
    "source_candidate_file",
    "source_hash",
    "generated_at",
  ]) {
    if (!nonEmptyString(output?.[field])) errors.push(`${field} is required`);
  }
  if (JSON.stringify(output?.selection_limits) !== JSON.stringify(SELECTION_LIMITS)) {
    errors.push("selection_limits do not match project limits");
  }
  if (!Array.isArray(output?.scored_evidence_candidates)) {
    errors.push("scored_evidence_candidates must be an array");
  }
  if (!isObject(output?.summary)) errors.push("summary must be an object");
  if (!Array.isArray(output?.warnings)) errors.push("warnings must be an array");
  const ids = new Set();
  const ranks = new Set();
  const topicSelections = new Map();
  let totalSelections = 0;
  for (const candidate of output?.scored_evidence_candidates ?? []) {
    if (!isObject(candidate) || !nonEmptyString(candidate.candidate_id)) {
      errors.push("every scored candidate requires candidate_id");
      continue;
    }
    if (ids.has(candidate.candidate_id)) errors.push("candidate IDs must be unique");
    ids.add(candidate.candidate_id);
    if (!nonEmptyString(candidate.topic_id)) errors.push("topic_id is required");
    if (!nonEmptyString(candidate.quote)) errors.push("quote is required");
    if (!Array.isArray(candidate.source_turn_ids) || candidate.source_turn_ids.length === 0) {
      errors.push("source_turn_ids are required");
    }
    if (!Array.isArray(candidate.source_refs) || candidate.source_refs.length === 0) {
      errors.push("source_refs are required");
    }
    try {
      validateScoreReasons(candidate.score_reasons, candidate.candidate_id);
    } catch (error) {
      errors.push(error.message);
    }
    const computedScore = SCORE_REASON_KEYS.filter(
      (key) => candidate.score_reasons?.[key] === true,
    ).length;
    if (!Number.isInteger(candidate.score) || candidate.score < 0 || candidate.score > 5) {
      errors.push("score must be an integer from 0 to 5");
    } else if (candidate.score !== computedScore) {
      errors.push(`candidate ${candidate.candidate_id} score does not match reasons`);
    }
    if (!nonEmptyString(candidate.score_rationale)) errors.push("score_rationale is required");
    if (!FILTER_DECISIONS.includes(candidate.filter_decision)) errors.push("invalid filter_decision");
    if (!["kept", "duplicate"].includes(candidate.dedupe_status)) errors.push("invalid dedupe_status");
    if (
      (candidate.dedupe_status === "kept" && candidate.dedupe_of !== null) ||
      (candidate.dedupe_status === "duplicate" && !nonEmptyString(candidate.dedupe_of))
    ) {
      errors.push("dedupe_of does not match dedupe_status");
    }
    if (!Number.isInteger(candidate.rank) || candidate.rank < 1) {
      errors.push("rank must be positive");
    } else if (ranks.has(candidate.rank)) {
      errors.push("ranks must be unique");
    } else {
      ranks.add(candidate.rank);
    }
    if (candidate.filter_decision === "create_evidence_card") {
      totalSelections += 1;
      topicSelections.set(
        candidate.topic_id,
        (topicSelections.get(candidate.topic_id) ?? 0) + 1,
      );
      if (candidate.score < 4) errors.push("score below 4 cannot create evidence card");
      if (candidate.dedupe_status !== "kept") errors.push("duplicate cannot create evidence card");
    }
    if (
      candidate.score >= 4 &&
      candidate.filter_decision === "raw_only"
    ) {
      errors.push("eligible capped or duplicate candidate cannot be raw_only");
    }
    if (candidate.score <= 1 && candidate.filter_decision !== "raw_only") {
      errors.push("score 0-1 candidate must be raw_only");
    }
    if (
      candidate.score >= 2 &&
      candidate.score <= 3 &&
      candidate.filter_decision !== "keep_in_topic_analysis"
    ) {
      errors.push("score 2-3 candidate must stay in topic analysis");
    }
  }
  if (
    ranks.size !== (output?.scored_evidence_candidates ?? []).length ||
    [...ranks].some(
      (rank) => rank > (output?.scored_evidence_candidates ?? []).length,
    )
  ) {
    errors.push("ranks must be sequential");
  }
  if (
    (output?.scored_evidence_candidates ?? []).some(
      (candidate, index) => candidate.rank !== index + 1,
    )
  ) {
    errors.push("candidate array must follow rank order");
  }
  if (totalSelections > SELECTION_LIMITS.hard_max_cards_per_transcript) {
    errors.push("transcript evidence-card selection cap exceeded");
  }
  for (const [topicId, count] of topicSelections) {
    if (count > SELECTION_LIMITS.max_cards_per_topic) {
      errors.push(`topic ${topicId} evidence-card selection cap exceeded`);
    }
  }
  if (sourceCandidates) {
    if (output.transcript_id !== sourceCandidates.transcript_id) {
      errors.push("scored output transcript_id changed");
    }
    const sourceMap = new Map(
      sourceCandidates.evidence_candidates.map((candidate) => [
        candidate.candidate_id,
        candidate,
      ]),
    );
    if (ids.size !== sourceMap.size) errors.push("scored output candidate count changed");
    for (const candidate of output.scored_evidence_candidates ?? []) {
      const source = sourceMap.get(candidate.candidate_id);
      if (!source) {
        errors.push(`scored output invented candidate ${candidate.candidate_id}`);
        continue;
      }
      for (const [field, value] of Object.entries(source)) {
        if (JSON.stringify(candidate[field]) !== JSON.stringify(value)) {
          errors.push(`${field} changed for ${candidate.candidate_id}`);
        }
      }
      if (
        JSON.stringify(candidate.source_turn_ids) !==
        JSON.stringify(source.source_refs.map((ref) => ref.turn_id))
      ) {
        errors.push(`source_turn_ids changed for ${candidate.candidate_id}`);
      }
    }
  }
  const scoredMap = new Map(
    (output?.scored_evidence_candidates ?? []).map((candidate) => [
      candidate.candidate_id,
      candidate,
    ]),
  );
  for (const candidate of output?.scored_evidence_candidates ?? []) {
    if (
      candidate.dedupe_status === "duplicate" &&
      scoredMap.get(candidate.dedupe_of)?.dedupe_status !== "kept"
    ) {
      errors.push(`dedupe_of must reference a kept candidate for ${candidate.candidate_id}`);
    }
  }
  const expectedSummary = summaryFor(output?.scored_evidence_candidates ?? []);
  if (JSON.stringify(output?.summary) !== JSON.stringify(expectedSummary)) {
    errors.push("summary does not match scored candidates");
  }
  const expectedCandidates = expectedDeterministicCandidates(
    output?.scored_evidence_candidates ?? [],
  );
  const actualById = new Map(
    (output?.scored_evidence_candidates ?? []).map((candidate) => [
      candidate.candidate_id,
      candidate,
    ]),
  );
  for (const expected of expectedCandidates) {
    const actual = actualById.get(expected.candidate_id);
    for (const field of [
      "dedupe_status",
      "dedupe_of",
      "filter_decision",
      "rank",
    ]) {
      if (actual?.[field] !== expected[field]) {
        errors.push(`${field} is not deterministic for ${expected.candidate_id}`);
      }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Scored evidence validation failed: ${errors.join("; ")}`);
  }
}

async function writeJsonAtomically(outputPath, output, sourceCandidates) {
  validateScoredEvidenceOutput(output, sourceCandidates);
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

async function unchangedValidOutput(outputPath, sourceHash, sourceCandidates) {
  try {
    const existing = JSON.parse(await readFile(outputPath, "utf8"));
    validateScoredEvidenceOutput(existing, sourceCandidates);
    return existing.source_hash === sourceHash;
  } catch {
    return false;
  }
}

export async function scoreAllEvidenceCandidates({
  aiClient,
  projectPath = process.cwd(),
  vaultPath = path.resolve(projectPath, "vault"),
  force = false,
  transcriptId = null,
}) {
  if (!aiClient || typeof aiClient.generateJson !== "function") {
    throw new Error("Evidence scoring requires aiClient.generateJson");
  }
  const inputDirectory = path.join(vaultPath, "03 Evidence", "Candidates");
  const outputDirectory = path.join(vaultPath, SCORED_EVIDENCE_PATH);
  const agentInstructions = await readFile(
    path.resolve(projectPath, EVIDENCE_SCORING_AGENT_PATH),
    "utf8",
  );
  let entries = [];
  try {
    entries = await readdir(inputDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith(".") &&
        entry.name.endsWith(".evidence_candidates.json"),
    )
    .filter(
      (entry) =>
        !transcriptId ||
        entry.name === `${transcriptId}.evidence_candidates.json`,
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const results = { processed: [], skipped: [], failed: [], warnings: [], selectedCount: 0 };
  if (transcriptId && files.length === 0) {
    results.skipped.push({ transcript_id: transcriptId, reason: "missing_candidate_file" });
    results.warnings.push(`Missing Part 8 evidence candidate file for ${transcriptId}`);
    return results;
  }
  for (const file of files) {
    const fileTranscriptId = file.name.replace(/\.evidence_candidates\.json$/, "");
    try {
      const inputPath = path.join(inputDirectory, file.name);
      const inputText = await readFile(inputPath, "utf8");
      const sourceHash = createHash("sha256").update(inputText).digest("hex");
      const sourceCandidates = JSON.parse(inputText);
      validateEvidenceCandidatesOutput(sourceCandidates);
      if (sourceCandidates.transcript_id !== fileTranscriptId) {
        throw new Error("Candidate transcript_id does not match filename");
      }
      const outputPath = path.join(
        outputDirectory,
        `${fileTranscriptId}.scored_evidence.json`,
      );
      if (!force && (await unchangedValidOutput(outputPath, sourceHash, sourceCandidates))) {
        results.skipped.push({ transcript_id: fileTranscriptId, reason: "unchanged", outputPath });
        continue;
      }
      const output = await scoreAndFilterEvidenceCandidates({
        sourceCandidates,
        aiClient,
        sourceCandidateFile: `vault/03 Evidence/Candidates/${file.name}`,
        sourceHash,
        agentInstructions,
      });
      await writeJsonAtomically(outputPath, output, sourceCandidates);
      results.processed.push({ transcript_id: fileTranscriptId, outputPath });
      results.selectedCount += output.summary.selected_for_evidence_cards;
      results.warnings.push(...output.warnings.map((item) => `${fileTranscriptId}: ${item.message ?? item}`));
    } catch (error) {
      results.failed.push({ transcript_id: fileTranscriptId, error: error.message });
    }
  }
  return results;
}
