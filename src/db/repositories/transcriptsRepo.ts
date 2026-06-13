import type { SqliteDatabase } from "../connection.js";
import { DuplicateContentError, NotFoundError } from "../errors.js";
import { createId } from "../ids.js";
import type { JsonObject, Transcript, TranscriptSource, TranscriptSourceType, TranscriptStatus } from "../schema.js";
import { json, now, parseRow, parseRows } from "../utils.js";

export interface CreateTranscriptSourceInput {
  id?: string; source_type: TranscriptSourceType; original_filename?: string | null; raw_storage_uri: string;
  content_hash: string; byte_length: number; metadata?: JsonObject;
}
export interface CreateTranscriptInput {
  id?: string; source_id: string; title: string; language?: string | null; status?: TranscriptStatus;
  content_hash: string; metadata?: JsonObject;
}

export function createTranscriptsRepo(db: SqliteDatabase) {
  return {
    createTranscriptSource(input: CreateTranscriptSourceInput): TranscriptSource {
      const row = { id: input.id ?? createId("src_"), ...input, original_filename: input.original_filename ?? null, created_at: now(), metadata_json: json(input.metadata) };
      try {
        db.prepare(`INSERT INTO transcript_sources(id,source_type,original_filename,raw_storage_uri,content_hash,byte_length,created_at,metadata_json)
          VALUES (@id,@source_type,@original_filename,@raw_storage_uri,@content_hash,@byte_length,@created_at,@metadata_json)`).run(row);
      } catch (error) {
        if (String(error).includes("content_hash")) throw new DuplicateContentError(`Transcript source content already exists: ${input.content_hash}`, { cause: error });
        throw error;
      }
      return parseRow<TranscriptSource>(db.prepare("SELECT * FROM transcript_sources WHERE id = ?").get(row.id));
    },
    createTranscript(input: CreateTranscriptInput): Transcript {
      const timestamp = now();
      const row = { id: input.id ?? createId("tr_"), source_id: input.source_id, title: input.title, language: input.language ?? null, status: input.status ?? "imported", content_hash: input.content_hash, imported_at: timestamp, updated_at: timestamp, metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO transcripts(id,source_id,title,language,status,content_hash,imported_at,updated_at,metadata_json)
        VALUES (@id,@source_id,@title,@language,@status,@content_hash,@imported_at,@updated_at,@metadata_json)`).run(row);
      return parseRow<Transcript>(db.prepare("SELECT * FROM transcripts WHERE id = ?").get(row.id));
    },
    getTranscript(id: string): Transcript | null {
      return parseRow<Transcript | null>(db.prepare("SELECT * FROM transcripts WHERE id = ?").get(id));
    },
    findTranscriptByContentHash(hash: string): Transcript | null {
      return parseRow<Transcript | null>(db.prepare("SELECT * FROM transcripts WHERE content_hash = ? ORDER BY imported_at LIMIT 1").get(hash));
    },
    listTranscripts(): Transcript[] {
      return parseRows<Transcript>(db.prepare("SELECT * FROM transcripts ORDER BY imported_at").all());
    },
    updateTranscriptStatus(id: string, status: TranscriptStatus): void {
      const result = db.prepare("UPDATE transcripts SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
      if (!result.changes) throw new NotFoundError(`Transcript not found: ${id}`);
    },
  };
}
