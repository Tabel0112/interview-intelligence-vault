import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EVIDENCE_CARD_GENERATED_MARKER,
  evidenceTitleSlug,
  renderEvidenceCardMarkdown,
} from "./evidenceCardTemplate.mjs";
import {
  SCORED_EVIDENCE_SCHEMA_VERSION,
} from "./evidenceScoringFiltering.mjs";
import { isCanonicalTranscriptId } from "./transcriptId.mjs";
import { validateTopicSegmentationOutput } from "./topicSegmentationAgent.mjs";

export const EVIDENCE_CARDS_PATH = "03 Evidence Cards";
export const EVIDENCE_CARD_AGENT_PATH =
  "vault/99 System/Agents/Evidence_Card_Writer_Agent.md";
export const CREATE_CARD_THRESHOLD = 4;

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

function sourcePosition(candidate) {
  const ref = candidate.source_refs?.[0];
  const turnMatch = ref?.turn_id?.match(/\d+$/);
  return {
    turn: turnMatch ? Number(turnMatch[0]) : Number.MAX_SAFE_INTEGER,
    start: Number.isInteger(ref?.start_char) ? ref.start_char : Number.MAX_SAFE_INTEGER,
  };
}

function evidenceComparator(left, right) {
  const leftPosition = sourcePosition(left);
  const rightPosition = sourcePosition(right);
  return (
    compareStrings(left.source_transcript_id, right.source_transcript_id) ||
    compareStrings(left.topic_id, right.topic_id) ||
    leftPosition.turn - rightPosition.turn ||
    leftPosition.start - rightPosition.start ||
    compareStrings(left.speaker, right.speaker) ||
    compareStrings(left.quote, right.quote) ||
    compareStrings(left.candidate_id, right.candidate_id)
  );
}

function duplicateKey(candidate) {
  return JSON.stringify([
    candidate.source_transcript_id,
    candidate.topic_id,
    candidate.speaker,
    candidate.quote,
  ]);
}

function lowValueQuote(quote) {
  const normalized = quote.toLowerCase().replace(/\s+/g, " ").trim();
  return /^(hi|hello|hey|thanks|thank you|bye|goodbye|good morning|good afternoon|good evening|nice to meet you|how are you)[.!? ]*$/i.test(
    normalized,
  ) ||
    /^(yes|no|yeah|yep|nope|okay|ok|sure|maybe|i don'?t know|sounds good|that makes sense)[.!? ]*$/i.test(
      normalized,
    ) ||
    /^(let'?s schedule|can we schedule|what time works|see you (then|later)|talk to you later)[.!? ]*$/i.test(
      normalized,
    );
}

function rejection(code, candidate, message) {
  return {
    code,
    transcript_id: candidate?.source_transcript_id ?? null,
    candidate_id: candidate?.candidate_id ?? null,
    message,
  };
}

function validateScoredEnvelope(scoredEvidence) {
  if (!isObject(scoredEvidence)) throw new Error("Scored evidence must be an object");
  if (scoredEvidence.schema_version !== SCORED_EVIDENCE_SCHEMA_VERSION) {
    throw new Error(`Scored evidence schema must be ${SCORED_EVIDENCE_SCHEMA_VERSION}`);
  }
  if (!isCanonicalTranscriptId(scoredEvidence.transcript_id)) {
    throw new Error("Scored evidence transcript_id must be canonical");
  }
  if (!Array.isArray(scoredEvidence.scored_evidence_candidates)) {
    throw new Error("Scored evidence candidates must be an array");
  }
}

function verifyCandidate(candidate, processedTranscript, topicMap) {
  const errors = [];
  for (const field of [
    "candidate_id",
    "topic_id",
    "quote",
    "speaker",
    "context",
    "meaning",
    "score_rationale",
    "strength",
  ]) {
    if (!nonEmptyString(candidate?.[field])) errors.push(`${field} is required`);
  }
  if (candidate?.filter_decision !== "create_evidence_card") {
    errors.push("filter_decision is not create_evidence_card");
  }
  if (!Number.isInteger(candidate?.score) || candidate.score < CREATE_CARD_THRESHOLD) {
    errors.push(`score must be at least ${CREATE_CARD_THRESHOLD}`);
  }
  if (!["high", "medium", "low", "strong", "weak"].includes(candidate?.strength)) {
    errors.push("confidence source strength is invalid");
  }
  const topic = topicMap.get(candidate?.topic_id);
  if (!topic || !nonEmptyString(topic.title)) errors.push("topic_id is missing or invalid");
  if (!Array.isArray(candidate?.source_refs) || candidate.source_refs.length === 0) {
    errors.push("source_refs are required");
  } else {
    for (const ref of candidate.source_refs) {
      const turn = processedTranscript.turns.find((item) => item.turn_id === ref.turn_id);
      if (!turn) {
        errors.push(`source turn ${ref.turn_id} is missing`);
        continue;
      }
      if (
        !Number.isInteger(ref.start_char) ||
        !Number.isInteger(ref.end_char) ||
        ref.start_char < 0 ||
        ref.end_char <= ref.start_char ||
        ref.end_char > turn.text.length ||
        turn.text.slice(ref.start_char, ref.end_char) !== candidate.quote
      ) {
        errors.push("quote verification failed");
      }
      if (turn.speaker !== candidate.speaker) errors.push("speaker does not match source turn");
    }
  }
  if (lowValueQuote(candidate?.quote ?? "")) errors.push("quote is greeting, scheduling, or filler");
  return { errors, topic };
}

