import { ValidationError } from "../db/errors.js";

function encodeId(value: string, name: string): string {
  if (!value.trim()) throw new ValidationError(`${name} must be non-empty`);
  return encodeURIComponent(value);
}

export function makeSourcePointerUri(input: { transcriptId: string; spanId: string }): string {
  return `mv://source/transcript/${encodeId(input.transcriptId, "transcriptId")}/span/${encodeId(input.spanId, "spanId")}`;
}

export function parseSourcePointerUri(uri: string): { transcriptId: string; spanId: string } {
  const match = uri.match(/^mv:\/\/source\/transcript\/([^/]+)\/span\/([^/]+)$/);
  if (!match) throw new ValidationError(`Malformed source pointer URI: ${uri}`);
  try {
    const transcriptId = decodeURIComponent(match[1]), spanId = decodeURIComponent(match[2]);
    if (!transcriptId.trim() || !spanId.trim()) throw new Error();
    return { transcriptId, spanId };
  } catch {
    throw new ValidationError(`Malformed source pointer URI: ${uri}`);
  }
}

export function makeEvidencePointerUri(evidencePointerId: string): string {
  return `mv://evidence/${encodeId(evidencePointerId, "evidencePointerId")}`;
}

export function parseEvidencePointerUri(uri: string): { evidencePointerId: string } {
  const match = uri.match(/^mv:\/\/evidence\/([^/]+)$/);
  if (!match) throw new ValidationError(`Malformed evidence pointer URI: ${uri}`);
  try {
    const evidencePointerId = decodeURIComponent(match[1]);
    if (!evidencePointerId.trim()) throw new Error();
    return { evidencePointerId };
  } catch {
    throw new ValidationError(`Malformed evidence pointer URI: ${uri}`);
  }
}
