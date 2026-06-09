import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { EVIDENCE_CARDS_PATH } from "./evidenceCardWriter.mjs";
import {
  FINDING_GENERATOR_RESPONSE_SCHEMA,
  buildFindingGeneratorPrompt,
} from "./findingGeneratorPrompt.mjs";
import { THEMES_PATH } from "./tagDictionaryLoader.mjs";
import { normalizeTranscriptId } from "./transcriptId.mjs";

export const FINDINGS_PATH = "06 Findings";
export const FINDING_GENERATOR = "finding-generator.v1";
export const FINDING_GENERATED_MARKER = "<!-- generated: finding-generator.v1 -->";
export const FINDING_GENERATOR_AGENT_PATH =
  "vault/99 System/Agents/Finding_Generator_Agent.md";
export const FINDING_STATUSES = ["active", "stale", "rejected_candidate"];
export const FINDING_LABELS = [
  "single-source insight",
  "multi-source insight",
  "expert insight",
  "weak signal",
  "medium confidence",
  "strong finding",
  "needs validation",
  "product implication",
  "research question",
];

const GENERIC_LIMITATIONS = new Set([
  "more research is needed",
  "this may be wrong",
  "limited evidence",
]);
const OVERCLAIM_PATTERN =
  /\b(users want|the market needs|consumers will|this proves|everyone prefers|all customers|the product must|the company should definitely)\b/i;
const FORCEFUL_IMPLICATION_PATTERN =
  /\b(build|launch|ship|implement|roll out|must|definitely|immediately|required)\b/i;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const FINDING_FIELDS = [
  "title",
  "claim",
  "evidence_ids",
  "related_theme_ids",
  "product_implication",
  "confidence",
  "finding_labels",
  "limitation",
  "rationale",
];
const GROUNDING_STOP_WORDS = new Set([
  "and",
  "are",
  "based",
  "consider",
  "could",
  "evidence",
  "for",
  "from",
  "may",
  "might",
  "product",
  "should",
  "suggest",
  "suggests",
  "support",
  "supports",
  "testing",
  "that",
  "the",
  "their",
  "this",
  "user",
  "users",
  "with",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function frontmatterBlock(markdown) {
  if (!markdown.startsWith("---\n")) return null;
  const end = markdown.indexOf("\n---\n", 4);
  return end === -1 ? null : markdown.slice(4, end);
}

function frontmatterValue(markdown, field) {
  const block = frontmatterBlock(markdown);
  if (block === null) return null;
  const raw = block.match(new RegExp(`^${field}:\\s*(.*?)\\s*$`, "m"))?.[1];
  if (!raw) return null;
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

function frontmatterList(markdown, field) {
  const block = frontmatterBlock(markdown);
  if (block === null) return [];
  const match = block.match(
    new RegExp(`^${field}:\\s*$\\n((?:\\s{2}- .*\\n?)*)`, "m"),
  );
  if (!match) return [];
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.match(/^\s{2}-\s+(.+?)\s*$/)?.[1])
    .filter(Boolean);
}

function section(markdown, heading) {
  return (
    markdown.match(
      new RegExp(`^## ${heading}\\s*$\\n+([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"),
    )?.[1]?.trim() ?? ""
  );
}

function noteTitle(markdown, fallback) {
  return markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() ?? fallback;
}

function wikilink(filePath) {
  return `[[${path.basename(filePath, path.extname(filePath))}]]`;
}

function normalizedText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokens(value) {
  return new Set(
    normalizedText(value)
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !GROUNDING_STOP_WORDS.has(token)),
  );
}

function similarity(left, right) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token));
  return intersection.length / new Set([...leftTokens, ...rightTokens]).size;
}

function parseAiResponse(response) {
  const value = response?.json ?? response?.output ?? response;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid JSON from finding generator AI: ${error.message}`);
    }
  }
  if (!isObject(value)) throw new Error("Invalid finding generator AI response");
  return value;
}

export function parseEvidenceCardForFinding(markdown, filePath) {
  const evidenceId = frontmatterValue(markdown, "evidence_id");
  const sourceTranscriptId = frontmatterValue(markdown, "source_transcript_id");
  const confidence = frontmatterValue(markdown, "confidence");
  const quote = section(markdown, "Quote").replace(/^>\s?/gm, "").trim();
  const context = section(markdown, "Context");
  const meaning = section(markdown, "Meaning");
  if (
    frontmatterBlock(markdown) === null ||
    frontmatterValue(markdown, "type") !== "evidence" ||
    !nonEmptyString(evidenceId) ||
    !SAFE_ID_PATTERN.test(evidenceId) ||
    !nonEmptyString(sourceTranscriptId) ||
    !SAFE_ID_PATTERN.test(sourceTranscriptId) ||
    !nonEmptyString(quote) ||
    !nonEmptyString(context) ||
    !nonEmptyString(meaning)
  ) {
    throw new Error(`Invalid Evidence Card: ${filePath}`);
  }
  return {
    evidence_id: evidenceId.trim(),
    source_transcript_id: sourceTranscriptId.trim(),
    participant_id: frontmatterValue(markdown, "participant_id"),
    participant_role:
      frontmatterValue(markdown, "participant_role") ??
      frontmatterValue(markdown, "source_type"),
    confidence: confidence ?? "unknown",
    quote,
    context,
    meaning,
    title: noteTitle(markdown, path.basename(filePath, ".md")),
    filePath,
    wikilink: wikilink(filePath),
  };
}

export function parseThemeForFinding(markdown, filePath) {
  const themeId =
    frontmatterValue(markdown, "theme_id") ??
    frontmatterValue(markdown, "canonical_tag");
  const status = frontmatterValue(markdown, "status");
  if (
    frontmatterBlock(markdown) === null ||
    frontmatterValue(markdown, "type") !== "theme" ||
    !nonEmptyString(themeId) ||
    !SAFE_ID_PATTERN.test(themeId) ||
    status !== "official"
  ) {
    throw new Error(`Invalid official Theme note: ${filePath}`);
  }
  return {
    theme_id: themeId.trim(),
    title:
      frontmatterValue(markdown, "title") ??
      noteTitle(markdown, path.basename(filePath, ".md")),
    definition: section(markdown, "Definition"),
    relatedEvidenceLinks: section(markdown, "Related Evidence").match(/\[\[[^\]]+\]\]/g) ?? [],
    filePath,
    wikilink: wikilink(filePath),
  };
}

async function loadMarkdownNotes(directory, parser) {
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const notes = [];
  const warnings = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || entry.name.startsWith(".") || !entry.name.endsWith(".md")) {
      continue;
    }
    const filePath = path.join(directory, entry.name);
    try {
      notes.push(parser(await readFile(filePath, "utf8"), filePath));
    } catch (error) {
      warnings.push(error.message);
    }
  }
  return { notes, warnings };
}

