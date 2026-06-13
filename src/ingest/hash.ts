import { contentHash } from "../db/ids.js";

export function computeRawSha256(rawText: string): string {
  return contentHash(rawText);
}
