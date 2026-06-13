import type { EvidenceConfidence, QueryUnderstanding } from "./types.js";

export function suggestFollowups(confidence: EvidenceConfidence, query: QueryUnderstanding): string[] {
  if (confidence === "no_evidence") return ["Do you want to search only within a specific transcript?", "Do you want to import more transcripts related to this topic?"];
  if (confidence === "weak") return ["Do you want to see the exact transcript spans I found?", "Do you want to broaden the search?"];
  if (confidence === "conflicting") return ["Do you want to compare the conflicting transcript moments?", "Do you want to review which source is newer?"];
  return query.needsChronology
    ? ["Do you want the answer grouped by speaker?", "Do you want the supporting transcript clips?"]
    : ["Do you want a timeline of this?", "Do you want the answer grouped by speaker?", "Do you want the supporting transcript clips?"];
}
