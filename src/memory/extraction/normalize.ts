import { contentHash } from "../../db/ids.js";
import type { ExtractionMemoryObjectType } from "./types.js";

export function normalizeMemoryText(title: string, body: string): string {
  return `${title} ${body}`.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

export function memoryFingerprint(type: ExtractionMemoryObjectType, normalizedText: string): string {
  return contentHash(`${type}:${normalizedText}`);
}

export function tokenJaccard(a: string, b: string): number {
  const left = new Set(a.split(/\s+/).filter(Boolean)), right = new Set(b.split(/\s+/).filter(Boolean));
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union ? intersection / union : 0;
}
