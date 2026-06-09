import { normalizeCandidateTag } from "./tagDictionaryLoader.mjs";

export const TAG_DECISION_SCHEMA_VERSION = "tag_decision.v1";
export const TAG_DECISION_STATUSES = ["matched", "candidate", "needs_review"];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value) {
  return value === null || nonEmptyString(value);
}

function themeNames(taxonomy) {
  return new Set(
    taxonomy.themes.flatMap((theme) => [theme.theme_id, theme.title]).filter(Boolean),
  );
}

export function validateTagDecisionResponse(
  response,
  { evidenceId, taxonomy, evidence = null },
) {
  const errors = [];
  const required = [
    "evidence_id",
    "status",
    "matched_tag",
    "matched_theme",
    "candidate_tag",
    "suggested_theme",
    "confidence",
    "reason",
  ];
  if (!isObject(response)) {
    throw new Error("Tag decision AI response must be an object");
  }
  const keys = Object.keys(response);
  if (
    required.some((key) => !keys.includes(key)) ||
    keys.some((key) => !required.includes(key))
  ) {
    errors.push("response must contain exactly the required fields");
  }
  if (response.evidence_id !== evidenceId) errors.push("evidence_id does not match");
  if (!TAG_DECISION_STATUSES.includes(response.status)) errors.push("status is invalid");
  if (!nullableString(response.matched_tag)) errors.push("matched_tag must be string or null");
  if (!nullableString(response.matched_theme)) errors.push("matched_theme must be string or null");
  if (!nullableString(response.candidate_tag)) errors.push("candidate_tag must be string or null");
  if (!nullableString(response.suggested_theme)) errors.push("suggested_theme must be string or null");
  if (
    typeof response.confidence !== "number" ||
    !Number.isFinite(response.confidence) ||
    response.confidence < 0 ||
    response.confidence > 1
  ) {
    errors.push("confidence must be between 0 and 1");
  }
  if (!nonEmptyString(response.reason)) errors.push("reason is required");
  if (String(response.reason ?? "").length > 500) errors.push("reason is too long");
  if (evidence) {
    const outputText = [
      response.reason,
      response.suggested_theme,
      response.candidate_tag,
    ]
      .filter(Boolean)
      .join("\n");
    for (const field of ["quote", "context", "meaning"]) {
      const sourceText = String(evidence[field] ?? "").trim();
      if (sourceText.length >= 80 && outputText.includes(sourceText)) {
        errors.push(`output copies long evidence ${field}`);
      }
    }
  }
  const officialTags = new Set(taxonomy.officialTags);
  const officialNormalized = new Set(
    taxonomy.officialTags.map((tag) => normalizeCandidateTag(tag)),
  );
  const candidates = new Set(taxonomy.candidateTags);
  const themes = themeNames(taxonomy);
  let normalizedCandidate = null;

  if (response.status === "matched") {
    if (!officialTags.has(response.matched_tag)) errors.push("matched_tag is not official");
    if (response.candidate_tag !== null) errors.push("matched decision cannot include candidate_tag");
    if (response.suggested_theme !== null) errors.push("matched decision cannot include suggested_theme");
    if (response.confidence < 0.75) errors.push("matched decision confidence must be at least 0.75");
  } else if (response.status === "candidate") {
    if (response.matched_tag !== null || response.matched_theme !== null) {
      errors.push("candidate decision cannot include matched taxonomy");
    }
    normalizedCandidate = normalizeCandidateTag(response.candidate_tag);
    if (!normalizedCandidate || normalizedCandidate.length > 64) {
      errors.push("candidate_tag must be short and non-empty");
    }
    if (response.candidate_tag !== normalizedCandidate) {
      errors.push("candidate_tag must be normalized lowercase kebab-case");
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedCandidate)) {
      errors.push("candidate_tag must be lowercase kebab-case");
    }
    if (officialNormalized.has(normalizedCandidate)) {
      errors.push("candidate_tag duplicates an official tag");
    }
    if (response.confidence < 0.7) errors.push("candidate decision confidence must be at least 0.70");
  } else if (response.status === "needs_review") {
    if (
      response.matched_tag !== null ||
      response.matched_theme !== null ||
      response.candidate_tag !== null ||
      response.suggested_theme !== null
    ) {
      errors.push("needs_review decision must not assign taxonomy");
    }
    if (response.confidence >= 0.7) errors.push("needs_review confidence must be below 0.70");
  }
  if (response.matched_theme !== null && !themes.has(response.matched_theme)) {
    errors.push("matched_theme is not an official theme");
  }
  if (response.suggested_theme !== null && response.suggested_theme.length > 100) {
    errors.push("suggested_theme is too long");
  }
  if (errors.length > 0) {
    throw new Error(`Tag decision validation failed: ${errors.join("; ")}`);
  }
  return {
    ...response,
    candidate_tag:
      response.status === "candidate"
        ? candidates.has(normalizedCandidate)
          ? [...candidates].find((tag) => tag === normalizedCandidate)
          : normalizedCandidate
        : null,
    reason: response.reason.trim(),
    suggested_theme:
      response.suggested_theme === null ? null : response.suggested_theme.trim(),
  };
}

export function validateSavedTagDecision(decision) {
  const errors = [];
  if (decision?.schema_version !== TAG_DECISION_SCHEMA_VERSION) {
    errors.push(`schema_version must be ${TAG_DECISION_SCHEMA_VERSION}`);
  }
  for (const field of [
    "evidence_id",
    "evidence_card_path",
    "evidence_card_sha256",
    "decided_at",
  ]) {
    if (!nonEmptyString(decision?.[field])) errors.push(`${field} is required`);
  }
  if (!/^[a-f0-9]{64}$/.test(decision?.evidence_card_sha256 ?? "")) {
    errors.push("evidence_card_sha256 must be a SHA-256 hex digest");
  }
  if (
    !nonEmptyString(decision?.decided_at) ||
    Number.isNaN(Date.parse(decision.decided_at))
  ) {
    errors.push("decided_at must be an ISO timestamp");
  }
  if (!TAG_DECISION_STATUSES.includes(decision?.status)) errors.push("status is invalid");
  if (!nonEmptyString(decision?.reason)) errors.push("reason is required");
  if (
    typeof decision?.confidence !== "number" ||
    decision.confidence < 0 ||
    decision.confidence > 1
  ) {
    errors.push("confidence must be between 0 and 1");
  }
  if (errors.length > 0) {
    throw new Error(`Saved tag decision validation failed: ${errors.join("; ")}`);
  }
}
