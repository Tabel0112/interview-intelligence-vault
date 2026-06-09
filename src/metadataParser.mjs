import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assignTranscriptIds,
  cleanedTranscriptTitle,
  isCanonicalTranscriptId,
  transcriptIdFromFileName,
} from "./transcriptId.mjs";

const MAX_METADATA_LINES = 80;
const METADATA_OUTPUT_PATH = path.join("02 Transcripts", "Metadata");

const LABEL_ALIASES = new Map([
  ["title", "title"],
  ["name", "title"],
  ["status", "status"],
  ["category", "category"],
  ["type", "category"],
  ["date", "date"],
  ["interview date", "date"],
  ["participants", "participants"],
  ["people", "participants"],
  ["attendees", "participants"],
  ["interviewer", "participants"],
  ["interviewee", "participants"],
  ["speaker", "speaker"],
  ["speakers", "speaker"],
  ["created time", "created_time"],
  ["created", "created_time"],
  ["last edited time", "last_edited_time"],
  ["last edited", "last_edited_time"],
  ["updated", "last_edited_time"],
]);

const BUILT_IN_CATEGORIES = new Set([
  "coffee_chat",
  "user_interview",
  "customer_interview",
  "research_interview",
  "sales_call",
  "team_meeting",
  "class_project",
  "uncategorized",
]);

const MONTHS = new Map(
  [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].map((month, index) => [month, index + 1]),
);

