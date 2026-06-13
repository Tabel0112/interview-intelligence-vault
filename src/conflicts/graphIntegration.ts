import type { SqliteDatabase } from "../db/connection.js";
import { ValidationError } from "../db/errors.js";
import { createEvidenceRepo } from "../db/repositories/evidenceRepo.js";
import { createGraphRepo } from "../db/repositories/graphRepo.js";
import type { GraphEdge, GraphEdgeType, GraphNode } from "../db/schema.js";
import { resolveEvidencePointer } from "../provenance/index.js";
import type { ConflictAssessment, ConflictLogicalEdgeType } from "./types.js";

const logicalType = (kind: ConflictAssessment["kind"]): ConflictLogicalEdgeType =>
  kind === "direct_contradiction" ? "contradicts"
    : kind === "temporal_update" ? "updates"
      : kind === "conditional_difference" ? "conditionally_differs_from" : "tensions_with";
const physicalType = (logical: ConflictLogicalEdgeType): GraphEdgeType =>
  logical === "tensions_with" ? "related_to" : logical === "conditionally_differs_from" ? "qualifies" : logical;

function nodeFor(db: SqliteDatabase, conflict: ConflictAssessment, side: "left" | "right", options: { now?: () => Date }): GraphNode {
  const type = side === "left" ? conflict.leftTargetType : conflict.rightTargetType;
  const id = side === "left" ? conflict.leftTargetId : conflict.rightTargetId;
  if (type === "graph_node") {
    const node = db.prepare("SELECT * FROM graph_nodes WHERE id=?").get(id) as GraphNode | undefined;
    if (!node) throw new ValidationError(`Conflict graph node not found: ${id}`);
    return node;
  }
  if (type !== "memory_object" && type !== "claim" && type !== "summary") {
    throw new ValidationError(`Conflict target cannot be represented as a graph node: ${type}`);
  }
  const memory = db.prepare("SELECT title,generated_text FROM memory_objects WHERE id=?").get(id) as { title: string | null; generated_text: string } | undefined;
  if (!memory) throw new ValidationError(`Conflict memory object not found: ${id}`);
  return createGraphRepo(db, options).getOrCreateGraphNode({ node_type: "memory_object", ref_id: id, label: memory.title ?? memory.generated_text.slice(0, 120) });
}

export function createConflictGraphEdge(db: SqliteDatabase, conflict: ConflictAssessment, options: { now?: () => Date } = {}): GraphEdge {
  if (conflict.status !== "active" || conflict.kind === "weak_or_ambiguous") throw new ValidationError("Only active source-backed conflicts can become graph edges");
  const existing = db.prepare(`SELECT e.* FROM conflict_graph_edges c JOIN graph_edges e ON e.id=c.graph_edge_id
    WHERE c.conflict_assessment_id=?`).get(conflict.id) as GraphEdge | undefined;
  if (existing) return existing;
  return db.transaction(() => {
    const valid = conflict.evidence.map((link) => ({ link, resolution: resolveEvidencePointer(db, link.evidencePointerId) }))
      .filter((item): item is typeof item & { resolution: Extract<typeof item.resolution, { ok: true }> } => item.link.provenanceValidated && item.resolution.ok);
    if (!valid.some((item) => item.link.side === "left") || !valid.some((item) => item.link.side === "right")) {
      throw new ValidationError("Conflict graph edges require validated evidence for both sides");
    }
    const left = nodeFor(db, conflict, "left", options), right = nodeFor(db, conflict, "right", options);
    const logical = logicalType(conflict.kind);
    const from = logical === "updates" && conflict.newerTargetId === conflict.rightTargetId ? right : left;
    const to = from.id === left.id ? right : left;
    const evidence = createEvidenceRepo(db, options);
    const bundle = evidence.createEvidenceBundle({
      purpose: "graph_edge", status: logical === "contradicts" ? "conflicting" : "mixed",
      overall_score: conflict.confidence, metadata: { conflict_assessment_id: conflict.id, logical_edge_type: logical },
    });
    valid.forEach(({ link, resolution }, index) => evidence.addEvidenceItem(bundle.id, {
      span_id: resolution.evidence.span_id, retrieval_rank: index + 1, final_score: resolution.evidence.final_score ?? resolution.evidence.confidence,
      stance: link.side === "left" ? "supports" : logical === "contradicts" ? "contradicts" : "qualifies",
      reason: conflict.explanation, metadata: { evidence_pointer_id: link.evidencePointerId, conflict_side: link.side },
    }));
    const edge = createGraphRepo(db, options).createGraphEdge({
      from_node_id: from.id, to_node_id: to.id, edge_type: physicalType(logical), source_type: "source_backed",
      confidence: conflict.confidence, evidence_bundle_id: bundle.id,
      metadata: { conflict_assessment_id: conflict.id, logical_edge_type: logical },
    });
    db.prepare("INSERT INTO conflict_graph_edges(conflict_assessment_id,graph_edge_id,logical_edge_type,created_at) VALUES (?,?,?,?)")
      .run(conflict.id, edge.id, logical, options.now?.().toISOString() ?? new Date().toISOString());
    return edge;
  })();
}
