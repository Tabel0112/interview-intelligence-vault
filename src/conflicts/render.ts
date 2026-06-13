import type { ConflictAssessment } from "./types.js";

export function renderConflictContext(conflicts: ConflictAssessment[]): string {
  const active = conflicts.filter((conflict) => conflict.status === "active");
  if (!active.length) return "";
  const lines = active.map((conflict) => {
    const citations = conflict.evidence.map((item) => `[source](mv://evidence/${item.evidencePointerId})`).join(" ");
    return `- **${conflict.kind.replaceAll("_", " ")}:** ${conflict.explanation} ${citations}`;
  });
  return `**Conflict context**\n\n${lines.join("\n")}`;
}

export function renderConflictMarkdown(conflict: ConflictAssessment): string {
  const title = conflict.kind.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const evidence = (side: "left" | "right") => conflict.evidenceLinks
    .filter((item) => item.side === side)
    .map((item) => `- [${item.quotePreview ?? item.evidencePointerId}](mv://evidence/${item.evidencePointerId})`)
    .join("\n") || "- No validated evidence";
  const handling = conflict.kind === "temporal_update" ? "Newer evidence appears to update the older memory."
    : conflict.status === "needs_review" ? "Needs review."
      : conflict.kind === "direct_contradiction" ? "Both sides should be shown until resolved." : "Preserve the contextual difference.";
  return `## Conflict / Tension

Type: ${title}
Status: ${conflict.status}
Confidence: ${conflict.confidence.toFixed(3)}

### Left side
Target: ${conflict.leftTargetType}:${conflict.leftTargetId}
Evidence:
${evidence("left")}

### Right side
Target: ${conflict.rightTargetType}:${conflict.rightTargetId}
Evidence:
${evidence("right")}

### Explanation
${conflict.explanation}

### Suggested handling
${handling}`;
}