function sourceKeys(evidence) {
  const transcripts = uniqueSorted(
    evidence.map((item) => `transcript:${item.source_transcript_id}`),
  );
  const participants = evidence.map((item) => item.participant_id);
  if (!participants.every(nonEmptyString)) return transcripts;
  const participantKeys = uniqueSorted(
    participants.map((participant) => `participant:${participant}`),
  );
  return participantKeys.length < transcripts.length ? participantKeys : transcripts;
}

function validateLabels(labels, confidence, independentSources) {
  const errors = [];
  if (!Array.isArray(labels) || labels.length === 0) {
    return ["finding_labels are required"];
  }
  if (labels.some((label) => !FINDING_LABELS.includes(label))) {
    errors.push("finding_labels contain unsupported labels");
  }
  if (new Set(labels).size !== labels.length) errors.push("finding_labels must be unique");
  if (
    confidence === "Low" &&
    !labels.some((label) => ["weak signal", "single-source insight"].includes(label))
  ) {
    errors.push("Low confidence requires weak signal or single-source insight");
  }
  if (confidence === "Medium" && !labels.includes("medium confidence")) {
    errors.push("Medium confidence requires medium confidence label");
  }
  if (confidence === "High" && !labels.includes("strong finding")) {
    errors.push("High confidence requires strong finding label");
  }
  if (independentSources === 1 && !labels.includes("single-source insight")) {
    errors.push("single-source findings require single-source insight label");
  }
  if (independentSources > 1 && labels.includes("multi-source insight") === false) {
    errors.push("multi-source findings require multi-source insight label");
  }
  if (independentSources < 2 && !labels.includes("needs validation")) {
    errors.push("single-source findings require needs validation label");
  }
  return errors;
}