function confidenceFromStrength(strength) {
  if (strength === "strong") return "high";
  if (strength === "weak") return "low";
  return strength;
}

function inputHash(scoredSourceHash, candidate, processedTranscript, topic) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        scored_source_hash: scoredSourceHash,
        candidate,
        processed_source_hash: processedTranscript.source?.source_hash,
        processed_at: processedTranscript.processed_at,
        topic,
      }),
    )
    .digest("hex");
}

function existingFrontmatterValue(markdown, field) {
  return markdown.match(new RegExp(`^${field}:\\s*(\\S+)\\s*$`, "m"))?.[1] ?? null;
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

async function existingEvidenceFiles(outputDirectory) {
  let entries = [];
  try {
    entries = await readdir(outputDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith(".") || !entry.name.endsWith(".md")) {
      continue;
    }
    const outputPath = path.join(outputDirectory, entry.name);
    const markdown = await readFile(outputPath, "utf8");
    files.push({
      outputPath,
      markdown,
      evidenceId: existingFrontmatterValue(markdown, "evidence_id"),
      generated: markdown.includes(EVIDENCE_CARD_GENERATED_MARKER),
    });
  }
  return files;
}

export function prepareEvidenceCards({
  scoredEvidence,
  processedTranscript,
  topicSegmentation,
}) {
  validateScoredEnvelope(scoredEvidence);
  if (scoredEvidence.transcript_id !== processedTranscript.transcript_id) {
    throw new Error("Scored evidence and processed transcript IDs do not match");
  }
  if (scoredEvidence.transcript_id !== topicSegmentation.transcript_id) {
    throw new Error("Scored evidence and topic segmentation IDs do not match");
  }
  if (!Array.isArray(processedTranscript.turns)) {
    throw new Error("Processed transcript turns must be an array");
  }
  const topicErrors = validateTopicSegmentationOutput(topicSegmentation);
  if (topicErrors.length > 0) {
    throw new Error(`Invalid topic segmentation: ${topicErrors.join("; ")}`);
  }
  const sourceTitle =
    processedTranscript.metadata?.title ||
    path.basename(
      processedTranscript.metadata?.source_file ??
        processedTranscript.source?.raw_filename ??
        "",
      path.extname(
        processedTranscript.metadata?.source_file ??
          processedTranscript.source?.raw_filename ??
          "",
      ),
    );
  if (!nonEmptyString(sourceTitle)) {
    throw new Error("source transcript title is required");
  }
  const topicMap = new Map(
    topicSegmentation.topics.map((topic) => [topic.topic_id, topic]),
  );
  const accepted = [];
  const rejected = [];
  const ignored = [];
  for (const candidate of scoredEvidence.scored_evidence_candidates) {
    const enriched = {
      ...candidate,
      source_transcript_id: scoredEvidence.transcript_id,
    };
    if (
      candidate.filter_decision !== "create_evidence_card" ||
      candidate.score < CREATE_CARD_THRESHOLD
    ) {
      ignored.push(enriched);
      continue;
    }
    const { errors, topic } = verifyCandidate(enriched, processedTranscript, topicMap);
    if (errors.length > 0) {
      rejected.push(
        rejection(
          errors.includes("quote verification failed")
            ? "quote_verification_failed"
            : "invalid_card_candidate",
          enriched,
          errors.join("; "),
        ),
      );
      continue;
    }
    accepted.push({
      ...enriched,
      source_transcript_title: sourceTitle,
      topic_title: topic.title,
      confidence: confidenceFromStrength(candidate.strength),
      score_reason: candidate.score_rationale,
    });
  }
  accepted.sort(evidenceComparator);
  const seen = new Set();
  const deduplicated = [];
  const unique = [];
  for (const candidate of accepted) {
    const key = duplicateKey(candidate);
    if (seen.has(key)) {
      deduplicated.push(candidate);
    } else {
      seen.add(key);
      unique.push(candidate);
    }
  }
  const topicCounts = new Map();
  const cards = unique.map((candidate) => {
    const sequence = (topicCounts.get(candidate.topic_id) ?? 0) + 1;
    topicCounts.set(candidate.topic_id, sequence);
    const evidenceId = `${candidate.source_transcript_id}__${candidate.topic_id}__evidence_${String(sequence).padStart(3, "0")}`;
    const topic = topicMap.get(candidate.topic_id);
    return {
      ...candidate,
      evidence_id: evidenceId,
      input_sha256: inputHash(
        scoredEvidence.source_hash,
        candidate,
        processedTranscript,
        topic,
      ),
    };
  });
  return { cards, rejected, ignored, deduplicated };
}

export async function writeEvidenceCardsForTranscript({
  scoredEvidence,
  processedTranscript,
  topicSegmentation,
  vaultPath = path.resolve(process.cwd(), "vault"),
  force = false,
}) {
  const prepared = prepareEvidenceCards({
    scoredEvidence,
    processedTranscript,
    topicSegmentation,
  });
  const outputDirectory = path.join(vaultPath, EVIDENCE_CARDS_PATH);
  const existing = await existingEvidenceFiles(outputDirectory);
  const byEvidenceId = new Map();
  for (const item of existing.filter((entry) => entry.evidenceId)) {
    const current = byEvidenceId.get(item.evidenceId);
    if (!current || (!item.generated && current.generated)) {
      byEvidenceId.set(item.evidenceId, item);
    }
  }
  const results = {
    written: [],
    skippedUnchanged: [],
    skippedManual: [],
    rejected: prepared.rejected,
    ignored: prepared.ignored,
    deduplicated: prepared.deduplicated,
    warnings: [],
  };
  for (const card of prepared.cards) {
    const filename = `${card.evidence_id}__${evidenceTitleSlug(card)}.md`;
    const desiredPath = path.join(outputDirectory, filename);
    const sameId = byEvidenceId.get(card.evidence_id);
    const desiredExisting = existing.find((item) => item.outputPath === desiredPath);
    const target = sameId?.outputPath ?? desiredPath;
    const targetExisting = sameId ?? desiredExisting;
    if (
      desiredExisting &&
      desiredExisting.outputPath !== sameId?.outputPath &&
      (!desiredExisting.generated || desiredExisting.evidenceId !== card.evidence_id)
    ) {
      results.skippedManual.push({
        evidence_id: card.evidence_id,
        outputPath: desiredPath,
      });
      results.warnings.push(
        `Protected conflicting evidence note: ${path.basename(desiredPath)}`,
      );
      continue;
    }
    if (targetExisting && !targetExisting.generated) {
      results.skippedManual.push({ evidence_id: card.evidence_id, outputPath: target });
      results.warnings.push(`Protected manual evidence note: ${path.basename(target)}`);
      continue;
    }
    const markdown = renderEvidenceCardMarkdown(card);
    if (
      targetExisting &&
      !force &&
      existingFrontmatterValue(targetExisting.markdown, "input_sha256") ===
        card.input_sha256 &&
      targetExisting.markdown === markdown
    ) {
      results.skippedUnchanged.push({ evidence_id: card.evidence_id, outputPath: target });
      continue;
    }
    await writeMarkdownAtomically(desiredPath, markdown);
    if (sameId?.generated && sameId.outputPath !== desiredPath) {
      await rm(sameId.outputPath, { force: true });
    }
    results.written.push({ evidence_id: card.evidence_id, outputPath: desiredPath });
    byEvidenceId.set(card.evidence_id, {
      outputPath: desiredPath,
      markdown,
      evidenceId: card.evidence_id,
      generated: true,
    });
  }
  return results;
}

export async function writeAllEvidenceCards({
  projectPath = process.cwd(),
  vaultPath = path.resolve(projectPath, "vault"),
  force = false,
}) {
  const scoredDirectory = path.join(
    vaultPath,
    "03 Analysis",
    "Evidence_Candidates",
  );
  let entries = [];
  try {
    entries = await readdir(scoredDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith(".") &&
        entry.name.endsWith(".scored_evidence.json"),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const results = {
    written: [],
    skippedUnchanged: [],
    skippedManual: [],
    rejected: [],
    ignored: [],
    deduplicated: [],
    failed: [],
    warnings: [],
  };
  for (const file of files) {
    const fileTranscriptId = file.name.replace(/\.scored_evidence\.json$/, "");
    try {
      const scoredEvidence = JSON.parse(
        await readFile(path.join(scoredDirectory, file.name), "utf8"),
      );
      if (
        scoredEvidence.transcript_id !== fileTranscriptId ||
        !isCanonicalTranscriptId(scoredEvidence.transcript_id)
      ) {
        throw new Error("Scored evidence transcript_id does not match filename");
      }
      const processedTranscript = JSON.parse(
        await readFile(
          path.join(
            vaultPath,
            "01 Transcripts",
            "Processed",
            `${fileTranscriptId}.processed.json`,
          ),
          "utf8",
        ),
      );
      const topicSegmentation = JSON.parse(
        await readFile(
          path.join(
            vaultPath,
            "02 Topic Analyses",
            `${fileTranscriptId}.topics.json`,
          ),
          "utf8",
        ),
      );
      const transcriptResults = await writeEvidenceCardsForTranscript({
        scoredEvidence,
        processedTranscript,
        topicSegmentation,
        vaultPath,
        force,
      });
      for (const key of [
        "written",
        "skippedUnchanged",
        "skippedManual",
        "rejected",
        "ignored",
        "deduplicated",
        "warnings",
      ]) {
        results[key].push(...transcriptResults[key]);
      }
    } catch (error) {
      results.failed.push({ transcript_id: fileTranscriptId, error: error.message });
    }
  }
  return results;
}
