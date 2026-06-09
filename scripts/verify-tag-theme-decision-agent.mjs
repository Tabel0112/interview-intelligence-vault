import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderEvidenceCardMarkdown } from "../src/evidenceCardTemplate.mjs";
import { loadTagTaxonomy } from "../src/tagDictionaryLoader.mjs";
import {
  TAG_DECISIONS_PATH,
  classifyAllEvidenceTags,
  decideEvidenceTag,
} from "../src/tagThemeDecisionAgent.mjs";
import { validateTagDecisionResponse } from "../src/tagDecisionValidator.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tag-theme-decision-"));
const projectPath = path.join(tempRoot, "project");
const vaultPath = path.join(projectPath, "vault");
const rawDirectory = path.join(vaultPath, "01 Transcripts", "Raw");
const evidenceDirectory = path.join(vaultPath, "03 Evidence Cards");
const themesDirectory = path.join(vaultPath, "04 Themes");
const tagsDirectory = path.join(vaultPath, "05 Candidate Tags");
const tagDecisionDirectory = path.join(vaultPath, TAG_DECISIONS_PATH);
const agentsDirectory = path.join(vaultPath, "99 System", "Agents");
const rawPath = path.join(rawDirectory, "Fixture Interview.md");
const dictionaryPath = path.join(tagsDirectory, "Tag_Dictionary.json");
const candidatesPath = path.join(tagsDirectory, "Candidate_Tags.json");
const themePath = path.join(themesDirectory, "privacy-theme.md");

function card(evidenceId, meaning = "Users need clearer privacy controls.") {
  return renderEvidenceCardMarkdown({
    evidence_id: evidenceId,
    candidate_id: `${evidenceId}_candidate`,
    source_transcript_id: "fixture_interview",
    source_transcript_title: "Fixture Interview",
    speaker: "Aloha",
    topic_id: "topic_001",
    topic_title: "Privacy Controls",
    confidence: "high",
    score: 5,
    input_sha256: "card-input-hash",
    quote: "I need clearer privacy controls.",
    context: "The participant is reviewing product privacy settings.",
    meaning,
    score_reason: "This is specific and useful for future trust decisions.",
  });
}

function matched(evidenceId) {
  return {
    evidence_id: evidenceId,
    status: "matched",
    matched_tag: "privacy-control",
    matched_theme: "Privacy and User Control",
    candidate_tag: null,
    suggested_theme: null,
    confidence: 0.91,
    reason: "The evidence directly concerns user control over privacy.",
  };
}

function candidateDecision(evidenceId, tag = "trust-explanation") {
  return {
    evidence_id: evidenceId,
    status: "candidate",
    matched_tag: null,
    matched_theme: null,
    candidate_tag: tag,
    suggested_theme: "Trust and Explanation",
    confidence: 0.82,
    reason: "No official tag captures this specific trust explanation need.",
  };
}

