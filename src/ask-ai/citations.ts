import { createHash } from "node:crypto";
import type { AskAICitation, AskAIEvidenceItem } from "./types.js";

const stableId = (value: string) => `aic_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;

export function buildCitations(evidence: AskAIEvidenceItem[]): AskAICitation[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    if (seen.has(item.evidencePointerId)) return false;
    seen.add(item.evidencePointerId); return true;
  }).map((item, index) => ({
    id: stableId(item.evidencePointerId), label: `[${index + 1}]`, evidencePointerId: item.evidencePointerId,
    sourcePointerId: item.sourcePointerId, transcriptId: item.transcriptId, spanId: item.spanId,
    quotePreview: item.quotePreview, clickbackUri: item.clickbackUri,
  }));
}

export const renderCitation = (citation: AskAICitation): string => `${citation.label}(${citation.clickbackUri})`;