function genericLimitation(value) {
  const normalized = normalizedText(value);
  return (
    normalized.length < 35 ||
    GENERIC_LIMITATIONS.has(normalized) ||
    (!/\b(one|single|limited|source|participant|interview|evidence|transcript|user|expert)\b/i.test(
      value,
    ) &&
      !/\b(does not|cannot|should be validated|may not|not prove|not represent)\b/i.test(
        value,
      ))
  );
}

function validateFindingCandidate(candidate, { evidenceById, themeById }) {
  const errors = [];
  if (!isObject(candidate)) {
    return { errors: ["finding candidate must be an object"], evidence: [], themes: [] };
  }
  const keys = Object.keys(candidate);
  if (
    FINDING_FIELDS.some((field) => !keys.includes(field)) ||
    keys.some((field) => !FINDING_FIELDS.includes(field))
  ) {
    errors.push("finding candidate must contain exactly the required fields");
  }
  const requiredStrings = [
    "title",
    "claim",
    "product_implication",
    "confidence",
    "limitation",
    "rationale",
  ];
  for (const field of requiredStrings) {
    if (!nonEmptyString(candidate?.[field])) errors.push(`${field} is required`);
  }
  if (!Array.isArray(candidate?.evidence_ids) || candidate.evidence_ids.length === 0) {
    errors.push("evidence_ids are required");
  }
  if (!Array.isArray(candidate?.related_theme_ids)) {
    errors.push("related_theme_ids must be an array");
  }
  if (!["Low", "Medium", "High"].includes(candidate?.confidence)) {
    errors.push("confidence must be Low, Medium, or High");
  }
  if (nonEmptyString(candidate.title) && /[\r\n]/.test(candidate.title)) {
    errors.push("title must be one line");
  }
  if (String(candidate.title ?? "").length > 160) errors.push("title is too long");
  for (const field of ["claim", "product_implication", "limitation", "rationale"]) {
    if (String(candidate[field] ?? "").length > 1500) errors.push(`${field} is too long`);
  }
  if (errors.length > 0) return { errors, evidence: [], themes: [] };
  const evidenceIds = uniqueSorted(candidate.evidence_ids);
  const themeIds = uniqueSorted(candidate.related_theme_ids);
  if (evidenceIds.length !== candidate.evidence_ids.length) {
    errors.push("evidence_ids must be unique");
  }
  if (themeIds.length !== candidate.related_theme_ids.length) {
    errors.push("related_theme_ids must be unique");
  }
  const evidence = evidenceIds.map((id) => evidenceById.get(id)).filter(Boolean);
  const themes = themeIds.map((id) => themeById.get(id)).filter(Boolean);
  if (evidence.length !== evidenceIds.length) errors.push("finding references unknown Evidence Cards");
  if (themes.length !== themeIds.length) errors.push("finding references unknown Theme notes");
  if (
    themes.some(
      (theme) =>
        !evidence.some((item) => theme.relatedEvidenceLinks.includes(item.wikilink)),
    )
  ) {
    errors.push("related Theme does not link to referenced evidence");
  }
  const independentSources = sourceKeys(evidence).length;
  if (evidence.length === 1 && candidate.confidence !== "Low") {
    errors.push("one Evidence Card can only support Low confidence");
  }
  if (independentSources < 2 && candidate.confidence === "High") {
    errors.push("High confidence requires multiple independent sources");
  }
  const labels = Array.isArray(candidate.finding_labels)
    ? candidate.finding_labels
    : [];
  errors.push(...validateLabels(labels, candidate.confidence, independentSources));
  if (
    labels.includes("expert insight") &&
    !evidence.some((item) =>
      /\b(expert|industry|professional|specialist)\b/i.test(item.participant_role ?? ""),
    )
  ) {
    errors.push("expert insight requires explicit expert or industry metadata");
  }
  if (genericLimitation(candidate.limitation)) errors.push("limitation is too generic");
  if (OVERCLAIM_PATTERN.test(candidate.claim)) errors.push("claim uses overclaiming language");
  if (FORCEFUL_IMPLICATION_PATTERN.test(candidate.product_implication)) {
    errors.push("product_implication is too forceful");
  }
  const evidenceText = evidence
    .map((item) => `${item.quote} ${item.context} ${item.meaning}`)
    .join(" ");
  if (similarity(candidate.claim, evidenceText) < 0.05) {
    errors.push("claim is not grounded in referenced evidence");
  }
  if (
    similarity(candidate.product_implication, `${candidate.claim} ${evidenceText}`) < 0.05
  ) {
    errors.push("product_implication is not grounded in claim or evidence");
  }
  if (
    themes.some(
      (theme) => {
        const themeText = `${theme.title} ${theme.definition}`;
        return (
          similarity(candidate.claim, themeText) >= 0.5 &&
          similarity(candidate.product_implication, themeText) >= 0.25
        );
      },
    )
  ) {
    errors.push("finding only restates a Theme");
  }
  return {
    errors,
    evidence,
    themes,
    normalized: {
      ...candidate,
      title: candidate.title.trim(),
      claim: candidate.claim.trim(),
      evidence_ids: evidenceIds,
      related_theme_ids: themeIds,
      product_implication: candidate.product_implication.trim(),
      finding_labels: uniqueSorted(labels),
      limitation: candidate.limitation.trim(),
      rationale: candidate.rationale.trim(),
    },
  };
}

