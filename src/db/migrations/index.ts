import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqliteDatabase } from "../connection.js";

const migrationDirectory = (globalThis as typeof globalThis & { __TRANSCRIPT_MEMORY_MIGRATION_DIR__?: string }).__TRANSCRIPT_MEMORY_MIGRATION_DIR__
  ?? dirname(fileURLToPath(import.meta.url));
export const PACKAGED_MIGRATIONS = [
  { id: "001", name: "initial_schema", filename: "001_initial_schema.sql" },
  { id: "002", name: "tighten_transcript_immutability", filename: "002_tighten_transcript_immutability.sql" },
  { id: "003", name: "transcript_ingestion", filename: "003_transcript_ingestion.sql" },
  { id: "004", name: "provenance_pointers", filename: "004_provenance_pointers.sql" },
  { id: "005", name: "memory_extraction", filename: "005_memory_extraction.sql" },
  { id: "006", name: "canonical_memory_status", filename: "006_canonical_memory_status.sql" },
  { id: "007", name: "search_retrieval", filename: "007_search_retrieval.sql" },
  { id: "008", name: "evidence_quality_scoring", filename: "008_evidence_quality_scoring.sql" },
  { id: "009", name: "ask_ai_pipeline", filename: "009_ask_ai_pipeline.sql" },
  { id: "010", name: "conflict_detection", filename: "010_conflict_detection.sql" },
  { id: "011", name: "agent_orchestration_hermes", filename: "011_agent_orchestration_hermes.sql" },
  { id: "012", name: "obsidian_views", filename: "012_obsidian_views.sql" },
] as const;

export const PACKAGED_MIGRATION_COUNT = PACKAGED_MIGRATIONS.length;

export function validateMigrationPackage(directory = migrationDirectory): { ok: true; count: number } | { ok: false; count: number; missing: string[] } {
  const missing = PACKAGED_MIGRATIONS.map((migration) => migration.filename).filter((filename) => !existsSync(join(directory, filename)));
  return missing.length ? { ok: false, count: PACKAGED_MIGRATION_COUNT, missing } : { ok: true, count: PACKAGED_MIGRATION_COUNT };
}

export function runMigrations(db: SqliteDatabase): void {
  const packageStatus = validateMigrationPackage();
  if (!packageStatus.ok) throw new Error(`Missing packaged migrations: ${packageStatus.missing.join(", ")}`);
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  for (const migration of PACKAGED_MIGRATIONS) {
    const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(migration.id);
    if (!applied) {
      db.transaction(() => {
        db.exec(readFileSync(join(migrationDirectory, migration.filename), "utf8"));
        db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(migration.id, migration.name, new Date().toISOString());
      })();
    }
  }
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5(search_text, content='search_documents', content_rowid='rowid')");
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS search_documents_ai AFTER INSERT ON search_documents BEGIN
        INSERT INTO search_documents_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
      END;
      CREATE TRIGGER IF NOT EXISTS search_documents_ad AFTER DELETE ON search_documents BEGIN
        INSERT INTO search_documents_fts(search_documents_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
      END;
      CREATE TRIGGER IF NOT EXISTS search_documents_au AFTER UPDATE ON search_documents BEGIN
        INSERT INTO search_documents_fts(search_documents_fts, rowid, search_text) VALUES ('delete', old.rowid, old.search_text);
        INSERT INTO search_documents_fts(rowid, search_text) VALUES (new.rowid, new.search_text);
      END;
    `);
  } catch {
    // FTS5 is optional; searchRepo falls back to LIKE.
  }
  try {
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS retrieval_documents_fts USING fts5(
      target_type UNINDEXED,target_id UNINDEXED,title,search_text,speaker_name,topic_text,tokenize='unicode61'
    )`);
  } catch {
    // Retrieval keyword search falls back to deterministic LIKE/token matching.
  }
}
