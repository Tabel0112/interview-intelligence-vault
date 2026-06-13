import { createHash, randomBytes } from "node:crypto";

export function createId(prefix: string): string {
  return `${prefix}${randomBytes(16).toString("base64url")}`;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
