import { createHash } from "node:crypto";
import path from "node:path";

const NOTION_HASH_PATTERN = /\s+[a-f0-9]{32}$/i;
const CANONICAL_ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function stableShortHash(fileName, sourceHash, length = 8) {
  return createHash("sha256")
    .update(`${sourceHash ?? ""}:${fileName ?? ""}`)
    .digest("hex")
    .slice(0, length);
}

export function cleanedTranscriptTitle(fileName) {
  return path
    .basename(fileName, path.extname(fileName))
    .replace(NOTION_HASH_PATTERN, "")
    .trim();
}

export function normalizeTranscriptId(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function transcriptIdFromFileName(fileName, sourceHash = "") {
  const normalized = normalizeTranscriptId(cleanedTranscriptTitle(fileName));
  return normalized || `transcript_${stableShortHash(fileName, sourceHash)}`;
}

export function isCanonicalTranscriptId(transcriptId) {
  return CANONICAL_ID_PATTERN.test(String(transcriptId ?? ""));
}

/**
 * Assigns canonical IDs to transcript-like records. Duplicate base IDs receive
 * a deterministic short hash suffix. Returned records preserve input order.
 *
 * @param {Array<{fileName: string, fileHash?: string}>} records
 * @returns {Array<{transcript_id: string, warnings: string[]}>}
 */
export function assignTranscriptIds(records) {
  const assignments = records.map((record, index) => ({
    index,
    fileName: record.fileName,
    fileHash: record.fileHash ?? "",
    baseId: transcriptIdFromFileName(record.fileName, record.fileHash),
  }));
  const groups = new Map();

  for (const assignment of assignments) {
    const group = groups.get(assignment.baseId) ?? [];
    group.push(assignment);
    groups.set(assignment.baseId, group);
  }

  const reservedIds = new Set(assignments.map(({ baseId }) => baseId));
  const usedIds = new Set();
  const results = new Array(records.length);

  for (const baseId of [...groups.keys()].sort()) {
    const group = groups.get(baseId).sort((left, right) => {
      const byName = left.fileName.localeCompare(right.fileName);
      return byName || left.fileHash.localeCompare(right.fileHash);
    });

    group.forEach((assignment, groupIndex) => {
      let transcriptId = baseId;
      const warnings = [];

      if (groupIndex > 0 || usedIds.has(transcriptId)) {
        let suffixLength = 8;
        transcriptId = `${baseId}_${stableShortHash(
          assignment.fileName,
          assignment.fileHash,
          suffixLength,
        )}`;

        while (reservedIds.has(transcriptId) || usedIds.has(transcriptId)) {
          suffixLength += 2;
          transcriptId = `${baseId}_${stableShortHash(
            assignment.fileName,
            assignment.fileHash,
            suffixLength,
          )}`;
        }

        warnings.push(
          `Duplicate transcript_id '${baseId}' resolved to '${transcriptId}'`,
        );
      }

      usedIds.add(transcriptId);
      results[assignment.index] = {
        transcript_id: transcriptId,
        warnings,
      };
    });
  }

  return results;
}
