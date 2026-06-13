import type { SqliteDatabase } from "../connection.js";
import { EvidenceRequiredError, NotFoundError, ValidationError } from "../errors.js";
import { createId } from "../ids.js";
import type { EvidenceRole, JsonObject, MemoryObject, MemoryObjectEvidence, MemoryObjectStatus, MemoryObjectType, MemoryObjectWithEvidence } from "../schema.js";
import { assertScore, json, metadataHasMissingEvidence, now, parseRow, parseRows, requireRow } from "../utils.js";
import { getCanonicalMemoryObject, type CanonicalMemoryObject, type CanonicalMemoryObjectStatus, type CanonicalMemoryObjectType, type RawMemoryObjectForCanonical } from "../../memory/canonical.js";

export interface CreateMemoryObjectInput { id?: string; type: MemoryObjectType; title?: string | null; generated_text: string; normalized_text?: string | null; status?: MemoryObjectStatus; confidence: number; created_by: "agent" | "user" | "system"; created_run_id?: string | null; supersedes_memory_id?: string | null; metadata?: JsonObject; }
export interface MemoryEvidenceInput { id?: string; span_id: string; role: EvidenceRole; evidence_score: number; explanation?: string | null; metadata?: JsonObject; }

export function createMemoryObjectsRepo(db: SqliteDatabase) {
  // Raw compatibility row. Do not use raw type/status fields for trust decisions.
  const getMemoryObject = (id: string) => parseRow<MemoryObject | null>(db.prepare("SELECT * FROM memory_objects WHERE id = ?").get(id));
  const canonicalize = (row: RawMemoryObjectForCanonical): CanonicalMemoryObject => {
    const evidence = db.prepare(`SELECT e.span_id FROM memory_object_evidence e JOIN transcript_spans s ON s.id=e.span_id WHERE e.memory_id=?
      UNION SELECT e.span_id FROM evidence_pointers e JOIN transcript_spans s ON s.id=e.span_id
      WHERE e.target_type IN ('memory_object','claim','summary') AND e.target_id=?`).all(row.id, row.id) as Array<{ span_id: string }>;
    return getCanonicalMemoryObject(row, evidence.map(({ span_id }) => span_id));
  };
  const addEvidence = (memoryId: string, input: MemoryEvidenceInput): MemoryObjectEvidence => {
    assertScore(input.evidence_score, "evidence_score"); requireRow(db, "memory_objects", memoryId); requireRow(db, "transcript_spans", input.span_id);
    const row = { id: input.id ?? createId("evi_"), memory_id: memoryId, span_id: input.span_id, role: input.role, evidence_score: input.evidence_score, explanation: input.explanation ?? null, created_at: now(), metadata_json: json(input.metadata) };
    db.prepare(`INSERT INTO memory_object_evidence(id,memory_id,span_id,role,evidence_score,explanation,created_at,metadata_json) VALUES (@id,@memory_id,@span_id,@role,@evidence_score,@explanation,@created_at,@metadata_json)`).run(row);
    return parseRow<MemoryObjectEvidence>(db.prepare("SELECT * FROM memory_object_evidence WHERE id = ?").get(row.id));
  };
  const createMemoryObject = (input: CreateMemoryObjectInput, evidenceInputs: MemoryEvidenceInput[]): MemoryObject => db.transaction(() => {
    assertScore(input.confidence, "confidence");
    const status = input.status ?? "active";
    if (!evidenceInputs.length && !(status === "needs_review" && metadataHasMissingEvidence(input.metadata))) throw new EvidenceRequiredError("Memory objects require evidence unless needs_review with a missing-evidence reason");
    const timestamp = now();
    const row = { id: input.id ?? createId("mem_"), type: input.type, title: input.title ?? null, generated_text: input.generated_text, normalized_text: input.normalized_text ?? null, status, confidence: input.confidence, created_by: input.created_by, created_run_id: input.created_run_id ?? null, supersedes_memory_id: input.supersedes_memory_id ?? null, created_at: timestamp, updated_at: timestamp, metadata_json: json(input.metadata) };
    db.prepare(`INSERT INTO memory_objects(id,type,title,generated_text,normalized_text,status,confidence,created_by,created_run_id,supersedes_memory_id,created_at,updated_at,metadata_json)
      VALUES (@id,@type,@title,@generated_text,@normalized_text,@status,@confidence,@created_by,@created_run_id,@supersedes_memory_id,@created_at,@updated_at,@metadata_json)`).run(row);
    evidenceInputs.forEach((item) => addEvidence(row.id, item));
    return getMemoryObject(row.id)!;
  })();
  return {
    createMemoryObject, getMemoryObject, addEvidence,
    getCanonicalMemoryObject(id: string): CanonicalMemoryObject | null {
      const row = db.prepare("SELECT * FROM memory_objects WHERE id=?").get(id) as RawMemoryObjectForCanonical | undefined;
      return row ? canonicalize(row) : null;
    },
    listCanonicalMemoryObjects(filter: { type?: CanonicalMemoryObjectType; status?: CanonicalMemoryObjectStatus } = {}): CanonicalMemoryObject[] {
      const rows = db.prepare("SELECT * FROM memory_objects ORDER BY created_at").all() as RawMemoryObjectForCanonical[];
      return rows.map(canonicalize).filter((memory) => (!filter.type || memory.type === filter.type) && (!filter.status || memory.status === filter.status));
    },
    // Raw compatibility rows. Prefer listCanonicalMemoryObjects for downstream systems.
    listMemoryObjects(filter: Partial<Pick<MemoryObject, "type" | "status">> = {}): MemoryObject[] {
      const clauses: string[] = [], values: string[] = [];
      if (filter.type) { clauses.push("type = ?"); values.push(filter.type); }
      if (filter.status) { clauses.push("status = ?"); values.push(filter.status); }
      return parseRows<MemoryObject>(db.prepare(`SELECT * FROM memory_objects ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at`).all(...values));
    },
    getMemoryObjectWithEvidence(id: string): MemoryObjectWithEvidence | null {
      const memory = getMemoryObject(id); if (!memory) return null;
      return { ...memory, evidence: parseRows<MemoryObjectEvidence>(db.prepare("SELECT * FROM memory_object_evidence WHERE memory_id = ? ORDER BY created_at").all(id)) };
    },
    updateMemoryObjectStatus(id: string, status: MemoryObjectStatus): void {
      requireRow(db, "memory_objects", id);
      if (status === "active") {
        const current = db.prepare("SELECT extraction_status,confidence,confidence_label FROM memory_objects WHERE id=?").get(id) as { extraction_status: string | null; confidence: number; confidence_label: string | null };
        if (current.extraction_status != null && (current.confidence_label !== "high" || current.confidence < 0.8)) {
          throw new ValidationError("Weak or review-only extracted memory cannot be promoted to active without an explicit user correction");
        }
        const evidenceCount = (db.prepare(`SELECT
          (SELECT COUNT(*) FROM memory_object_evidence WHERE memory_id = ?) +
          (SELECT COUNT(*) FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id = ?) count`).get(id, id) as { count: number }).count;
        if (!evidenceCount) throw new EvidenceRequiredError("An active memory object requires evidence");
      }
      const result = db.prepare(`UPDATE memory_objects
        SET status = ?, extraction_status = CASE WHEN extraction_status IS NULL THEN NULL ELSE ? END, updated_at = ?
        WHERE id = ?`).run(status, status, now(), id);
      if (!result.changes) throw new NotFoundError(`Memory object status was not updated: ${id}`);
    },
    supersedeMemoryObject(oldId: string, newInput: CreateMemoryObjectInput, evidenceInputs: MemoryEvidenceInput[]): MemoryObject {
      return db.transaction(() => {
        requireRow(db, "memory_objects", oldId);
        const created = createMemoryObject({ ...newInput, supersedes_memory_id: oldId }, evidenceInputs);
        db.prepare(`UPDATE memory_objects
          SET status = 'superseded', extraction_status = CASE WHEN extraction_status IS NULL THEN NULL ELSE 'superseded' END, updated_at = ?
          WHERE id = ?`).run(now(), oldId);
        return created;
      })();
    },
  };
}
