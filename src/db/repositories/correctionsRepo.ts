import type { SqliteDatabase } from "../connection.js";
import { EvidenceRequiredError, NotFoundError, ValidationError } from "../errors.js";
import { createId } from "../ids.js";
import type { CorrectionTargetType, CorrectionType, GraphEdge, JsonObject, MemoryObject, UserCorrection } from "../schema.js";
import { assertScore, json, now, parseRow, parseRows } from "../utils.js";

export interface CreateCorrectionInput { id?: string; target_type: CorrectionTargetType; target_id: string; correction_type: CorrectionType; old_value?: JsonObject | null; new_value: JsonObject; reason?: string | null; created_by?: string; metadata?: JsonObject; }
export type ApplyCorrectionInput = Omit<CreateCorrectionInput, "target_type" | "target_id" | "old_value">;

const memoryFields = new Set(["title", "generated_text", "normalized_text", "status", "confidence", "metadata_json"]);
const edgeFields = new Set(["edge_type", "source_type", "confidence", "evidence_bundle_id", "status", "metadata_json"]);

export function createCorrectionsRepo(db: SqliteDatabase) {
  const createCorrection = (input: CreateCorrectionInput): UserCorrection => {
    const row = { id: input.id ?? createId("corr_"), target_type: input.target_type, target_id: input.target_id, correction_type: input.correction_type, old_value_json: input.old_value == null ? null : json(input.old_value), new_value_json: json(input.new_value), reason: input.reason ?? null, created_at: now(), created_by: input.created_by ?? "user", metadata_json: json(input.metadata) };
    db.prepare(`INSERT INTO user_corrections(id,target_type,target_id,correction_type,old_value_json,new_value_json,reason,created_at,created_by,metadata_json)
      VALUES (@id,@target_type,@target_id,@correction_type,@old_value_json,@new_value_json,@reason,@created_at,@created_by,@metadata_json)`).run(row);
    return parseRow<UserCorrection>(db.prepare("SELECT * FROM user_corrections WHERE id = ?").get(row.id));
  };
  const apply = <T>(table: "memory_objects" | "graph_edges", targetType: "memory_object" | "graph_edge", id: string, input: ApplyCorrectionInput, allowed: Set<string>): T => db.transaction(() => {
    const current = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!current) throw new NotFoundError(`${targetType} not found: ${id}`);
    const entries = Object.entries(input.new_value);
    if (!entries.length || entries.some(([key]) => !allowed.has(key))) throw new ValidationError(`Correction contains unsupported ${targetType} fields`);
    const confidence = input.new_value.confidence;
    if (typeof confidence === "number") assertScore(confidence, "confidence");
    const resulting = { ...current, ...input.new_value };
    if (table === "memory_objects" && resulting.status === "active") {
      const count = (db.prepare(`SELECT
        (SELECT COUNT(*) FROM memory_object_evidence WHERE memory_id=?) +
        (SELECT COUNT(*) FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id=?) count`).get(id, id) as { count: number }).count;
      if (!count) throw new EvidenceRequiredError("An active corrected memory object requires evidence");
    }
    if (table === "graph_edges" && resulting.source_type === "source_backed") {
      const count = resulting.evidence_bundle_id
        ? (db.prepare("SELECT COUNT(*) count FROM evidence_items WHERE bundle_id = ?").get(resulting.evidence_bundle_id) as { count: number }).count
        : 0;
      if (!count) throw new EvidenceRequiredError("A source-backed corrected graph edge requires evidence");
    }
    const assignments = entries.map(([key]) => `${key} = @${key}`).concat("updated_at = @updated_at");
    const values = Object.fromEntries(entries.map(([key, value]) => [key, key === "metadata_json" ? json(value) : value]));
    if (table === "memory_objects") {
      assignments.push("user_corrected = 1");
      if (input.new_value.status != null && current.extraction_status != null) {
        assignments.push("extraction_status = @canonical_status");
        values.canonical_status = input.new_value.status;
      }
      if (typeof input.new_value.confidence === "number" && current.confidence_label != null) {
        assignments.push("confidence_label = @canonical_confidence_label");
        values.canonical_confidence_label = input.new_value.confidence >= 0.8 ? "high" : input.new_value.confidence >= 0.6 ? "medium" : "low";
      }
    }
    db.prepare(`UPDATE ${table} SET ${assignments.join(", ")} WHERE id = @id`).run({ ...values, id, updated_at: now() });
    createCorrection({ ...input, target_type: targetType, target_id: id, old_value: Object.fromEntries(entries.map(([key]) => [key, current[key]])) });
    return parseRow<T>(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
  })();
  return {
    createCorrection,
    listCorrectionsForTarget(targetType: CorrectionTargetType, targetId: string): UserCorrection[] {
      return parseRows<UserCorrection>(db.prepare("SELECT * FROM user_corrections WHERE target_type = ? AND target_id = ? ORDER BY created_at").all(targetType, targetId));
    },
    applyMemoryObjectCorrection(memoryId: string, input: ApplyCorrectionInput): MemoryObject { return apply<MemoryObject>("memory_objects", "memory_object", memoryId, input, memoryFields); },
    applyGraphEdgeCorrection(edgeId: string, input: ApplyCorrectionInput): GraphEdge { return apply<GraphEdge>("graph_edges", "graph_edge", edgeId, input, edgeFields); },
  };
}
