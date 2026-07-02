import type { SqliteDatabase } from "../db/connection.js";
import { generatedWarning, makeGeneratedFile } from "./markdown.js";
import type { GeneratedFile } from "./types.js";

export function generateHomeNote(db: SqliteDatabase): GeneratedFile {
  const count = (table: string, where = "") => (db.prepare(`SELECT COUNT(*) count FROM ${table} ${where}`).get() as { count: number }).count;
  // A system/landing note — tagged #tmv/system and deliberately link-free so it never becomes a graph hub.
  // Browse paths are plain text (not [[wikilinks]]) so they do not create native-graph edges to everything.
  return makeGeneratedFile("home", "00 Home.md", `---
tags: [tmv/system]
---
# Memory Vault

#tmv/system

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

## Browse (folders)

Open these folders in the file explorer; they are plain paths, not links, so this note stays out of the graph:

- Transcripts/
- Memories/
- People/  ·  Topics/  ·  Decisions/
- Evidence/
- Answers/
- Conflicts/
- _system/graph-guide.md (recommended Obsidian graph filters)`);
}
