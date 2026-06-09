import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  TAG_DICTIONARY_PATH,
  THEMES_PATH,
} from "./tagDictionaryLoader.mjs";
import { TAG_DECISIONS_PATH } from "./tagThemeDecisionAgent.mjs";
import {
  RELATED_EVIDENCE_END,
  RELATED_EVIDENCE_START,
  RELATED_TOPICS_END,
  RELATED_TOPICS_START,
  renderGeneratedThemeSections,
  renderThemeNote,
  wikilinkFromNotePath,
} from "./themeNoteTemplate.mjs";

export const APPROVED_TAG_DICTIONARY_PATH = TAG_DICTIONARY_PATH;
export const THEME_NOTES_PATH = THEMES_PATH;
export const THEME_NOTE_WRITER_AGENT_PATH =
  "vault/99 System/Agents/Theme_Note_Writer_Agent.md";

const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateTheme(theme, index) {
  const prefix = `themes[${index}]`;
  if (!isObject(theme)) throw new Error(`${prefix} must be an object`);
  for (const field of [
    "canonical_tag",
    "theme_title",
    "aliases",
    "definition",
    "status",
  ]) {
    if (!(field in theme)) throw new Error(`${prefix}.${field} is required`);
  }
  if (!nonEmptyString(theme.canonical_tag) || !TAG_PATTERN.test(theme.canonical_tag)) {
    throw new Error(`${prefix}.canonical_tag must be lowercase kebab-case`);
  }
  if (!nonEmptyString(theme.theme_title)) {
    throw new Error(`${prefix}.theme_title must be a non-empty string`);
  }
  if (!Array.isArray(theme.aliases)) throw new Error(`${prefix}.aliases must be an array`);
  for (const alias of theme.aliases) {
    if (!nonEmptyString(alias) || !TAG_PATTERN.test(alias)) {
      throw new Error(`${prefix}.aliases must contain lowercase kebab-case strings`);
    }
  }
  if (new Set(theme.aliases).size !== theme.aliases.length) {
    throw new Error(`${prefix}.aliases must be unique`);
  }
  if (!nonEmptyString(theme.definition)) {
    throw new Error(`${prefix}.definition must be a non-empty string`);
  }
  if (!nonEmptyString(theme.status)) {
    throw new Error(`${prefix}.status must be a non-empty string`);
  }
}

export function validateApprovedTagDictionary(dictionary) {
  if (!isObject(dictionary)) throw new Error("Tag Dictionary root must be an object");
  if (dictionary.schema !== "tag_dictionary.v1") {
    throw new Error('Tag Dictionary schema must be "tag_dictionary.v1"');
  }
  if (!Array.isArray(dictionary.themes)) {
    throw new Error("Tag Dictionary themes must be an array");
  }
  const canonicalTags = new Set();
  const aliases = new Map();
  for (const [index, theme] of dictionary.themes.entries()) {
    validateTheme(theme, index);
    if (canonicalTags.has(theme.canonical_tag)) {
      throw new Error(`Duplicate canonical_tag: ${theme.canonical_tag}`);
    }
    canonicalTags.add(theme.canonical_tag);
  }
  for (const theme of dictionary.themes) {
    for (const alias of theme.aliases) {
      if (canonicalTags.has(alias) && alias !== theme.canonical_tag) {
        throw new Error(`Alias conflicts with canonical_tag: ${alias}`);
      }
      const existing = aliases.get(alias);
      if (existing && existing !== theme.canonical_tag) {
        throw new Error(`Alias maps to multiple canonical tags: ${alias}`);
      }
      aliases.set(alias, theme.canonical_tag);
    }
  }
  return dictionary;
}

