import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../db/connection.js";
import { resolveEvidencePointer } from "../provenance/index.js";
import { answerPath, conflictPath, entityPath, evidencePath, labelFromText, memoryPath, transcriptPath } from "./paths.js";
import type { ObsidianGraph, ObsidianGraphEdge, ObsidianGraphEdgeType, ObsidianGraphNode } from "./types.js";

const edgeId = (source: string, target: string, type: string, evidence = "") => `ov_edge_${createHash("sha256").update(`${source}:${target}:${type}:${evidence}`).digest("hex").slice(0, 24)}`;
const mapEdgeType = (value: string): ObsidianGraphEdgeType => value === "contradicts" ? "contradicts" : value === "updates" ? "updates" : value === "mentions" ? "mentions" : value === "supports" ? "supports" : value === "derived_from" ? "derived_from" : "about";
const memoryNodeId = (id: string) => `memory:${id}`;
const evidenceNodeId = (id: string) => `evidence:${id}`;
const spanNodeId = (id: string) => `span:${id}`;
const transcriptNodeId = (id: string) => `transcript:${id}`;

export function buildObsidianGraph(db: SqliteDatabase): { graph: ObsidianGraph; warnings: string[] } {
  const nodes = new Map<string, ObsidianGraphNode>(), edges = new Map<string, ObsidianGraphEdge>(), warnings: string[] = [];
  const addNode = (node: ObsidianGraphNode) => nodes.set(node.id, node);
  const addEdge = (edge: Omit<ObsidianGraphEdge, "id">) => { const id = edgeId(edge.source, edge.target, edge.type, edge.evidencePointerId); edges.set(id, { id, ...edge }); };
  const transcripts = db.prepare("SELECT id,title FROM transcripts ORDER BY id").all() as Array<{ id: string; title: string }>;
  transcripts.forEach((row) => addNode({ id: transcriptNodeId(row.id), type: "transcript", label: row.title, notePath: transcriptPath(row.title, row.id), transcriptId: row.id }));
  // Only CANONICAL memories become active graph nodes: duplicates (duplicate_of_id set) and
  // superseded/rejected rows are excluded so the same claim shows once, not many times.
  const memories = db.prepare(`SELECT id,type,title,generated_text,confidence,status FROM memory_objects
    WHERE duplicate_of_id IS NULL AND status NOT IN ('superseded','rejected')
      AND (extraction_status IS NULL OR extraction_status NOT IN ('superseded','rejected'))
    ORDER BY id`).all() as Array<{ id: string; type: string; title: string | null; generated_text: string; confidence: number; status: string }>;
  const canonicalMemoryIds = new Set(memories.map((row) => row.id));
  memories.forEach((row) => addNode({ id: memoryNodeId(row.id), type: row.type === "decision" ? "decision" : row.type === "person" ? "person" : row.type === "topic" ? "topic" : "memory", label: row.title ?? row.generated_text.slice(0, 80), notePath: row.type === "decision" ? entityPath("decision", row.title ?? row.generated_text.slice(0, 80), row.id) : memoryPath(row.title ?? row.generated_text.slice(0, 80), row.id, row.type), confidence: row.confidence, supportStatus: row.status }));
  const pointers = db.prepare("SELECT * FROM evidence_pointers ORDER BY evidence_pointer_id").all() as Array<Record<string, unknown>>;
  for (const pointer of pointers) {
    // Hide evidence that only backs a superseded/duplicate memory (its consolidated copy on the canonical
    // is shown instead) — otherwise a merged duplicate's pointer would float as an orphan evidence node.
    if (String(pointer.target_type) === "memory_object" && !canonicalMemoryIds.has(String(pointer.target_id))) continue;
    const id = String(pointer.evidence_pointer_id), resolved = resolveEvidencePointer(db, id);
    // Readable label/notePath from the resolved span text (must match evidenceNotes.ts so wikilinks resolve);
    // broken pointers fall back to a fixed label, identical to the evidence-note builder.
    const evidenceLabel = resolved.ok ? labelFromText(resolved.spanText) || id : "Broken evidence";
    addNode({ id: evidenceNodeId(id), type: "evidence", label: resolved.ok ? evidenceLabel : id, notePath: evidencePath(evidenceLabel, id), evidenceUri: String(pointer.pointer_uri), transcriptId: String(pointer.transcript_id), spanId: String(pointer.span_id), confidence: Number(pointer.confidence), supportStatus: String(pointer.evidence_strength) });
    if (!resolved.ok) { warnings.push(`Broken evidence pointer ${id}: ${resolved.reason}`); continue; }
    const spanId = String(pointer.span_id), transcriptId = String(pointer.transcript_id);
    addNode({ id: spanNodeId(spanId), type: "span", label: spanId, sourceUri: String(pointer.source_pointer_uri), transcriptId, spanId });
    addEdge({ source: spanNodeId(spanId), target: transcriptNodeId(transcriptId), type: "belongs_to" });
    addEdge({ source: evidenceNodeId(id), target: spanNodeId(spanId), type: "derived_from", evidencePointerId: id, confidence: Number(pointer.confidence) });
    const targetType = String(pointer.target_type), targetId = String(pointer.target_id);
    const target = targetType === "memory_object" || targetType === "claim" || targetType === "summary" ? memoryNodeId(targetId) : targetType === "answer" ? `answer:${targetId}` : targetType === "answer_claim" ? `claim:${targetId}` : `graph:${targetId}`;
    if (targetType === "answer") {
      const ans = db.prepare("SELECT question_text FROM ai_answers WHERE id=?").get(targetId) as { question_text: string } | undefined;
      addNode({ id: target, type: "answer", label: ans?.question_text ?? targetId, notePath: answerPath(ans?.question_text ?? targetId, targetId) });
    }
    if (targetType === "answer_claim") {
      const claim = db.prepare("SELECT claim_text,support_status FROM answer_claims WHERE answer_claim_id=?").get(targetId) as { claim_text: string; support_status: string } | undefined;
      if (claim) addNode({ id: target, type: "claim", label: claim.claim_text, supportStatus: claim.support_status });
    }
    if (targetType === "graph_node" || targetType === "graph_edge") {
      const object = targetType === "graph_node"
        ? db.prepare("SELECT label FROM graph_nodes WHERE id=?").get(targetId) as { label: string } | undefined
        : db.prepare("SELECT edge_type label FROM graph_edges WHERE id=?").get(targetId) as { label: string } | undefined;
      if (object) addNode({ id: target, type: "memory", label: object.label, metadata: { graphTargetType: targetType } });
    }
    if (nodes.has(target)) addEdge({ source: target, target: evidenceNodeId(id), type: targetType === "answer_claim" || targetType === "answer" ? "cites" : "derived_from", evidencePointerId: id, confidence: Number(pointer.confidence) });
  }
  const answers = db.prepare("SELECT id,question_text,answer_status FROM ai_answers ORDER BY id").all() as Array<{ id: string; question_text: string; answer_status: string }>;
  answers.forEach((row) => addNode({ id: `answer:${row.id}`, type: "answer", label: row.question_text, notePath: answerPath(row.question_text, row.id), supportStatus: row.answer_status }));
  const claims = db.prepare("SELECT * FROM answer_claims ORDER BY answer_claim_id").all() as Array<Record<string, unknown>>;
  claims.forEach((row) => {
    const pointer = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type='answer_claim' AND target_id=? ORDER BY evidence_pointer_id LIMIT 1").get(row.answer_claim_id) as { evidence_pointer_id: string } | undefined;
    addNode({ id: `claim:${row.answer_claim_id}`, type: "claim", label: String(row.claim_text), supportStatus: String(row.support_status) });
    addEdge({ source: `claim:${row.answer_claim_id}`, target: `answer:${row.answer_id}`, type: "answered_by", evidencePointerId: pointer?.evidence_pointer_id });
  });
  const conflicts = db.prepare("SELECT * FROM conflict_assessments ORDER BY id").all() as Array<Record<string, unknown>>;
  conflicts.forEach((row) => {
    const id = String(row.id), conflictNode = `conflict:${id}`;
    addNode({ id: conflictNode, type: "conflict", label: String(row.summary), notePath: conflictPath(String(row.summary), id), confidence: Number(row.confidence), supportStatus: String(row.status) });
    for (const side of ["left", "right"] as const) {
      const type = String(row[`${side}_target_type`]), targetId = String(row[`${side}_target_id`]);
      const target = type === "memory_object" || type === "claim" || type === "summary" ? memoryNodeId(targetId) : type === "answer_claim" ? `claim:${targetId}` : type === "evidence_pointer" ? evidenceNodeId(targetId) : `graph:${targetId}`;
      const pointer = db.prepare("SELECT evidence_pointer_id FROM conflict_evidence_links WHERE conflict_assessment_id=? AND side=? AND provenance_validated=1 ORDER BY evidence_pointer_id LIMIT 1").get(id, side) as { evidence_pointer_id: string } | undefined;
      if (nodes.has(target)) addEdge({ source: conflictNode, target, type: String(row.kind) === "temporal_update" ? "updates" : "contradicts", confidence: Number(row.confidence), evidencePointerId: pointer?.evidence_pointer_id, metadata: { side } });
    }
  });
  const graphNodes = db.prepare("SELECT * FROM graph_nodes ORDER BY id").all() as Array<Record<string, unknown>>;
  graphNodes.forEach((row) => {
    const type = row.node_type === "entity" ? "person" : row.node_type === "topic" ? "topic" : row.node_type === "memory_object" ? "memory" : row.node_type === "transcript" ? "transcript" : "span";
    const id = `graph:${row.id}`;
    addNode({ id, type, label: String(row.label), notePath: type === "person" || type === "topic" ? entityPath(type, String(row.label), String(row.ref_id)) : undefined, metadata: { refId: row.ref_id } });
  });
  const graphEdges = db.prepare("SELECT * FROM graph_edges ORDER BY id").all() as Array<Record<string, unknown>>;
  for (const row of graphEdges) {
    let pointerId: string | undefined;
    if (row.evidence_bundle_id) {
      const evidence = db.prepare("SELECT metadata_json FROM evidence_items WHERE bundle_id=? ORDER BY id LIMIT 1").get(row.evidence_bundle_id) as { metadata_json: string } | undefined;
      try { pointerId = evidence ? JSON.parse(evidence.metadata_json).evidence_pointer_id : undefined; } catch { pointerId = undefined; }
    }
    if (row.source_type === "source_backed" && !pointerId) { warnings.push(`Source-backed graph edge ${row.id} lacks an evidence pointer view link.`); continue; }
    addEdge({ source: `graph:${row.from_node_id}`, target: `graph:${row.to_node_id}`, type: mapEdgeType(String(row.edge_type)), evidencePointerId: pointerId, confidence: Number(row.confidence), metadata: { sourceType: row.source_type, status: row.status, generatedWithoutEvidence: row.source_type === "inferred" } });
  }
  return { graph: { nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)) }, warnings };
}