function needsReview(evidenceId) {
  return {
    evidence_id: evidenceId,
    status: "needs_review",
    matched_tag: null,
    matched_theme: null,
    candidate_tag: null,
    suggested_theme: null,
    confidence: 0.48,
    reason: "The evidence could fit multiple tags.",
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

try {
  await mkdir(rawDirectory, { recursive: true });
  await mkdir(evidenceDirectory, { recursive: true });
  await mkdir(themesDirectory, { recursive: true });
  await mkdir(tagsDirectory, { recursive: true });
  await mkdir(agentsDirectory, { recursive: true });
  await writeFile(rawPath, "# Immutable raw transcript\n", "utf8");
  await writeFile(
    dictionaryPath,
    JSON.stringify({
      tags: [
        { tag: "privacy-control", theme: "Privacy and User Control" },
        { tag: "pricing-friction" },
      ],
    }),
    "utf8",
  );
  await writeFile(
    candidatesPath,
    JSON.stringify({ candidate_tags: ["existing-candidate"] }),
    "utf8",
  );
  await writeFile(
    themePath,
    "---\ntheme_id: THEME-001\ntitle: Privacy and User Control\n---\n# Theme\n",
    "utf8",
  );
  await writeFile(
    path.join(agentsDirectory, "Tag_Theme_Decision_Agent.md"),
    "Mock tag/theme decision instructions.",
    "utf8",
  );
  const taxonomy = await loadTagTaxonomy({ vaultPath });
  assert.deepEqual(taxonomy.officialTags, ["pricing-friction", "privacy-control"]);
  assert.deepEqual(taxonomy.candidateTags, ["existing-candidate"]);
  assert.equal(taxonomy.themes[0].title, "Privacy and User Control");

  const directEvidence = {
    evidence_id: "direct_evidence",
    quote: "Exact quote",
    context: "Context",
    meaning: "Meaning",
  };
  const captured = [];
  const direct = await decideEvidenceTag({
    evidence: directEvidence,
    evidenceCardPath: "vault/03 Evidence Cards/direct.md",
    evidenceCardSha256: "a".repeat(64),
    taxonomy,
    aiClient: mockAi([matched("direct_evidence")], captured),
    agentInstructions: "Mock instructions.",
    decidedAt: "2026-06-09T05:00:00.000Z",
  });
  assert.equal(direct.status, "matched");
  assert.equal(direct.matched_tag, "privacy-control");
  assert.equal(direct.schema_version, "tag_decision.v1");
  assert.equal(captured[0].reasoningEffort, "medium");
  assert(captured[0].prompt.includes("Mock instructions."));

  assert.throws(
    () =>
      validateTagDecisionResponse(
        { ...matched("direct_evidence"), matched_tag: "invented-official" },
        { evidenceId: "direct_evidence", taxonomy },
      ),
    /not official/,
  );
  assert.doesNotThrow(() =>
    validateTagDecisionResponse(candidateDecision("direct_evidence"), {
      evidenceId: "direct_evidence",
      taxonomy,
    }),
  );
  const reused = validateTagDecisionResponse(
    candidateDecision("direct_evidence", "existing-candidate"),
    { evidenceId: "direct_evidence", taxonomy },
  );
  assert.equal(reused.candidate_tag, "existing-candidate");
  assert.throws(
    () =>
      validateTagDecisionResponse(
        candidateDecision("direct_evidence", "privacy-control"),
        { evidenceId: "direct_evidence", taxonomy },
      ),
    /duplicates an official tag/,
  );
  assert.throws(
    () =>
      validateTagDecisionResponse(
        candidateDecision("direct_evidence", "Not Normalized!"),
        { evidenceId: "direct_evidence", taxonomy },
      ),
    /normalized lowercase kebab-case/,
  );
  assert.doesNotThrow(() =>
    validateTagDecisionResponse(needsReview("direct_evidence"), {
      evidenceId: "direct_evidence",
      taxonomy,
    }),
  );
  assert.throws(
    () =>
      validateTagDecisionResponse(
        { ...needsReview("direct_evidence"), confidence: 1.2 },
        { evidenceId: "direct_evidence", taxonomy },
      ),
    /confidence/,
  );
  const missing = matched("direct_evidence");
  delete missing.reason;
  assert.throws(
    () =>
      validateTagDecisionResponse(missing, {
        evidenceId: "direct_evidence",
        taxonomy,
      }),
    /required fields|reason/,
  );
  assert.throws(
    () =>
      validateTagDecisionResponse(
        { ...matched("direct_evidence"), official_tags: ["invented"] },
        { evidenceId: "direct_evidence", taxonomy },
      ),
    /required fields/,
  );
  const longEvidence = {
    ...directEvidence,
    meaning:
      "This is a deliberately long evidence meaning that should never be copied verbatim into a compact tag decision rationale because it duplicates source analysis text.",
  };
  assert.throws(
    () =>
      validateTagDecisionResponse(
        {
          ...candidateDecision("direct_evidence"),
          reason: longEvidence.meaning,
        },
        { evidenceId: "direct_evidence", taxonomy, evidence: longEvidence },
      ),
    /copies long evidence/,
  );
  await assert.rejects(
    decideEvidenceTag({
      evidence: directEvidence,
      evidenceCardPath: "direct.md",
      evidenceCardSha256: "hash",
      taxonomy,
      aiClient: mockAi(["{bad json"]),
      agentInstructions: "Mock",
    }),
    /Invalid JSON/,
  );

  await writeFile(path.join(evidenceDirectory, "a.md"), card("evidence_a"), "utf8");
  await writeFile(path.join(evidenceDirectory, "b.md"), card("evidence_b"), "utf8");
  await writeFile(path.join(evidenceDirectory, "c.md"), card("evidence_c"), "utf8");
  const evidenceBBefore = await readFile(path.join(evidenceDirectory, "b.md"), "utf8");
  const evidenceCBefore = await readFile(path.join(evidenceDirectory, "c.md"), "utf8");
  const dictionaryBefore = await readFile(dictionaryPath, "utf8");
  const candidatesBefore = await readFile(candidatesPath, "utf8");
  const themeBefore = await readFile(themePath, "utf8");
  const rawBefore = await readFile(rawPath, "utf8");

  const first = await classifyAllEvidenceTags({
    aiClient: mockAi([
      matched("evidence_a"),
      candidateDecision("evidence_b", "existing-candidate"),
      needsReview("evidence_c"),
    ]),
    projectPath,
  });
  assert.equal(first.written.length, 3);
  assert.equal(first.failed.length, 0);
  const decisionAPath = path.join(tagDecisionDirectory, "evidence_a.tag_decision.json");
  const decisionBPath = path.join(tagDecisionDirectory, "evidence_b.tag_decision.json");
  const decisionCPath = path.join(tagDecisionDirectory, "evidence_c.tag_decision.json");
  const firstDecision = JSON.parse(await readFile(decisionAPath, "utf8"));
  const candidateTagDecision = JSON.parse(await readFile(decisionBPath, "utf8"));
  const needsReviewDecision = JSON.parse(await readFile(decisionCPath, "utf8"));
  assert.equal(firstDecision.status, "matched");
  assert.equal(firstDecision.matched_tag, "privacy-control");
  assert.equal(candidateTagDecision.status, "candidate");
  assert.equal(candidateTagDecision.candidate_tag, "existing-candidate");
  assert.equal(candidateTagDecision.matched_tag, null);
  assert.equal(needsReviewDecision.status, "needs_review");
  assert.equal(needsReviewDecision.matched_tag, null);
  assert.equal(needsReviewDecision.candidate_tag, null);
  assert.match(firstDecision.evidence_card_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    firstDecision.evidence_card_path,
    "vault/03 Evidence Cards/a.md",
  );

  const beforeSkip = (await stat(decisionAPath)).mtimeMs;
  const skipped = await classifyAllEvidenceTags({
    aiClient: mockAi([new Error("AI should not be called")]),
    projectPath,
  });
  assert.equal(skipped.skipped.length, 3);
  assert.equal((await stat(decisionAPath)).mtimeMs, beforeSkip);

  await rename(
    path.join(evidenceDirectory, "a.md"),
    path.join(evidenceDirectory, "renamed-a.md"),
  );
  const renamed = await classifyAllEvidenceTags({
    aiClient: mockAi([matched("evidence_a")]),
    projectPath,
  });
  assert.equal(renamed.written.length, 1);
  assert.equal(
    JSON.parse(await readFile(decisionAPath, "utf8")).evidence_card_path,
    "vault/03 Evidence Cards/renamed-a.md",
  );
  await rename(
    path.join(evidenceDirectory, "renamed-a.md"),
    path.join(evidenceDirectory, "a.md"),
  );

  await writeFile(
    path.join(evidenceDirectory, "a.md"),
    card("evidence_a", "Changed evidence meaning."),
    "utf8",
  );
  const stale = await classifyAllEvidenceTags({
    aiClient: mockAi([matched("evidence_a")]),
    projectPath,
  });
  assert.equal(stale.written.length, 1);
  assert.equal(stale.skipped.length, 2);
  assert.notEqual(
    JSON.parse(await readFile(decisionAPath, "utf8")).evidence_card_sha256,
    firstDecision.evidence_card_sha256,
  );

  const forced = await classifyAllEvidenceTags({
    aiClient: mockAi([
      matched("evidence_a"),
      candidateDecision("evidence_b", "existing-candidate"),
      needsReview("evidence_c"),
    ]),
    projectPath,
    force: true,
  });
  assert.equal(forced.written.length, 3);

  await writeFile(path.join(evidenceDirectory, "d.md"), card("evidence_d"), "utf8");
  const isolated = await classifyAllEvidenceTags({
    aiClient: mockAi([
      new Error("first card failed"),
      matched("evidence_b"),
      needsReview("evidence_c"),
      candidateDecision("evidence_d"),
    ]),
    projectPath,
    force: true,
  });
  assert.equal(isolated.failed.length, 1);
  assert.equal(isolated.written.length, 3);

  assert.equal(await readFile(dictionaryPath, "utf8"), dictionaryBefore);
  assert.equal(await readFile(candidatesPath, "utf8"), candidatesBefore);
  assert.equal(await readFile(themePath, "utf8"), themeBefore);
  assert.equal(await readFile(rawPath, "utf8"), rawBefore);
  assert.equal(
    await readFile(path.join(evidenceDirectory, "b.md"), "utf8"),
    evidenceBBefore,
  );
  assert.equal(
    await readFile(path.join(evidenceDirectory, "c.md"), "utf8"),
    evidenceCBefore,
  );
  const decisionFiles = await readdir(tagDecisionDirectory);
  assert(decisionFiles.every((name) => !name.includes(".tmp-")));
  console.log("Tag/theme decision agent verification passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