function duplicateKey(finding) {
  return finding.evidence_ids.join("|");
}

function deduplicateFindings(findings) {
  const kept = [];
  const rejected = [];
  const ordered = [...findings].sort(
    (left, right) =>
      left.title.localeCompare(right.title) ||
      left.claim.localeCompare(right.claim) ||
      left.product_implication.localeCompare(right.product_implication),
  );
  for (const finding of ordered) {
    const duplicate = kept.find(
      (item) =>
        duplicateKey(item) === duplicateKey(finding) &&
        (similarity(item.claim, finding.claim) >= 0.45 ||
          similarity(item.product_implication, finding.product_implication) >= 0.45),
    );
    if (duplicate) rejected.push({ finding, reason: `duplicate of ${duplicate.title}` });
    else kept.push(finding);
  }
  return { kept, rejected };
}

function yamlList(field, values) {
  return values.length > 0
    ? [field + ":", ...values.map((value) => `  - ${value}`)]
    : [`${field}: []`];
}

function findingSlug(title) {
  return normalizeTranscriptId(title).slice(0, 80) || "untitled";
}

function findingId(title) {
  return `finding_${findingSlug(title)}`;
}

function renderFindingMarkdown(finding, { status = "active", staleReason = null } = {}) {
  const lines = [
    "---",
    "type: finding",
    `generated_by: ${FINDING_GENERATOR}`,
    `finding_id: ${finding.finding_id}`,
    `status: ${status}`,
    `confidence: ${finding.confidence.toLowerCase()}`,
    ...yamlList("labels", finding.finding_labels),
    ...yamlList("evidence", finding.evidence_ids),
    ...yamlList("themes", finding.related_theme_ids),
    "---",
    "",
    FINDING_GENERATED_MARKER,
    "",
    `# Finding - ${finding.title}`,
    "",
    "## Claim",
    "",
    finding.claim,
    "",
    "## Evidence",
    "",
    ...finding.evidenceLinks.map((link) => `* ${link}`),
    "",
    "## Related Themes",
    "",
    ...finding.themeLinks.map((link) => `* ${link}`),
    "",
    "## Product Implication",
    "",
    finding.product_implication,
    "",
    "## Confidence",
    "",
    finding.confidence,
    "",
    "## Finding Labels",
    "",
    ...finding.finding_labels.map((label) => `* ${label}`),
    "",
    "## Limitation",
    "",
    finding.limitation,
    "",
  ];
  if (status === "stale") {
    lines.push("## Stale Reason", "", staleReason, "");
  }
  return lines.join("\n");
}

