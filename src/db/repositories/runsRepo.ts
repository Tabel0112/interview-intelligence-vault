import type { SqliteDatabase } from "../connection.js";
import { NotFoundError } from "../errors.js";
import { createId } from "../ids.js";
import type { JsonObject, ProcessingRun, ProcessingRunType } from "../schema.js";
import { json, now, parseRow } from "../utils.js";

export interface StartRunInput { id?: string; run_type: ProcessingRunType; model_name?: string | null; agent_name?: string | null; input?: JsonObject; metadata?: JsonObject; }

export function createRunsRepo(db: SqliteDatabase) {
  const getRun = (id: string): ProcessingRun | null => parseRow<ProcessingRun | null>(db.prepare("SELECT * FROM processing_runs WHERE id = ?").get(id));
  const finish = (id: string, status: "completed" | "failed", value: JsonObject) => {
    const field = status === "completed" ? "output_json" : "error_json";
    const result = db.prepare(`UPDATE processing_runs SET status = ?, completed_at = ?, ${field} = ? WHERE id = ? AND status = 'running'`).run(status, now(), json(value), id);
    if (!result.changes) throw new NotFoundError(`Running processing run not found: ${id}`);
    return getRun(id)!;
  };
  return {
    startRun(input: StartRunInput): ProcessingRun {
      const row = { id: input.id ?? createId("run_"), run_type: input.run_type, status: "running", started_at: now(), model_name: input.model_name ?? null, agent_name: input.agent_name ?? null, input_json: json(input.input), metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO processing_runs(id,run_type,status,started_at,model_name,agent_name,input_json,metadata_json) VALUES (@id,@run_type,@status,@started_at,@model_name,@agent_name,@input_json,@metadata_json)`).run(row);
      return getRun(row.id)!;
    },
    completeRun(id: string, output: JsonObject = {}): ProcessingRun { return finish(id, "completed", output); },
    failRun(id: string, error: JsonObject): ProcessingRun { return finish(id, "failed", error); },
    getRun,
  };
}
