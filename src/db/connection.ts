import Database from "better-sqlite3";
import { runMigrations } from "./migrations/index.js";

export type SqliteDatabase = Database.Database;

export interface OpenDatabaseOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
  runMigrations?: boolean;
  nativeBinding?: string;
}

export function openDatabase(
  filename = ":memory:",
  options: OpenDatabaseOptions = {},
): SqliteDatabase {
  const sqliteOptions: Database.Options = {};
  if (options.readonly !== undefined) sqliteOptions.readonly = options.readonly;
  if (options.fileMustExist !== undefined) sqliteOptions.fileMustExist = options.fileMustExist;
  const nativeBinding = options.nativeBinding
    ?? (globalThis as typeof globalThis & { __TRANSCRIPT_MEMORY_NATIVE_BINDING__?: string }).__TRANSCRIPT_MEMORY_NATIVE_BINDING__;
  if (nativeBinding !== undefined) sqliteOptions.nativeBinding = nativeBinding;
  const db = new Database(filename, sqliteOptions);
  db.pragma("foreign_keys = ON");
  if (filename !== ":memory:" && !options.readonly) {
    db.pragma("journal_mode = WAL");
  }
  if (options.runMigrations !== false && !options.readonly) {
    runMigrations(db);
  }
  return db;
}
