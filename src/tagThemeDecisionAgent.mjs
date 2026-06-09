import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadTagTaxonomy } from "./tagDictionaryLoader.mjs";
import {
  TAG_DECISION_SCHEMA_VERSION,
  validateSavedTagDecision,
  validateTagDecisionResponse,
} from "./tagDecisionValidator.mjs";
import {
  TAG_THEME_DECISION_RESPONSE_SCHEMA,
  buildTagThemeDecisionPrompt,
} from "./tagThemeDecisionPrompt.mjs";

// Compatibility path for every tag decision status, not only candidate tags.
export const TAG_DECISIONS_PATH = path.join("05 Candidate Tags", "Decisions");
export const TAG_THEME_DECISION_AGENT_PATH =
  "vault/99 System/Agents/Tag_Theme_Decision_Agent.md";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
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

function section(markdown, heading) {
  return (
    markdown.match(
      new RegExp(`^## ${heading}\\s*$\\n+([\\s\\S]*?)(?=^## |\\Z)`, "m"),
    )?.[1]?.trim() ?? ""
  );
}

export function parseEvidenceCard(markdown, evidenceCardPath) {
  const evidenceId = frontmatterValue(markdown, "evidence_id");
  if (!nonEmptyString(evidenceId)) {
    throw new Error(`Evidence card is missing evidence_id: ${evidenceCardPath}`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(evidenceId.trim())) {
    throw new Error(`Evidence card has unsafe evidence_id: ${evidenceCardPath}`);
  }
  const evidence = {
    evidence_id: evidenceId.trim(),
    source_transcript_id: frontmatterValue(markdown, "source_transcript_id"),
    source_transcript_title: frontmatterValue(markdown, "source_transcript_title"),
    topic_id: frontmatterValue(markdown, "topic_id"),
    topic_title: frontmatterValue(markdown, "topic_title"),
    confidence: frontmatterValue(markdown, "confidence"),
    score: Number(frontmatterValue(markdown, "score")),
    quote: section(markdown, "Quote").replace(/^>\s?/gm, "").trim(),
    context: section(markdown, "Context"),
    meaning: section(markdown, "Meaning"),
    score_reason: section(markdown, "Score Reason"),
  };
  for (const field of ["quote", "context", "meaning"]) {
    if (!nonEmptyString(evidence[field])) {
      throw new Error(`Evidence card ${evidence.evidence_id} is missing ${field}`);
    }
  }
  return evidence;
}

function parseAiResponse(response) {
  const value = response?.json ?? response?.output ?? response;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new Error(`Invalid JSON from tag/theme decision AI: ${error.message}`);
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid tag/theme decision AI response");
  }
  return value;
}

function evidenceHash(markdown) {
  return createHash("sha256").update(markdown).digest("hex");
}

async function writeJsonAtomically(outputPath, decision) {
  validateSavedTagDecision(decision);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tempPath, `${JSON.stringify(decision, null, 2)}\n`, "utf8");
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function currentDecisionResponse(decision) {
  return {
    evidence_id: decision.evidence_id,
    status: decision.status,
    matched_tag: decision.matched_tag,
    matched_theme: decision.matched_theme,
    candidate_tag: decision.candidate_tag,
    suggested_theme: decision.suggested_theme,
    confidence: decision.confidence,
    reason: decision.reason,
  };
}

async function unchangedValidDecision(
  outputPath,
  { cardHash, evidenceId, evidenceCardPath, evidence, taxonomy },
) {
  try {
    const existing = JSON.parse(await readFile(outputPath, "utf8"));
    validateSavedTagDecision(existing);
    validateTagDecisionResponse(currentDecisionResponse(existing), {
      evidenceId,
      evidence,
      taxonomy,
    });
    return (
      existing.evidence_id === evidenceId &&
      existing.evidence_card_path === evidenceCardPath &&
      existing.evidence_card_sha256 === cardHash
    );
  } catch {
    return false;
  }
}