function validateRenderedFinding(markdown, findingIdValue) {
  if (frontmatterBlock(markdown) === null) throw new Error("Finding YAML is malformed");
  if (!markdown.includes(FINDING_GENERATED_MARKER)) {
    throw new Error("Generated Finding marker is missing");
  }
  if (
    !nonEmptyString(findingIdValue) ||
    !SAFE_ID_PATTERN.test(findingIdValue) ||
    frontmatterValue(markdown, "finding_id") !== findingIdValue ||
    frontmatterValue(markdown, "type") !== "finding" ||
    frontmatterValue(markdown, "generated_by") !== FINDING_GENERATOR ||
    !FINDING_STATUSES.includes(frontmatterValue(markdown, "status"))
  ) {
    throw new Error("Rendered finding_id mismatch");
  }
}

async function writeAtomically(outputPath, markdown, outputDirectory) {
  const relative = path.relative(outputDirectory, outputPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Finding output path is outside vault/06 Findings");
  }
  validateRenderedFinding(markdown, frontmatterValue(markdown, "finding_id"));
  await mkdir(outputDirectory, { recursive: true });
  const tempPath = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, markdown, "utf8");
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function parseExistingGenerated(markdown, filePath) {
  if (!markdown.includes(FINDING_GENERATED_MARKER)) return null;
  const findingIdValue = frontmatterValue(markdown, "finding_id");
  const status = frontmatterValue(markdown, "status");
  const confidence = frontmatterValue(markdown, "confidence");
  if (
    frontmatterBlock(markdown) === null ||
    !nonEmptyString(findingIdValue) ||
    !FINDING_STATUSES.includes(status) ||
    !["low", "medium", "high"].includes(confidence)
  ) {
    throw new Error(`Invalid generated Finding note: ${filePath}`);
  }
  return {
    finding_id: findingIdValue,
    status,
    confidence,
    evidence_ids: frontmatterList(markdown, "evidence"),
    related_theme_ids: frontmatterList(markdown, "themes"),
    title: noteTitle(markdown, path.basename(filePath, ".md")).replace(/^Finding -\s*/, ""),
    claim: section(markdown, "Claim"),
    product_implication: section(markdown, "Product Implication"),
    finding_labels: frontmatterList(markdown, "labels"),
    limitation: section(markdown, "Limitation"),
    evidenceLinks: section(markdown, "Evidence").match(/\[\[[^\]]+\]\]/g) ?? [],
    themeLinks: section(markdown, "Related Themes").match(/\[\[[^\]]+\]\]/g) ?? [],
    filePath,
    markdown,
  };
}

async function loadExistingFindings(outputDirectory) {
  let entries = [];
  try {
    entries = await readdir(outputDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const generated = [];
  const manualPaths = new Set();
  const warnings = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || entry.name.startsWith(".") || !entry.name.endsWith(".md")) {
      continue;
    }
    const filePath = path.join(outputDirectory, entry.name);
    const markdown = await readFile(filePath, "utf8");
    if (!markdown.includes(FINDING_GENERATED_MARKER)) {
      manualPaths.add(filePath);
      continue;
    }
    try {
      generated.push(parseExistingGenerated(markdown, filePath));
    } catch (error) {
      warnings.push(error.message);
      manualPaths.add(filePath);
    }
  }
  return { generated, manualPaths, warnings };
}

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

async function chooseOutputPath({
  finding,
  existingMatch,
  outputDirectory,
  manualPaths,
  reservedPaths,
}) {
  if (existingMatch) return existingMatch.filePath;
  const slug = findingSlug(finding.title);
  let outputPath = path.join(outputDirectory, `finding__${slug}.md`);
  if (manualPaths.has(outputPath) || reservedPaths.has(outputPath)) {
    const suffix = shortHash(finding.evidence_ids.join("|") + finding.claim);
    let sequence = 1;
    do {
      outputPath = path.join(
        outputDirectory,
        `finding__${slug}_${suffix}${sequence === 1 ? "" : `_${sequence}`}.md`,
      );
      sequence += 1;
    } while (manualPaths.has(outputPath) || reservedPaths.has(outputPath));
  }
  const relative = path.relative(outputDirectory, outputPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Finding output path is outside vault/06 Findings");
  }
  return outputPath;
}

