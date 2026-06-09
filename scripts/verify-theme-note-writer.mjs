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
import { TAG_DECISIONS_PATH } from "../src/tagThemeDecisionAgent.mjs";
import {
  APPROVED_TAG_DICTIONARY_PATH,
  THEME_NOTES_PATH,
  loadApprovedTagDictionary,
  validateApprovedTagDictionary,
  writeThemeNotes,
} from "../src/themeNoteWriter.mjs";
import {
  RELATED_EVIDENCE_END,
  RELATED_EVIDENCE_START,
  RELATED_TOPICS_END,
  RELATED_TOPICS_START,
  renderThemeNote,
} from "../src/themeNoteTemplate.mjs";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "theme-note-writer-"));
const projectPath = path.join(tempRoot, "project");
const vaultPath = path.join(projectPath, "vault");
const decisionDirectory = path.join(vaultPath, TAG_DECISIONS_PATH);
const evidenceDirectory = path.join(vaultPath, "03 Evidence Cards");
const topicDirectory = path.join(vaultPath, "02 Topic Analyses");
const themeDirectory = path.join(vaultPath, THEME_NOTES_PATH);
const rawDirectory = path.join(vaultPath, "01 Transcripts", "Raw");
const dictionaryPath = path.join(vaultPath, APPROVED_TAG_DICTIONARY_PATH);

const dictionary = {
  schema: "tag_dictionary.v1",
  themes: [
    {
      canonical_tag: "consumer-privacy-sensitivity",
      theme_title: "Consumer Privacy Sensitivity",
      aliases: ["privacy-awareness", "privacy-concern"],
      definition: "Consumer awareness of privacy and data collection.",
      status: "official",
    },
    {
      canonical_tag: "pricing-friction",
      theme_title: "Pricing Friction",
      aliases: ["price-concern"],
      definition: "Barriers caused by pricing.",
      status: "official",
    },
    {
      canonical_tag: "trust-explanation",
      theme_title: "Trust Explanation",
      aliases: [],
      definition: "Needs for clearer trust explanations.",
      status: "official",
    },
    {
      canonical_tag: "draft-theme",
      theme_title: "Draft Theme",
      aliases: ["draft-alias"],
      definition: "A theme not yet approved.",
      status: "draft",
    },
  ],
};

