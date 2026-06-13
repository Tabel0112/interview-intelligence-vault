import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../db/connection.js";
import { NotFoundError, ValidationError } from "../db/errors.js";
import type { EvidenceTargetType } from "./types.js";

export const stableProvenanceId = (prefix: string, value: string): string =>
  `${prefix}${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;

export function validateScore(value: number | null | undefined, name: string): void {
  if (value != null && (!Number.isFinite(value) || value < 0 || value > 1)) throw new ValidationError(`${name} must be between 0 and 1`);
}

export function requireTarget(db: SqliteDatabase, type: EvidenceTargetType, id: string): void {
  const tables: Record<EvidenceTargetType, string> = {
    memory_object: "memory_objects", claim: "memory_objects", summary: "memory_objects",
    answer: "ai_answers", answer_claim: "answer_claims", graph_node: "graph_nodes", graph_edge: "graph_edges",
  };
  const idColumns: Partial<Record<EvidenceTargetType, string>> = { answer_claim: "answer_claim_id" };
  const column = idColumns[type] ?? "id";
  const row = db.prepare(`SELECT 1 FROM ${tables[type]} WHERE ${column} = ?`).get(id);
  if (!row) throw new NotFoundError(`${type} target not found: ${id}`);
}

export const rolePrioritySql = `CASE evidence_role WHEN 'support' THEN 1 WHEN 'opposition' THEN 2 WHEN 'conditional' THEN 3 WHEN 'neutral' THEN 4 ELSE 5 END`;
