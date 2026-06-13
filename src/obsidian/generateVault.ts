import { resolve } from "node:path";
import type { SqliteDatabase } from "../db/connection.js";
import { createId } from "../db/ids.js";
import { generateAnswerNotes } from "./answerNotes.js";
import { generateConflictNotes } from "./conflictNotes.js";
import { generateEntityNotes } from "./entityNotes.js";
import { generateEvidenceNotes } from "./evidenceNotes.js";
import { buildDecisionGraph, buildPeopleGraph, buildSourceEvidenceGraph, buildTopicGraph } from "./graphFilters.js";
import { buildObsidianGraph } from "./graphBuilder.js";
import { makeGraphJsonFile, makeGraphMarkdownFile } from "./graphRenderers.js";
import { generateHomeNote } from "./home.js";
import { buildManifest } from "./manifest.js";
import { generateMemoryNotes } from "./memoryNotes.js";
import { makeGeneratedFile } from "./markdown.js";
import { generateTranscriptNotes } from "./transcriptNotes.js";
import type { GeneratedFile, ObsidianViewConfig, ObsidianViewResult } from "./types.js";
import { writeGeneratedVault } from "./vaultWriter.js";

const defaults = {
  includeTranscriptNotes: true, includeMemoryNotes: true, includeEntityNotes: true, includeAnswerNotes: true,
  includeConflictNotes: true, includeEvidenceNotes: true, includeGraphJson: true, includeGraphMarkdown: true, maxQuoteLength: 300,
};
export async function generateObsidianVault(db: SqliteDatabase, config: ObsidianViewConfig): Promise<ObsidianViewResult> {
  const options = { ...defaults, ...config }, outputRoot = resolve(config.outputRoot), files: GeneratedFile[] = [generateHomeNote(db)], warnings: string[] = [];
  if (options.includeTranscriptNotes) files.push(...generateTranscriptNotes(db));
  if (options.includeMemoryNotes) files.push(...generateMemoryNotes(db, options.maxQuoteLength));
  if (options.includeEntityNotes) files.push(...generateEntityNotes(db));
  if (options.includeAnswerNotes) files.push(...generateAnswerNotes(db, options.maxQuoteLength));
  if (options.includeConflictNotes) files.push(...generateConflictNotes(db, options.maxQuoteLength));
  if (options.includeEvidenceNotes) { const evidence = generateEvidenceNotes(db, options.maxQuoteLength); files.push(...evidence.files); warnings.push(...evidence.warnings); }
  const built = buildObsidianGraph(db); warnings.push(...built.warnings);
  const graphs = [
    ["Topic Graph", "topic-graph.json", buildTopicGraph(built.graph)],
    ["People Graph", "people-graph.json", buildPeopleGraph(built.graph)],
    ["Decision Graph", "decision-graph.json", buildDecisionGraph(built.graph)],
    ["Source Evidence Graph", "source-evidence-graph.json", buildSourceEvidenceGraph(built.graph)],
  ] as const;
  if (options.includeGraphJson) {
    files.push(makeGraphJsonFile("Graphs/graph-data.json", built.graph));
    graphs.forEach(([, path, graph]) => files.push(makeGraphJsonFile(`Graphs/${path}`, graph)));
  }
  const broken = warnings.filter((warning) => warning.startsWith("Broken evidence pointer")).length;
  if (options.includeGraphMarkdown) graphs.forEach(([title, path, graph]) => files.push(makeGraphMarkdownFile(title, `Graphs/${title}.md`, `Graphs/${path}`, graph, broken)));
  files.push(makeGeneratedFile("system_manifest", "_system/generation-log.md", `# Generation Log\n\nThis deterministic generated view contains ${files.length + 2} files, ${built.graph.nodes.length} graph nodes, and ${built.graph.edges.length} graph edges.\n\nSQLite remains the source of truth.`));
  const duplicates = files.map((file) => file.relativePath).filter((path, index, all) => all.indexOf(path) !== index);
  if (duplicates.length) throw new Error(`Generated path collision: ${[...new Set(duplicates)].join(", ")}`);
  const { manifest, file: manifestFile } = buildManifest(files, built.graph, warnings);
  files.push(manifestFile);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const written = await writeGeneratedVault(outputRoot, files, options.cleanBeforeWrite);
  const createdAt = (options.now?.() ?? new Date()).toISOString(), runId = createId("ovr_");
  db.transaction(() => {
    db.prepare(`INSERT INTO obsidian_view_runs(id,created_at,output_root,file_count,graph_node_count,graph_edge_count,content_hash,status,error_message)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(runId, createdAt, outputRoot, files.length, built.graph.nodes.length, built.graph.edges.length, manifest.contentHash, written.errors.length ? "failed" : "completed", written.errors.join("\n") || null);
    const insert = db.prepare(`INSERT INTO obsidian_generated_files(id,view_run_id,logical_type,entity_type,entity_id,relative_path,content_hash,created_at)
      VALUES (?,?,?,?,?,?,?,?)`);
    files.forEach((generated) => insert.run(createId("ovf_"), runId, generated.logicalType, generated.entityType ?? null, generated.entityId ?? null, generated.relativePath, generated.contentHash, createdAt));
  })();
  return { outputRoot, filesWritten: written.filesWritten, filesSkipped: written.filesSkipped, graphNodeCount: built.graph.nodes.length, graphEdgeCount: built.graph.edges.length, warnings, errors: written.errors, manifestPath: resolve(outputRoot, "_system/view-manifest.json"), contentHash: manifest.contentHash, files };
}
