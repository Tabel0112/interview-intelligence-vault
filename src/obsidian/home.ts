import type { SqliteDatabase } from "../db/connection.js";
import { generatedWarning, makeGeneratedFile } from "./markdown.js";
import type { GeneratedFile } from "./types.js";

export function generateHomeNote(db: SqliteDatabase): GeneratedFile {
  const count = (table: string, where = "") => (db.prepare(`SELECT COUNT(*) count FROM ${table} ${where}`).get() as { count: number }).count;
  return makeGeneratedFile("home", "00 Home.md", `# Memory Vault

${generatedWarning}

## Overview

- Transcripts: ${count("transcripts")}
- Memory objects: ${count("memory_objects")}
- Evidence pointers: ${count("evidence_pointers")}
- People: ${count("graph_nodes", "WHERE node_type='entity'")}
- Topics: ${count("graph_nodes", "WHERE node_type='topic'")}
- Decisions: ${count("memory_objects", "WHERE COALESCE(extraction_type,type)='decision'")}
- Answers: ${count("ai_answers")}
- Conflicts: ${count("conflict_assessments")}

## Browse

- [[Transcripts]]
- [[Memories]]
- [[People]]
- [[Topics]]
- [[Decisions]]
- [[Evidence]]
- [[Answers]]
- [[Conflicts]]
- [[Graphs/Topic Graph]]
- [[Graphs/People Graph]]
- [[Graphs/Decision Graph]]
- [[Graphs/Source Evidence Graph]]`);
}
