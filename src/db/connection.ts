import Database from "better-sqlite3";
import { runMigrations } from "./migrations/index.js";

export type SqliteDatabase = Database.Database;

export interface OpenDatabaseOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
  runMigrations?: boolean;
  nativeBinding?: string;
  migrationDirectory?: string;
}

export function openDatabase(
  filename = ":memory:",
  options: OpenDatabaseOptions = {},
): SqliteDatabase {
  const sqliteOptions: Database.Options = {};
  if (options.readonly !== undefined) sqliteOptions.readonly = options.readonly;
  if (options.fileMustExist !== undefined) sqliteOptions.fileMustExist = options.fileMustExist;
  if (options.nativeBinding !== undefined) sqliteOptions.nativeBinding = options.nativeBinding;
  const db = new Database(filename, sqliteOptions);
  db.pragma("foreign_keys = ON");
  // Two processes may open the same file (the Obsidian plugin + the MCP server). WAL lets readers and a
  // single writer coexist; busy_timeout makes a brief lock contention wait-and-retry instead of throwing.
  db.pragma("busy_timeout = 5000");
  if (filename !== ":memory:" && !options.readonly) {
    db.pragma("journal_mode = WAL");
  }
  if (options.runMigrations !== false && !options.readonly) {
    runMigrations(db, { directory: options.migrationDirectory });
  }
  return db;
}
