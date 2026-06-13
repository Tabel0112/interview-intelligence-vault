import { contentHash } from "../db/ids.js";
import type { GeneratedFile, GeneratedFileLogicalType } from "./types.js";

export const generatedWarning = `> [!warning] Generated view
> This note is generated from the SQLite database. The database is the source of truth. Editing this Markdown file will not update memory truth.`;
export const frontmatter = (input: Record<string, string | number | boolean | null | undefined>) => `---\n${Object.entries(input).filter(([, value]) => value != null).map(([key, value]) => `${key}: ${typeof value === "string" ? JSON.stringify(value) : value}`).join("\n")}\n---`;
export const quote = (text: string, max = 500) => (text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text).split("\n").map((line) => `> ${line}`).join("\n");
export const makeGeneratedFile = (logicalType: GeneratedFileLogicalType, relativePath: string, content: string, entityType?: string, entityId?: string): GeneratedFile => ({
  logicalType, relativePath, content: content.endsWith("\n") ? content : `${content}\n`, contentHash: contentHash(content.endsWith("\n") ? content : `${content}\n`), entityType, entityId,
});