function decision({
  evidenceId,
  evidencePath,
  topicPath = null,
  status = "matched",
  matchedTag = "consumer-privacy-sensitivity",
}) {
  return {
    schema_version: "tag_decision.v1",
    evidence_id: evidenceId,
    evidence_card_path: evidencePath,
    evidence_card_sha256: "a".repeat(64),
    status,
    matched_tag: status === "matched" ? matchedTag : null,
    matched_theme: null,
    candidate_tag: status === "candidate" ? "candidate-only" : null,
    suggested_theme: null,
    confidence: 0.9,
    reason: "Fixture decision.",
    decided_at: "2026-06-09T00:00:00.000Z",
    ...(topicPath ? { topic_note_path: topicPath } : {}),
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

try {
  await Promise.all(
    [
      decisionDirectory,
      evidenceDirectory,
      topicDirectory,
      themeDirectory,
      rawDirectory,
      path.dirname(dictionaryPath),
    ].map((directory) => mkdir(directory, { recursive: true })),
  );
  await writeJson(dictionaryPath, dictionary);
  const rawPath = path.join(rawDirectory, "Immutable.md");
  await writeFile(rawPath, "# Immutable raw transcript\n", "utf8");

  const evidencePaths = {
    privacyA: "vault/03 Evidence Cards/Evidence - Privacy A.md",
    privacyB: "vault/03 Evidence Cards/Evidence - Privacy B.md",
    pricing: "vault/03 Evidence Cards/Evidence - Pricing.md",
    trust: "vault/03 Evidence Cards/Evidence - Trust.md",
  };
  for (const reference of Object.values(evidencePaths)) {
    await writeFile(path.join(projectPath, reference), "# Evidence\n", "utf8");
  }
  const topicPaths = {
    privacy: "vault/02 Topic Analyses/Topic Analysis - Privacy.md",
    pricing: "vault/02 Topic Analyses/Topic Analysis - Pricing.md",
    trust: "vault/02 Topic Analyses/Topic Analysis - Trust.md",
    missing: "vault/02 Topic Analyses/Topic Analysis - Missing.md",
  };
  for (const reference of [topicPaths.privacy, topicPaths.pricing, topicPaths.trust]) {
    await writeFile(path.join(projectPath, reference), "# Topic Analysis\n", "utf8");
  }

  const trustTheme = dictionary.themes.find(
    (theme) => theme.canonical_tag === "trust-explanation",
  );
  const trustThemePath = path.join(themeDirectory, "trust-explanation.theme.md");
  const trustExisting = renderThemeNote({
    theme: trustTheme,
    evidenceLinks: ["[[Old Evidence]]"],
    topicLinks: ["[[Old Topic]]"],
  }).replace("## Definition", "Manual introduction.\n\n## Definition");
  await writeFile(trustThemePath, trustExisting, "utf8");

  const pricingThemePath = path.join(themeDirectory, "pricing-friction.theme.md");
  const pricingManual =
    "---\ntype: theme\ntheme_id: pricing-friction\n---\n\n# Pricing Friction\n\nManual-only analysis.\n";
  await writeFile(pricingThemePath, pricingManual, "utf8");

  await writeJson(
    path.join(decisionDirectory, "01-privacy-alias.json"),
    decision({
      evidenceId: "privacy_a",
      evidencePath: evidencePaths.privacyA,
      topicPath: topicPaths.privacy,
      matchedTag: "privacy-awareness",
    }),
  );
  await writeJson(
    path.join(decisionDirectory, "02-privacy-duplicate.json"),
    decision({
      evidenceId: "privacy_a_duplicate",
      evidencePath: evidencePaths.privacyA,
      topicPath: topicPaths.privacy,
    }),
  );
  await writeJson(
    path.join(decisionDirectory, "03-privacy-second.json"),
    {
      evidence_card_id: "privacy_b",
      evidence_note_path: evidencePaths.privacyB,
      topic_note_path: topicPaths.missing,
      theme_decision: {
        status: "matched",
        matched_tag: "consumer-privacy-sensitivity",
      },
    },
  );
  await writeJson(
    path.join(decisionDirectory, "04-pricing.json"),
    decision({
      evidenceId: "pricing",
      evidencePath: evidencePaths.pricing,
      topicPath: topicPaths.pricing,
      matchedTag: "price-concern",
    }),
  );
  await writeJson(
    path.join(decisionDirectory, "05-trust.json"),
    decision({
      evidenceId: "trust",
      evidencePath: evidencePaths.trust,
      topicPath: topicPaths.trust,
      matchedTag: "trust-explanation",
    }),
  );
  await writeJson(
    path.join(decisionDirectory, "06-candidate.json"),
    decision({
      evidenceId: "candidate",
      evidencePath: evidencePaths.trust,
      status: "candidate",
    }),
  );
  await writeJson(
    path.join(decisionDirectory, "07-unclassified.json"),
    {
      evidence_card_id: "unclassified",
      evidence_note_path: evidencePaths.trust,
      status: "unclassified",
    },
  );
  await writeJson(
    path.join(decisionDirectory, "08-needs-review.json"),
    decision({
      evidenceId: "review",
      evidencePath: evidencePaths.trust,
      status: "needs_review",
    }),
  );
  await writeJson(
    path.join(decisionDirectory, "09-unknown.json"),
    decision({
      evidenceId: "unknown",
      evidencePath: evidencePaths.trust,
      matchedTag: "unknown-tag",
    }),
  );
  await writeJson(
    path.join(decisionDirectory, "10-draft.json"),
    decision({
      evidenceId: "draft",
      evidencePath: evidencePaths.trust,
      matchedTag: "draft-alias",
    }),
  );
  await writeFile(path.join(decisionDirectory, "11-malformed.json"), "{bad json", "utf8");
  await writeJson(
    path.join(decisionDirectory, "12-missing-evidence.json"),
    decision({
      evidenceId: "missing",
      evidencePath: "vault/03 Evidence Cards/Missing.md",
    }),
  );
  await writeJson(
    path.join(decisionDirectory, "13-missing-status.json"),
    { evidence_id: "bad", evidence_card_path: evidencePaths.trust },
  );

  const dictionaryBefore = await readFile(dictionaryPath, "utf8");
  const rawBefore = await readFile(rawPath, "utf8");
  const decisionBefore = await readFile(
    path.join(decisionDirectory, "01-privacy-alias.json"),
    "utf8",
  );
  const evidenceBefore = await readFile(path.join(projectPath, evidencePaths.privacyA), "utf8");
  const topicBefore = await readFile(path.join(projectPath, topicPaths.privacy), "utf8");

  const first = await writeThemeNotes({ projectPath });
  assert.deepEqual(
    {
      created: first.created,
      updated: first.updated,
      unchanged: first.unchanged,
      skipped_candidate: first.skipped_candidate,
      skipped_unclassified: first.skipped_unclassified,
      skipped_unknown_tag: first.skipped_unknown_tag,
      skipped_malformed: first.skipped_malformed,
    },
    {
      created: 1,
      updated: 2,
      unchanged: 0,
      skipped_candidate: 1,
      skipped_unclassified: 2,
      skipped_unknown_tag: 2,
      skipped_malformed: 3,
    },
  );
  assert(first.warnings.some((item) => item.includes("missing topic note")));
  assert(first.warnings.some((item) => item.includes("unknown matched_tag")));
  assert(first.warnings.some((item) => item.includes("is not official")));
  assert.deepEqual(first.warnings, [...first.warnings].sort());

  const privacyThemePath = path.join(
    themeDirectory,
    "consumer-privacy-sensitivity.theme.md",
  );
  const privacy = await readFile(privacyThemePath, "utf8");
  assert(privacy.includes("canonical_tag: consumer-privacy-sensitivity"));
  assert(privacy.includes("[[Evidence - Privacy A]]"));
  assert(privacy.includes("[[Evidence - Privacy B]]"));
  assert.equal(privacy.match(/\[\[Evidence - Privacy A\]\]/g)?.length, 1);
  assert.equal(privacy.match(/\[\[Topic Analysis - Privacy\]\]/g)?.length, 1);
  assert(!privacy.includes("Topic Analysis - Missing"));
  assert(!privacy.includes("vault/"));
  assert(!privacy.includes(".md]]"));
  assert(
    privacy.indexOf("[[Evidence - Privacy A]]") <
      privacy.indexOf("[[Evidence - Privacy B]]"),
  );
  assert.equal(
    await stat(path.join(themeDirectory, "Consumer Privacy Sensitivity.theme.md")).then(
      () => true,
      () => false,
    ),
    false,
  );

  const trust = await readFile(trustThemePath, "utf8");
  assert(trust.includes("Manual introduction."));
  assert(!trust.includes("[[Old Evidence]]"));
  assert(!trust.includes("[[Old Topic]]"));
  assert(trust.includes("[[Evidence - Trust]]"));
  const pricing = await readFile(pricingThemePath, "utf8");
  assert(pricing.includes("Manual-only analysis."));
  for (const marker of [
    RELATED_EVIDENCE_START,
    RELATED_EVIDENCE_END,
    RELATED_TOPICS_START,
    RELATED_TOPICS_END,
  ]) {
    assert.equal(pricing.split(marker).length, 2);
  }

  const mtimes = new Map();
  for (const filePath of [privacyThemePath, pricingThemePath, trustThemePath]) {
    mtimes.set(filePath, (await stat(filePath)).mtimeMs);
  }
  const second = await writeThemeNotes({ projectPath });
  assert.equal(second.created, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.unchanged, 3);
  for (const filePath of mtimes.keys()) {
    assert.equal((await stat(filePath)).mtimeMs, mtimes.get(filePath));
  }

  const forced = await writeThemeNotes({ projectPath, force: true });
  assert.equal(forced.created, 0);
  assert.equal(forced.updated, 3);
  assert.equal(forced.unchanged, 0);

  assert.equal(await readFile(dictionaryPath, "utf8"), dictionaryBefore);
  assert.equal(await readFile(rawPath, "utf8"), rawBefore);
  assert.equal(
    await readFile(path.join(decisionDirectory, "01-privacy-alias.json"), "utf8"),
    decisionBefore,
  );
  assert.equal(
    await readFile(path.join(projectPath, evidencePaths.privacyA), "utf8"),
    evidenceBefore,
  );
  assert.equal(await readFile(path.join(projectPath, topicPaths.privacy), "utf8"), topicBefore);
  assert((await readdir(themeDirectory)).every((name) => !name.includes(".tmp-")));

  assert.throws(
    () =>
      validateApprovedTagDictionary({
        ...dictionary,
        themes: [dictionary.themes[0], { ...dictionary.themes[0] }],
      }),
    /Duplicate canonical_tag/,
  );
  assert.throws(
    () =>
      validateApprovedTagDictionary({
        ...dictionary,
        themes: [
          dictionary.themes[0],
          { ...dictionary.themes[1], aliases: ["privacy-awareness"] },
        ],
      }),
    /Alias maps to multiple canonical tags/,
  );
  assert.throws(
    () => validateApprovedTagDictionary({ schema: "wrong", themes: [] }),
    /schema/,
  );

  const missingVault = path.join(tempRoot, "missing-vault");
  await assert.rejects(loadApprovedTagDictionary({ vaultPath: missingVault }), /missing/);
  const invalidVault = path.join(tempRoot, "invalid-vault");
  await mkdir(path.join(invalidVault, "99 System"), { recursive: true });
  await writeJson(path.join(invalidVault, APPROVED_TAG_DICTIONARY_PATH), {
    schema: "wrong",
    themes: [],
  });
  await assert.rejects(writeThemeNotes({ vaultPath: invalidVault }), /schema/);

  console.log("Theme note writer verification passed.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
