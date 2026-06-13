import type { JsonObject } from "./schema.js";
import { NotFoundError, ValidationError } from "./errors.js";
import type { SqliteDatabase } from "./connection.js";

export const now = (): string => new Date().toISOString();
export const json = (value: unknown = {}): string => JSON.stringify(value);

export function parseRow<T>(row: unknown): T {
  if (!row) return null as T;
  const result = { ...(row as Record<string, unknown>) };
  for (const key of ["metadata_json", "input_json", "output_json", "error_json", "old_value_json", "new_value_json", "embedding_json"]) {
    if (key in result) {
      const target = key.replace(/_json$/, "");
      result[target] = result[key] == null ? null : JSON.parse(String(result[key]));
      delete result[key];
    }
  }
  return result as T;
}

export function parseRows<T>(rows: unknown[]): T[] {
  return rows.map((row) => parseRow<T>(row));
}

export function assertScore(value: number | null | undefined, field: string): void {
  if (value != null && (value < 0 || value > 1 || !Number.isFinite(value))) {
    throw new ValidationError(`${field} must be between 0 and 1`);
  }
}

export function requireRow(db: SqliteDatabase, table: string, id: string): void {
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id);
  if (!row) throw new NotFoundError(`${table} row not found: ${id}`);
}

export function metadataHasMissingEvidence(metadata: JsonObject | undefined): boolean {
  return metadata?.reason === "missing_evidence" || metadata?.missing_evidence_reason != null;
}
