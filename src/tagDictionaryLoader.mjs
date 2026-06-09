import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const TAG_DICTIONARY_PATH = path.join(
  "05 Candidate Tags",
  "Tag_Dictionary.json",
);
export const CANDIDATE_TAGS_PATH = path.join(
  "05 Candidate Tags",
  "Candidate_Tags.json",
);
export const THEMES_PATH = "04 Themes";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeCandidateTag(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function recordsFromJson(value, collectionKeys) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of collectionKeys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return Object.entries(value).map(([key, item]) =>
    typeof item === "object" && item !== null ? { id: key, ...item } : item,
  );
}

function tagName(record) {
  if (typeof record === "string") return record;
  return record?.tag ?? record?.name ?? record?.id ?? record?.tag_id ?? null;
}

async function optionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`Unable to load taxonomy file ${filePath}: ${error.message}`);
  }
}

function frontmatterValue(markdown, field) {
  const raw = markdown.match(new RegExp(`^${field}:\\s*(.+?)\\s*$`, "m"))?.[1];
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

async function loadThemes(themesDirectory) {
  let entries = [];
  try {
    entries = await readdir(themesDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const themes = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || entry.name.startsWith(".") || !entry.name.endsWith(".md")) {
      continue;
    }
    const markdown = await readFile(path.join(themesDirectory, entry.name), "utf8");
    const themeId = frontmatterValue(markdown, "theme_id");
    const title =
      frontmatterValue(markdown, "title") ??
      markdown.match(/^# Theme:\s*(.+?)\s*$/m)?.[1] ??
      null;
    if (nonEmptyString(themeId) || nonEmptyString(title)) {
      themes.push({
        theme_id: nonEmptyString(themeId) ? themeId.trim() : null,
        title: nonEmptyString(title) ? title.trim() : null,
        file: path.join(THEMES_PATH, entry.name),
      });
    }
  }
  return themes;
}

export async function loadTagTaxonomy({
  vaultPath = path.resolve(process.cwd(), "vault"),
} = {}) {
  const dictionary = await optionalJson(path.join(vaultPath, TAG_DICTIONARY_PATH));
  const candidateIndex = await optionalJson(path.join(vaultPath, CANDIDATE_TAGS_PATH));
  const officialRecords = recordsFromJson(dictionary, ["tags", "official_tags"]);
  const candidateRecords = recordsFromJson(candidateIndex, [
    "tags",
    "candidate_tags",
  ]);
  const officialTags = officialRecords
    .map(tagName)
    .filter(nonEmptyString)
    .map((tag) => tag.trim());
  const candidateTags = candidateRecords
    .map(tagName)
    .filter(nonEmptyString)
    .map((tag) => normalizeCandidateTag(tag))
    .filter(Boolean);
  const themes = await loadThemes(path.join(vaultPath, THEMES_PATH));
  return {
    officialTags: [...new Set(officialTags)].sort(),
    candidateTags: [...new Set(candidateTags)].sort(),
    themes,
    paths: {
      tagDictionary: path.join(vaultPath, TAG_DICTIONARY_PATH),
      candidateTags: path.join(vaultPath, CANDIDATE_TAGS_PATH),
      themes: path.join(vaultPath, THEMES_PATH),
    },
  };
}
