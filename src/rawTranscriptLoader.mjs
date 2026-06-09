import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { assignTranscriptIds, transcriptIdFromFileName } from "./transcriptId.mjs";

const RAW_TRANSCRIPTS_PATH = path.join("01 Transcripts", "Raw");

export { transcriptIdFromFileName };

/**
 * Loads valid Markdown transcripts from the vault's immediate Raw directory.
 * This function only reads files and never modifies the Raw directory.
 *
 * @param {{
 *   vaultPath?: string,
 *   onWarning?: (message: string, error?: unknown) => void
 * }} options
 * @returns {Promise<Array<{
 *   transcript_id: string,
 *   filePath: string,
 *   fileName: string,
 *   rawText: string,
 *   fileHash: string,
 *   lastModified: string,
 *   transcriptIdWarnings: string[]
 * }>>}
 */
export async function loadRawTranscripts({
  vaultPath = path.resolve(process.cwd(), "vault"),
  onWarning = (message) => console.warn(message),
} = {}) {
  const rawDirectory = path.resolve(vaultPath, RAW_TRANSCRIPTS_PATH);

  let entries;
  try {
    entries = await readdir(rawDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Raw transcript folder not found: ${rawDirectory}`, {
        cause: error,
      });
    }

    throw new Error(`Unable to scan raw transcript folder: ${rawDirectory}`, {
      cause: error,
    });
  }

  const transcripts = [];
  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        !entry.name.startsWith(".") &&
        path.extname(entry.name).toLowerCase() === ".md",
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of files) {
    const absoluteFilePath = path.join(rawDirectory, entry.name);

    try {
      const [contents, fileStats] = await Promise.all([
        readFile(absoluteFilePath),
        stat(absoluteFilePath),
      ]);
      const rawText = contents.toString("utf8");

      if (rawText.trim().length === 0) {
        onWarning(`Skipping empty raw transcript: ${entry.name}`);
        continue;
      }

      transcripts.push({
        filePath: path.posix.join("01 Transcripts", "Raw", entry.name),
        fileName: entry.name,
        rawText,
        fileHash: createHash("sha256").update(contents).digest("hex"),
        lastModified: fileStats.mtime.toISOString(),
      });
    } catch (error) {
      onWarning(`Skipping unreadable raw transcript: ${entry.name}`, error);
    }
  }

  const idAssignments = assignTranscriptIds(transcripts);
  return transcripts.map((transcript, index) => {
    for (const warning of idAssignments[index].warnings) {
      onWarning(warning);
    }

    return {
      transcript_id: idAssignments[index].transcript_id,
      ...transcript,
      transcriptIdWarnings: idAssignments[index].warnings,
    };
  });
}
