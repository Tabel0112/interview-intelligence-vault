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

export interface DeleteTranscriptSummary {
  deletedTranscriptId: string;
  spansDeleted: number;
  evidenceItemsDeleted: number;
  memoryEvidenceLinksDeleted: number;
  evidencePointersDeleted: number;
  memoriesDowngraded: number;
  conflictsAffected: number;
  answersAffected: number;
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
    /**
     * Hard-delete a whole transcript and its derived provenance, transactionally. Raw transcript fields are
     * NEVER edited — the whole row is removed. The two `ON DELETE RESTRICT` chains on transcript_spans
     * (evidence_items, memory_object_evidence; evidence_items in turn restricted by legacy ai_answer_citations)
     * are cleared explicitly, in order, before the transcript row is deleted; cascades + existing triggers then
     * remove turns/spans/source_pointers/evidence_pointers/ask_ai_run_evidence/extraction_runs and downgrade any
     * now-evidence-less memories and affected conflicts. Memory objects are NOT deleted directly. Generated
     * Markdown is untouched here (it self-prunes on the next sync). Throws NotFoundError for an unknown id; the
     * transaction leaves no half-deleted state.
     */
    deleteTranscript(id: string): DeleteTranscriptSummary {
      if (!db.prepare("SELECT 1 FROM transcripts WHERE id = ?").get(id)) throw new NotFoundError(`Transcript not found: ${id}`);
      return db.transaction((): DeleteTranscriptSummary => {
        const spanIds = (db.prepare("SELECT id FROM transcript_spans WHERE transcript_id = ?").all(id) as Array<{ id: string }>).map((r) => r.id);
        const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { c: number }).c;
        const inSpans = (column: string) => `${column} IN (${spanIds.map(() => "?").join(",")})`;

        // Counts captured BEFORE deleting, so the summary reflects what is removed/affected.
        const evidenceItemIds = spanIds.length
          ? (db.prepare(`SELECT id FROM evidence_items WHERE ${inSpans("span_id")}`).all(...spanIds) as Array<{ id: string }>).map((r) => r.id)
          : [];
        const memoryEvidenceLinksDeleted = spanIds.length ? count(`SELECT COUNT(*) c FROM memory_object_evidence WHERE ${inSpans("span_id")}`, ...spanIds) : 0;
        const evidencePointersDeleted = count("SELECT COUNT(*) c FROM evidence_pointers WHERE transcript_id = ?", id);
        const conflictsAffected = count("SELECT COUNT(DISTINCT conflict_assessment_id) c FROM conflict_evidence_links WHERE evidence_pointer_id IN (SELECT evidence_pointer_id FROM evidence_pointers WHERE transcript_id = ?)", id);
        const answersAffected = count("SELECT COUNT(DISTINCT ask_ai_run_id) c FROM ask_ai_run_evidence WHERE transcript_id = ?", id);
        const activeMemoryIds = (db.prepare("SELECT id FROM memory_objects WHERE status = 'active' OR extraction_status = 'active'").all() as Array<{ id: string }>).map((r) => r.id);

        // Clear the RESTRICT chains in safe order, then delete the transcript (cascade + triggers do the rest).
        if (evidenceItemIds.length) db.prepare(`DELETE FROM ai_answer_citations WHERE evidence_item_id IN (${evidenceItemIds.map(() => "?").join(",")})`).run(...evidenceItemIds);
        if (spanIds.length) {
          db.prepare(`DELETE FROM evidence_items WHERE ${inSpans("span_id")}`).run(...spanIds);
          db.prepare(`DELETE FROM memory_object_evidence WHERE ${inSpans("span_id")}`).run(...spanIds);
        }
        db.prepare("DELETE FROM transcripts WHERE id = ?").run(id);

        // A memory that was active before but is no longer active (downgraded by the cleanup triggers because
        // it lost all of its evidence) counts as downgraded.
        const memoriesDowngraded = activeMemoryIds.filter((memoryId) => {
          const row = db.prepare("SELECT status, extraction_status FROM memory_objects WHERE id = ?").get(memoryId) as { status: string; extraction_status: string | null } | undefined;
          return row != null && row.status !== "active" && row.extraction_status !== "active";
        }).length;

        return { deletedTranscriptId: id, spansDeleted: spanIds.length, evidenceItemsDeleted: evidenceItemIds.length, memoryEvidenceLinksDeleted, evidencePointersDeleted, memoriesDowngraded, conflictsAffected, answersAffected };
      })();
    },
  };
}
