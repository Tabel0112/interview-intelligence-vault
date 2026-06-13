import type { SqliteDatabase } from "../db/connection.js";
import { makeEvidencePointerUri, makeSourcePointerUri, resolveClickback } from "../provenance/index.js";
import { transcriptPath, wikiLink } from "./paths.js";
import type { ClickbackTarget } from "./types.js";

export const createSourceClickbackUri = (input: { transcriptId: string; spanId: string }) => makeSourcePointerUri(input);
export const createEvidenceClickbackUri = (evidencePointerId: string) => makeEvidencePointerUri(evidencePointerId);
export function createTranscriptSpanObsidianLink(input: { transcriptTitle: string; transcriptId: string; spanId: string; label?: string }): string {
  return wikiLink(transcriptPath(input.transcriptTitle, input.transcriptId), input.label ?? `${input.transcriptTitle}, ${input.spanId}`, input.spanId);
}
export function resolveObsidianClickbackTarget(db: SqliteDatabase, uri: string): ClickbackTarget | { error: string } {
  const resolved = resolveClickback(db, uri);
  if (!resolved.ok) return { error: resolved.reason };
  if (resolved.kind === "evidence") return resolveObsidianClickbackTarget(db, String(resolved.sourceUri));
  if (resolved.kind !== "source_span") return { error: "not_a_span_clickback" };
  return { transcriptId: String(resolved.transcriptId), spanId: String(resolved.spanId), startOffset: Number(resolved.rawStartOffset), endOffset: Number(resolved.rawEndOffset), notePath: transcriptPath(String(resolved.transcriptTitle ?? resolved.transcriptId), String(resolved.transcriptId)), anchorId: String(resolved.spanId) };
}
export const resolveClickbackTarget = resolveObsidianClickbackTarget;
