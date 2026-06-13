import { classifyConflictCandidate } from "./rules.js";
import type { ConflictCandidate, ConflictClassification, ConflictClassificationOptions } from "./types.js";

export interface ConflictStatement {
  targetId: string;
  targetType: ConflictCandidate["leftTargetType"];
  text: string;
  evidenceIds: string[];
  timestamp?: string | null;
  entities?: string[];
  topics?: string[];
}

const intersection = (left: string[] = [], right: string[] = []) => left.filter((item) => right.includes(item));

export function generateConflictCandidates(statements: ConflictStatement[]): ConflictCandidate[] {
  const candidates: ConflictCandidate[] = [];
  for (let leftIndex = 0; leftIndex < statements.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < statements.length; rightIndex += 1) {
      const left = statements[leftIndex], right = statements[rightIndex];
      const sharedEntities = intersection(left.entities, right.entities);
      const sharedTopics = intersection(left.topics, right.topics);
      const words = new Set(left.text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
      const lexicalOverlap = (right.text.toLowerCase().match(/[a-z0-9]+/g) ?? []).some((word) => word.length > 3 && words.has(word));
      if (!sharedEntities.length && !sharedTopics.length && !lexicalOverlap) continue;
      candidates.push({
        leftTargetId: left.targetId, leftTargetType: left.targetType, leftText: left.text, leftEvidenceIds: left.evidenceIds,
        leftTimestamp: left.timestamp, rightTargetId: right.targetId, rightTargetType: right.targetType, rightText: right.text,
        rightEvidenceIds: right.evidenceIds, rightTimestamp: right.timestamp, sharedEntities, sharedTopics,
      });
    }
  }
  return candidates;
}

export function detectConflicts(statements: ConflictStatement[], options: ConflictClassificationOptions = {}): Array<{ candidate: ConflictCandidate; classification: ConflictClassification }> {
  return generateConflictCandidates(statements).map((candidate) => ({ candidate, classification: classifyConflictCandidate(candidate, options) }));
}