function currentSupport(existing, evidenceById, themeById) {
  if (existing.evidence_ids.length === 0) return false;
  const expectedEvidenceLinks = uniqueSorted(
    existing.evidence_ids.map((id) => evidenceById.get(id)?.wikilink).filter(Boolean),
  );
  const expectedThemeLinks = uniqueSorted(
    existing.related_theme_ids.map((id) => themeById.get(id)?.wikilink).filter(Boolean),
  );
  if (
    expectedEvidenceLinks.length !== existing.evidence_ids.length ||
    expectedThemeLinks.length !== existing.related_theme_ids.length ||
    JSON.stringify(uniqueSorted(existing.evidenceLinks)) !==
      JSON.stringify(expectedEvidenceLinks) ||
    JSON.stringify(uniqueSorted(existing.themeLinks)) !==
      JSON.stringify(expectedThemeLinks)
  ) {
    return false;
  }
  const validation = validateFindingCandidate(
    {
      title: existing.title,
      claim: existing.claim,
      evidence_ids: existing.evidence_ids,
      related_theme_ids: existing.related_theme_ids,
      product_implication: existing.product_implication,
      confidence: existing.confidence[0].toUpperCase() + existing.confidence.slice(1),
      finding_labels: existing.finding_labels,
      limitation: existing.limitation,
      rationale: "Existing generated finding validation.",
    },
    { evidenceById, themeById },
  );
  return validation.errors.length === 0;
}