export async function decideEvidenceTag({
  evidence,
  evidenceCardPath,
  evidenceCardSha256,
  taxonomy,
  aiClient,
  agentInstructions,
  decidedAt = new Date().toISOString(),
}) {
  if (!aiClient || typeof aiClient.generateJson !== "function") {
    throw new Error("Tag/theme decision requires aiClient.generateJson");
  }
  const response = parseAiResponse(
    await aiClient.generateJson({
      prompt: buildTagThemeDecisionPrompt({
        agentInstructions,
        evidence,
        taxonomy,
      }),
      input: { evidence, taxonomy },
      schema: TAG_THEME_DECISION_RESPONSE_SCHEMA,
      schemaName: "tag_theme_decision",
      reasoningEffort: "medium",
    }),
  );
  const validated = validateTagDecisionResponse(response, {
    evidenceId: evidence.evidence_id,
    evidence,
    taxonomy,
  });
  const decision = {
    schema_version: TAG_DECISION_SCHEMA_VERSION,
    evidence_id: evidence.evidence_id,
    evidence_card_path: evidenceCardPath,
    evidence_card_sha256: evidenceCardSha256,
    status: validated.status,
    matched_tag: validated.matched_tag,
    matched_theme: validated.matched_theme,
    candidate_tag: validated.candidate_tag,
    suggested_theme: validated.suggested_theme,
    confidence: validated.confidence,
    reason: validated.reason,
    decided_at: decidedAt,
  };
  validateSavedTagDecision(decision);
  return decision;
}

export async function classifyAllEvidenceTags({
  aiClient,
  projectPath = process.cwd(),
  vaultPath = path.resolve(projectPath, "vault"),
  force = false,
}) {
  if (!aiClient || typeof aiClient.generateJson !== "function") {
    throw new Error("Tag/theme classification requires aiClient.generateJson");
  }
  const evidenceDirectory = path.join(vaultPath, "03 Evidence Cards");
  const tagDecisionDirectory = path.join(vaultPath, TAG_DECISIONS_PATH);
  const taxonomy = await loadTagTaxonomy({ vaultPath });
  const agentInstructions = await readFile(
    path.resolve(projectPath, TAG_THEME_DECISION_AGENT_PATH),
    "utf8",
  );
  let entries = [];
  try {
    entries = await readdir(evidenceDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() && !entry.name.startsWith(".") && entry.name.endsWith(".md"),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const results = { written: [], skipped: [], failed: [], warnings: [] };
  const seenEvidenceIds = new Set();
  for (const file of files) {
    let evidenceId = file.name;
    try {
      const absolutePath = path.join(evidenceDirectory, file.name);
      const markdown = await readFile(absolutePath, "utf8");
      const evidence = parseEvidenceCard(markdown, absolutePath);
      evidenceId = evidence.evidence_id;
      if (seenEvidenceIds.has(evidenceId)) {
        throw new Error(`Duplicate evidence_id in Evidence Cards: ${evidenceId}`);
      }
      seenEvidenceIds.add(evidenceId);
      const cardHash = evidenceHash(markdown);
      const tagDecisionPath = path.join(
        tagDecisionDirectory,
        `${evidenceId}.tag_decision.json`,
      );
      const evidenceCardPath = `vault/03 Evidence Cards/${file.name}`;
      if (
        !force &&
        (await unchangedValidDecision(tagDecisionPath, {
          cardHash,
          evidenceId,
          evidenceCardPath,
          evidence,
          taxonomy,
        }))
      ) {
        results.skipped.push({
          evidence_id: evidenceId,
          reason: "unchanged",
          outputPath: tagDecisionPath,
        });
        continue;
      }
      const decision = await decideEvidenceTag({
        evidence,
        evidenceCardPath,
        evidenceCardSha256: cardHash,
        taxonomy,
        aiClient,
        agentInstructions,
      });
      await writeJsonAtomically(tagDecisionPath, decision);
      results.written.push({ evidence_id: evidenceId, outputPath: tagDecisionPath });
    } catch (error) {
      results.failed.push({ evidence_id: evidenceId, error: error.message });
    }
  }
  return results;
}