function normalizeLabel(label) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function stripWrappingQuotes(value) {
  const trimmed = String(value ?? "").trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function snakeCase(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function cleanedTitleFromFileName(fileName) {
  return cleanedTranscriptTitle(fileName);
}

export function metadataTranscriptIdFromFileName(fileName, sourceHash = "") {
  return transcriptIdFromFileName(fileName, sourceHash);
}

function parseSimpleArray(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return null;
  }

  const inner = trimmed.slice(1, -1).trim();
  if (!inner) {
    return [];
  }
  return inner.split(",").map(stripWrappingQuotes);
}

function addProperty(properties, key, value) {
  const normalizedKey = LABEL_ALIASES.get(normalizeLabel(key));
  if (!normalizedKey) {
    return false;
  }

  const normalizedValue = Array.isArray(value)
    ? value.map(stripWrappingQuotes)
    : stripWrappingQuotes(value);
  const existing = properties.get(normalizedKey);

  if (normalizedKey === "participants" || normalizedKey === "speaker") {
    properties.set(normalizedKey, [
      ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
      ...(Array.isArray(normalizedValue) ? normalizedValue : [normalizedValue]),
    ]);
  } else if (existing === undefined) {
    properties.set(normalizedKey, normalizedValue);
  }

  return true;
}

function parseYamlFrontmatter(lines) {
  const properties = new Map();
  if (lines[0]?.trim() !== "---") {
    return { properties, nextLine: 0 };
  }

  let currentArrayKey = null;
  let endLine = Math.min(lines.length, MAX_METADATA_LINES);

  for (let index = 1; index < endLine; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") {
      endLine = index + 1;
      break;
    }

    const arrayItem = line.match(/^\s*-\s+(.+?)\s*$/);
    if (arrayItem && currentArrayKey) {
      addProperty(properties, currentArrayKey, [arrayItem[1]]);
      continue;
    }

    const keyValue = line.match(/^\s*([^:#][^:]*?):\s*(.*?)\s*$/);
    if (!keyValue) {
      currentArrayKey = null;
      continue;
    }

    const [, key, rawValue] = keyValue;
    if (!rawValue) {
      currentArrayKey = key;
      continue;
    }

    currentArrayKey = null;
    addProperty(properties, key, parseSimpleArray(rawValue) ?? rawValue);
  }

  return { properties, nextLine: endLine };
}

function parseTopPropertyBlock(lines, startLine, properties) {
  const candidates = [];
  let started = false;

  for (
    let index = startLine;
    index < Math.min(lines.length, MAX_METADATA_LINES);
    index += 1
  ) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed || (!started && /^#{1,6}\s+/.test(trimmed))) {
      continue;
    }

    const keyValue = line.match(/^\s*(?:[-*]\s+)?([^:#][^:]*?):\s*(.*?)\s*$/);
    if (!keyValue) {
      if (started) {
        break;
      }
      return;
    }

    const normalizedKey = normalizeLabel(keyValue[1]);
    if (!LABEL_ALIASES.has(normalizedKey)) {
      if (started) {
        break;
      }
      return;
    }

    started = true;
    candidates.push([keyValue[1], parseSimpleArray(keyValue[2]) ?? keyValue[2]]);
  }

  const hasNonSpeakerProperty = candidates.some(
    ([key]) => LABEL_ALIASES.get(normalizeLabel(key)) !== "speaker",
  );
  for (const [key, value] of candidates) {
    if (
      LABEL_ALIASES.get(normalizeLabel(key)) === "speaker" &&
      !hasNonSpeakerProperty
    ) {
      continue;
    }
    addProperty(properties, key, value);
  }
}

function extractProperties(rawText) {
  const lines = rawText.replace(/\r\n?/g, "\n").split("\n");
  const { properties, nextLine } = parseYamlFrontmatter(lines);
  parseTopPropertyBlock(lines, nextLine, properties);
  return properties;
}

function firstValue(value) {
  if (Array.isArray(value)) {
    return value.find((item) => String(item).trim()) ?? "";
  }
  return value ?? "";
}

function normalizeStatus(value, warnings) {
  const original = stripWrappingQuotes(firstValue(value));
  if (!original) {
    warnings.push("Status missing; defaulted to unverified");
    return "unverified";
  }

  const normalized = normalizeLabel(original);
  if (["verified", "verify", "reviewed"].includes(normalized)) {
    return "verified";
  }
  if (["needs review", "review needed", "needs cleanup"].includes(normalized)) {
    return "needs_review";
  }
  if (["archived", "archive"].includes(normalized)) {
    return "archived";
  }
  if (["unverified"].includes(normalized)) {
    return "unverified";
  }
  if (["done", "complete", "processed"].includes(normalized)) {
    warnings.push(
      `Status '${original}' does not imply verification; defaulted to unverified`,
    );
    return "unverified";
  }

  warnings.push(`Unrecognized status '${original}'; defaulted to unverified`);
  return "unverified";
}

function normalizeCategory(value, warnings) {
  const original = stripWrappingQuotes(firstValue(value));
  if (!original) {
    warnings.push("Category missing; defaulted to uncategorized");
    return "uncategorized";
  }

  const normalized = snakeCase(original);
  if (!normalized) {
    warnings.push(
      `New category '${original}' normalized to 'uncategorized'`,
    );
    return "uncategorized";
  }
  if (BUILT_IN_CATEGORIES.has(normalized)) {
    return normalized;
  }

  warnings.push(`New category '${original}' normalized to '${normalized}'`);
  return normalized;
}

function validCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

function formatDate(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeDate(value, warnings) {
  const original = stripWrappingQuotes(firstValue(value));
  if (!original) {
    warnings.push("Date missing");
    return null;
  }

  const numeric = original.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (numeric) {
    const [, year, month, day] = numeric.map(Number);
    if (validCalendarDate(year, month, day)) {
      return formatDate(year, month, day);
    }
    warnings.push(`Malformed date '${original}'; date set to null`);
    return null;
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(original)) {
    warnings.push(`Ambiguous date format '${original}'; date set to null`);
    return null;
  }

  const namedMonth = original.match(
    /^([A-Za-z]+)\s+(\d{1,2})(?:,\s*|\s+)(\d{4})$/,
  );
  if (namedMonth) {
    const month = MONTHS.get(namedMonth[1].toLowerCase());
    const day = Number(namedMonth[2]);
    const year = Number(namedMonth[3]);
    if (month && validCalendarDate(year, month, day)) {
      return formatDate(year, month, day);
    }
  }

  warnings.push(`Malformed date '${original}'; date set to null`);
  return null;
}

function normalizeTimestamp(value, label, warnings) {
  const original = stripWrappingQuotes(firstValue(value));
  if (!original) {
    return null;
  }

  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
      original,
    )
  ) {
    warnings.push(`Malformed ${label} '${original}'; value set to null`);
    return null;
  }

  const timestamp = new Date(original);
  if (Number.isNaN(timestamp.getTime())) {
    warnings.push(`Malformed ${label} '${original}'; value set to null`);
    return null;
  }
  return timestamp.toISOString();
}

function normalizeParticipants(properties, warnings) {
  const rawParticipants = [
    ...(properties.get("participants") ?? []),
    ...(properties.get("speaker") ?? []),
  ];
  const names = [];

  for (const value of rawParticipants) {
    const simpleArray = parseSimpleArray(value);
    const candidates =
      simpleArray ??
      String(value)
        .split(/\s*(?:,|\/|;|&|\band\b)\s*/i)
        .map(stripWrappingQuotes);

    for (const candidate of candidates) {
      const name = String(candidate).trim();
      if (name && !names.includes(name)) {
        names.push(name);
      }
    }
  }

  if (names.length === 0) {
    warnings.push("No participants found");
  }
  return names;
}

export function parseTranscriptMetadata(transcript) {
  if (!transcript?.fileName || !transcript?.fileHash) {
    throw new Error("Readable transcript metadata requires fileName and fileHash");
  }

  const warnings = [...(transcript.transcriptIdWarnings ?? [])];
  const properties = extractProperties(transcript.rawText ?? "");
  const fileTitle = cleanedTitleFromFileName(transcript.fileName);
  const explicitTitle = stripWrappingQuotes(firstValue(properties.get("title")));
  const title = explicitTitle || fileTitle || "Untitled Transcript";
  if (title === "Untitled Transcript") {
    warnings.push("Title missing; defaulted to Untitled Transcript");
  }

  const transcript_id = isCanonicalTranscriptId(transcript.transcript_id)
    ? transcript.transcript_id
    : metadataTranscriptIdFromFileName(transcript.fileName, transcript.fileHash);
  if (!transcript_id) {
    throw new Error(`Unable to produce transcript_id for ${transcript.fileName}`);
  }

  return {
    transcript_id,
    source_file: transcript.fileName,
    source_hash: transcript.fileHash,
    title,
    status: normalizeStatus(properties.get("status"), warnings),
    category: normalizeCategory(properties.get("category"), warnings),
    date: normalizeDate(properties.get("date"), warnings),
    participants: normalizeParticipants(properties, warnings),
    created_time: normalizeTimestamp(
      properties.get("created_time"),
      "created_time",
      warnings,
    ),
    last_edited_time: normalizeTimestamp(
      properties.get("last_edited_time"),
      "last_edited_time",
      warnings,
    ),
    warnings,
  };
}

export function parseAllTranscriptMetadata(transcripts) {
  const sortedTranscripts = [...transcripts].sort((left, right) =>
    left.fileName.localeCompare(right.fileName),
  );
  const assignments = assignTranscriptIds(sortedTranscripts);
  const metadata = sortedTranscripts.map((transcript, index) =>
    parseTranscriptMetadata({
      ...transcript,
      transcript_id: assignments[index].transcript_id,
      transcriptIdWarnings: assignments[index].warnings,
    }),
  );

  return metadata.sort((left, right) =>
    left.transcript_id.localeCompare(right.transcript_id),
  );
}

export async function writeMetadataFiles(
  metadata,
  { vaultPath = path.resolve(process.cwd(), "vault") } = {},
) {
  const outputDirectory = path.resolve(vaultPath, METADATA_OUTPUT_PATH);
  await mkdir(outputDirectory, { recursive: true });

  for (const item of metadata) {
    const outputPath = path.join(
      outputDirectory,
      `${item.transcript_id}.metadata.json`,
    );
    await writeFile(outputPath, `${JSON.stringify(item, null, 2)}\n`, "utf8");
  }

  await writeFile(
    path.join(outputDirectory, "metadata_index.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );

  return {
    outputDirectory,
    metadataFilesWritten: metadata.length,
    indexFile: path.join(outputDirectory, "metadata_index.json"),
  };
}