export async function generateFindings({
  aiClient,
  projectPath = process.cwd(),
  vaultPath = path.resolve(projectPath, "vault"),
  force = false,
} = {}) {
  if (!aiClient || typeof aiClient.generateJson !== "function") {
    throw new Error("Finding generation requires aiClient.generateJson");
  }
  const evidenceDirectory = path.join(vaultPath, EVIDENCE_CARDS_PATH);
  const themeDirectory = path.join(vaultPath, THEMES_PATH);
  const outputDirectory = path.join(vaultPath, FINDINGS_PATH);
  const evidenceResult = await loadMarkdownNotes(
    evidenceDirectory,
    parseEvidenceCardForFinding,
  );
  const themeResult = await loadMarkdownNotes(themeDirectory, parseThemeForFinding);
  const existingResult = await loadExistingFindings(outputDirectory);
  const summary = {
    created: 0,
    updated: 0,
    unchanged: 0,
    stale: 0,
    rejected: 0,
    warnings: uniqueSorted([
      ...evidenceResult.warnings,
      ...themeResult.warnings,
      ...existingResult.warnings,
    ]),
  };
  const evidenceById = new Map(
    evidenceResult.notes.map((item) => [item.evidence_id, item]),
  );
  const themeById = new Map(themeResult.notes.map((item) => [item.theme_id, item]));
  for (const [label, notes, key, noteMap] of [
    ["Evidence Card", evidenceResult.notes, "evidence_id", evidenceById],
    ["Theme note", themeResult.notes, "theme_id", themeById],
  ]) {
    const counts = new Map();
    for (const note of notes) counts.set(note[key], (counts.get(note[key]) ?? 0) + 1);
    for (const [id, count] of counts) {
      if (count > 1) {
        noteMap.delete(id);
        summary.warnings.push(`Duplicate ${label} ID ignored: ${id}`);
      }
    }
  }
  const compactEvidence = [...evidenceById.values()].map(
    ({
      evidence_id,
      source_transcript_id,
      participant_id,
      participant_role,
      confidence,
      quote,
      context,
      meaning,
    }) => ({
      evidence_id,
      source_transcript_id,
      participant_id,
      participant_role,
      confidence,
      quote,
      context,
      meaning,
    }),
  );
  const compactThemes = [...themeById.values()].map(
    ({ theme_id, title, definition, relatedEvidenceLinks }) => ({
      theme_id,
      title,
      definition,
      related_evidence_links: relatedEvidenceLinks,
    }),
  );
  const accepted = [];
  if (compactEvidence.length > 0) {
    const agentInstructions = await readFile(
      path.resolve(projectPath, FINDING_GENERATOR_AGENT_PATH),
      "utf8",
    );
    const response = parseAiResponse(
      await aiClient.generateJson({
        prompt: buildFindingGeneratorPrompt({
          agentInstructions,
          evidenceCards: compactEvidence,
          themes: compactThemes,
        }),
        input: { evidence_cards: compactEvidence, themes: compactThemes },
        schema: FINDING_GENERATOR_RESPONSE_SCHEMA,
        schemaName: "finding_generator",
        reasoningEffort: "medium",
      }),
    );
    if (
      Object.keys(response).length !== 1 ||
      !Object.keys(response).includes("findings") ||
      !Array.isArray(response.findings)
    ) {
      throw new Error("Finding generator AI response must contain findings array");
    }
    for (const candidate of response.findings) {
      const validation = validateFindingCandidate(candidate, { evidenceById, themeById });
      if (validation.errors.length > 0) {
        summary.rejected += 1;
        summary.warnings.push(
          `${candidate?.title ?? "Untitled finding"}: ${validation.errors.join("; ")}`,
        );
        continue;
      }
      accepted.push({
        ...validation.normalized,
        evidenceLinks: validation.evidence.map((item) => item.wikilink),
        themeLinks: validation.themes.map((item) => item.wikilink),
      });
    }
  }
  const deduplicated = deduplicateFindings(accepted);
  summary.rejected += deduplicated.rejected.length;
  summary.warnings.push(
    ...deduplicated.rejected.map(
      ({ finding, reason }) => `${finding.title}: ${reason}`,
    ),
  );

  const reservedPaths = new Set(existingResult.generated.map((item) => item.filePath));
  const reservedIds = new Set(existingResult.generated.map((item) => item.finding_id));
  const activeExistingIds = new Set();
  const matchedExistingPaths = new Set();
  for (const finding of deduplicated.kept.sort((left, right) =>
    left.title.localeCompare(right.title),
  )) {
    const existingMatch = existingResult.generated.find(
      (item) =>
        !matchedExistingPaths.has(item.filePath) &&
        duplicateKey(item) === duplicateKey(finding) &&
        (similarity(item.claim, finding.claim) >= 0.3 ||
          similarity(item.product_implication, finding.product_implication) >= 0.3),
    );
    if (existingMatch) matchedExistingPaths.add(existingMatch.filePath);
    let resolvedFindingId = existingMatch?.finding_id ?? findingId(finding.title);
    if (!existingMatch && reservedIds.has(resolvedFindingId)) {
      const baseId = `${resolvedFindingId}_${shortHash(
        finding.evidence_ids.join("|") + finding.claim,
      )}`;
      resolvedFindingId = baseId;
      let sequence = 2;
      while (reservedIds.has(resolvedFindingId)) {
        resolvedFindingId = `${baseId}_${sequence}`;
        sequence += 1;
      }
    }
    reservedIds.add(resolvedFindingId);
    const enriched = {
      ...finding,
      finding_id: resolvedFindingId,
    };
    const outputPath = await chooseOutputPath({
      finding: enriched,
      existingMatch,
      outputDirectory,
      manualPaths: existingResult.manualPaths,
      reservedPaths,
    });
    reservedPaths.add(outputPath);
    if (existingMatch) activeExistingIds.add(existingMatch.finding_id);
    const markdown = renderFindingMarkdown(enriched);
    const existingMarkdown = existingMatch?.markdown ?? null;
    if (existingMarkdown !== null && !force && existingMarkdown === markdown) {
      summary.unchanged += 1;
      continue;
    }
    await writeAtomically(outputPath, markdown, outputDirectory);
    if (existingMarkdown === null) summary.created += 1;
    else summary.updated += 1;
  }

  for (const existing of existingResult.generated) {
    if (activeExistingIds.has(existing.finding_id) || existing.status === "stale") {
      continue;
    }
    if (currentSupport(existing, evidenceById, themeById)) continue;
    const staleReason =
      "This finding is no longer supported because one or more referenced Evidence Cards no longer exist or no longer pass validation.";
    const markdown = renderFindingMarkdown(
      {
        ...existing,
        confidence:
          existing.confidence[0].toUpperCase() + existing.confidence.slice(1),
      },
      { status: "stale", staleReason },
    );
    if (!force && existing.markdown === markdown) continue;
    await writeAtomically(existing.filePath, markdown, outputDirectory);
    summary.stale += 1;
  }
  summary.warnings = uniqueSorted(summary.warnings);
  return summary;
}