export async function loadApprovedTagDictionary({
  vaultPath = path.resolve(process.cwd(), "vault"),
} = {}) {
  const dictionaryPath = path.join(vaultPath, APPROVED_TAG_DICTIONARY_PATH);
  let source;
  try {
    source = await readFile(dictionaryPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Approved Tag Dictionary is missing: ${dictionaryPath}`);
    }
    throw error;
  }
  let dictionary;
  try {
    dictionary = JSON.parse(source);
  } catch (error) {
    throw new Error(`Approved Tag Dictionary contains invalid JSON: ${error.message}`);
  }
  validateApprovedTagDictionary(dictionary);
  const themesByCanonicalTag = new Map();
  const canonicalByTag = new Map();
  for (const theme of dictionary.themes) {
    themesByCanonicalTag.set(theme.canonical_tag, theme);
    canonicalByTag.set(theme.canonical_tag, theme.canonical_tag);
    for (const alias of theme.aliases) canonicalByTag.set(alias, theme.canonical_tag);
  }
  return { dictionary, dictionaryPath, themesByCanonicalTag, canonicalByTag };
}

function decisionFields(decision) {
  const themeDecision = isObject(decision?.theme_decision)
    ? decision.theme_decision
    : decision;
  return {
    evidenceId: decision?.evidence_id ?? decision?.evidence_card_id,
    evidenceNotePath: decision?.evidence_card_path ?? decision?.evidence_note_path,
    topicNotePath: decision?.topic_note_path ?? null,
    status: themeDecision?.status,
    matchedTag: themeDecision?.matched_tag,
  };
}

function vaultReferencePath(reference, { projectPath, vaultPath }) {
  if (!nonEmptyString(reference)) return null;
  const normalized = reference.replaceAll("\\", "/");
  const absolute = normalized.startsWith("vault/")
    ? path.resolve(vaultPath, normalized.slice("vault/".length))
    : path.resolve(vaultPath, normalized);
  const relative = path.relative(vaultPath, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return absolute;
}

async function existingFile(reference, paths) {
  const absolutePath = vaultReferencePath(reference, paths);
  if (!absolutePath) return null;
  try {
    return (await stat(absolutePath)).isFile() ? absolutePath : null;
  } catch {
    return null;
  }
}

function sortedLinks(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function replaceMarkedContent(markdown, start, end, links) {
  const startIndex = markdown.indexOf(start);
  const endIndex = markdown.indexOf(end);
  if (startIndex === -1 && endIndex === -1) return null;
  if (
    startIndex === -1 ||
    endIndex === -1 ||
    endIndex < startIndex ||
    markdown.indexOf(start, startIndex + start.length) !== -1 ||
    markdown.indexOf(end, endIndex + end.length) !== -1
  ) {
    throw new Error(`Theme note has invalid generated markers: ${start} / ${end}`);
  }
  const generated = [start, "", ...links.map((link) => `* ${link}`), "", end].join(
    "\n",
  );
  return `${markdown.slice(0, startIndex)}${generated}${markdown.slice(endIndex + end.length)}`;
}

export function updateThemeNoteMarkdown(markdown, { evidenceLinks, topicLinks }) {
  let updated = replaceMarkedContent(
    markdown,
    RELATED_EVIDENCE_START,
    RELATED_EVIDENCE_END,
    evidenceLinks,
  );
  const hadEvidenceMarkers = updated !== null;
  updated ??= markdown;
  const topicsUpdated = replaceMarkedContent(
    updated,
    RELATED_TOPICS_START,
    RELATED_TOPICS_END,
    topicLinks,
  );
  const hadTopicMarkers = topicsUpdated !== null;
  updated = topicsUpdated ?? updated;
  if (!hadEvidenceMarkers || !hadTopicMarkers) {
    const missingSections = renderGeneratedThemeSections({
      evidenceLinks: hadEvidenceMarkers ? [] : evidenceLinks,
      topicLinks: hadTopicMarkers ? [] : topicLinks,
    });
    const sections = [];
    if (!hadEvidenceMarkers) {
      sections.push(
        missingSections.slice(0, missingSections.indexOf("\n\n## Related Topics")),
      );
    }
    if (!hadTopicMarkers) {
      sections.push(missingSections.slice(missingSections.indexOf("## Related Topics")));
    }
    updated = `${updated.trimEnd()}\n\n${sections.join("\n\n")}\n`;
  }
  return updated;
}

function validateGeneratedThemeMarkdown(markdown) {
  if (!markdown.startsWith("---\n") || !markdown.includes("\n---\n")) {
    throw new Error("Generated theme note must contain YAML frontmatter");
  }
  for (const marker of [
    RELATED_EVIDENCE_START,
    RELATED_EVIDENCE_END,
    RELATED_TOPICS_START,
    RELATED_TOPICS_END,
  ]) {
    if (markdown.split(marker).length !== 2) {
      throw new Error(`Generated theme note must contain exactly one ${marker}`);
    }
  }
}

async function writeMarkdownAtomically(outputPath, markdown) {
  validateGeneratedThemeMarkdown(markdown);
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

function warning(summary, message) {
  summary.warnings.push(message);
}

export async function writeThemeNotes({
  projectPath = process.cwd(),
  vaultPath = path.resolve(projectPath, "vault"),
  force = false,
} = {}) {
  const taxonomy = await loadApprovedTagDictionary({ vaultPath });
  const decisionDirectory = path.join(vaultPath, TAG_DECISIONS_PATH);
  const themeDirectory = path.join(vaultPath, THEME_NOTES_PATH);
  const summary = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped_candidate: 0,
    skipped_unclassified: 0,
    skipped_unknown_tag: 0,
    skipped_malformed: 0,
    warnings: [],
  };
  let entries = [];
  try {
    entries = await readdir(decisionDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() && !entry.name.startsWith(".") && entry.name.endsWith(".json"),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const linksByTheme = new Map();
  for (const file of files) {
    const decisionPath = path.join(decisionDirectory, file.name);
    let decision;
    try {
      decision = JSON.parse(await readFile(decisionPath, "utf8"));
    } catch (error) {
      summary.skipped_malformed += 1;
      warning(summary, `${file.name}: malformed decision JSON (${error.message})`);
      continue;
    }
    const fields = decisionFields(decision);
    if (fields.status === "candidate") {
      summary.skipped_candidate += 1;
      continue;
    }
    if (fields.status === "unclassified" || fields.status === "needs_review") {
      summary.skipped_unclassified += 1;
      continue;
    }
    if (fields.status !== "matched" || !nonEmptyString(fields.matchedTag)) {
      summary.skipped_malformed += 1;
      warning(summary, `${file.name}: missing or unknown decision status/matched_tag`);
      continue;
    }
    const canonicalTag = taxonomy.canonicalByTag.get(fields.matchedTag);
    if (!canonicalTag) {
      summary.skipped_unknown_tag += 1;
      warning(summary, `${file.name}: unknown matched_tag ${fields.matchedTag}`);
      continue;
    }
    const theme = taxonomy.themesByCanonicalTag.get(canonicalTag);
    if (theme.status !== "official") {
      summary.skipped_unknown_tag += 1;
      warning(summary, `${file.name}: matched_tag ${fields.matchedTag} is not official`);
      continue;
    }
    if (!nonEmptyString(fields.evidenceId) || !nonEmptyString(fields.evidenceNotePath)) {
      summary.skipped_malformed += 1;
      warning(summary, `${file.name}: evidence ID and evidence note path are required`);
      continue;
    }
    const evidencePath = await existingFile(fields.evidenceNotePath, {
      projectPath,
      vaultPath,
    });
    if (!evidencePath) {
      summary.skipped_malformed += 1;
      warning(summary, `${file.name}: missing evidence note ${fields.evidenceNotePath}`);
      continue;
    }
    const links = linksByTheme.get(canonicalTag) ?? {
      theme,
      evidenceLinks: new Set(),
      topicLinks: new Set(),
    };
    links.evidenceLinks.add(wikilinkFromNotePath(fields.evidenceNotePath));
    if (nonEmptyString(fields.topicNotePath)) {
      const topicPath = await existingFile(fields.topicNotePath, {
        projectPath,
        vaultPath,
      });
      if (topicPath) {
        links.topicLinks.add(wikilinkFromNotePath(fields.topicNotePath));
      } else {
        warning(summary, `${file.name}: missing topic note ${fields.topicNotePath}`);
      }
    }
    linksByTheme.set(canonicalTag, links);
  }
  for (const canonicalTag of [...linksByTheme.keys()].sort()) {
    const { theme, evidenceLinks, topicLinks } = linksByTheme.get(canonicalTag);
    const outputPath = path.join(themeDirectory, `${canonicalTag}.theme.md`);
    const values = {
      evidenceLinks: sortedLinks(evidenceLinks),
      topicLinks: sortedLinks(topicLinks),
    };
    try {
      let existing = null;
      try {
        existing = await readFile(outputPath, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      const markdown =
        existing === null
          ? renderThemeNote({ theme, ...values })
          : updateThemeNoteMarkdown(existing, values);
      validateGeneratedThemeMarkdown(markdown);
      if (existing !== null && !force && existing === markdown) {
        summary.unchanged += 1;
        continue;
      }
      await writeMarkdownAtomically(outputPath, markdown);
      if (existing === null) summary.created += 1;
      else summary.updated += 1;
    } catch (error) {
      summary.skipped_malformed += 1;
      warning(summary, `${path.basename(outputPath)}: ${error.message}`);
    }
  }
  summary.warnings.sort((left, right) => left.localeCompare(right));
  return summary;
}
