import { extname } from "node:path";
import { ValidationError } from "../db/errors.js";
import type { TranscriptFormat } from "./types.js";

const supported = new Set<TranscriptFormat>(["txt", "md", "srt", "vtt"]);

export function detectTranscriptFormat(filename: string, _rawText: string): TranscriptFormat {
  const extension = extname(filename).slice(1).toLowerCase() as TranscriptFormat;
  if (!supported.has(extension)) {
    throw new ValidationError(`Unsupported transcript extension: ${extension || "(none)"}`);
  }
  return extension;
}
