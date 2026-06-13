import type { SqliteDatabase } from "../connection.js";
import { EvidenceRequiredError, NotFoundError, ValidationError } from "../errors.js";
import { createId } from "../ids.js";
import type { GraphEdge, GraphEdgeSourceType, GraphEdgeStatus, GraphEdgeType, GraphNode, GraphNodeType, JsonObject } from "../schema.js";
import { assertScore, json, now, parseRow, parseRows, requireRow } from "../utils.js";

export interface CreateGraphNodeInput { id?: string; node_type: GraphNodeType; ref_id: string; label: string; metadata?: JsonObject; }
export interface CreateGraphEdgeInput { id?: string; from_node_id: string; to_node_id: string; edge_type: GraphEdgeType; source_type: GraphEdgeSourceType; confidence: number; evidence_bundle_id?: string | null; created_run_id?: string | null; status?: GraphEdgeStatus; metadata?: JsonObject; }

export function createGraphRepo(db: SqliteDatabase, options: { now?: () => Date } = {}) {
  const timestamp = () => options.now?.().toISOString() ?? now();
  const createGraphNode = (input: CreateGraphNodeInput): GraphNode => {
    const createdAt = timestamp(), row = { id: input.id ?? createId("node_"), node_type: input.node_type, ref_id: input.ref_id, label: input.label, created_at: createdAt, updated_at: createdAt, metadata_json: json(input.metadata) };
    db.prepare("INSERT INTO graph_nodes(id,node_type,ref_id,label,created_at,updated_at,metadata_json) VALUES (@id,@node_type,@ref_id,@label,@created_at,@updated_at,@metadata_json)").run(row);
    return parseRow<GraphNode>(db.prepare("SELECT * FROM graph_nodes WHERE id = ?").get(row.id));
  };
  const getGraphEdge = (id: string) => parseRow<GraphEdge | null>(db.prepare("SELECT * FROM graph_edges WHERE id = ?").get(id));
  return {
    createGraphNode,
    getOrCreateGraphNode(input: CreateGraphNodeInput): GraphNode {
      return parseRow<GraphNode | null>(db.prepare("SELECT * FROM graph_nodes WHERE node_type = ? AND ref_id = ?").get(input.node_type, input.ref_id)) ?? createGraphNode(input);
    },
    createGraphEdge(input: CreateGraphEdgeInput): GraphEdge {
      assertScore(input.confidence, "confidence");
      if (input.source_type === "source_backed" && !input.evidence_bundle_id) throw new EvidenceRequiredError("Source-backed graph edges require an evidence bundle");
      if (input.source_type !== "inferred" && !input.evidence_bundle_id) throw new EvidenceRequiredError("Only inferred graph edges may omit evidence");
      if (!input.evidence_bundle_id && input.source_type !== "inferred") throw new ValidationError("Evidence-free graph edges must be inferred");
      if (input.source_type === "source_backed") {
        const count = (db.prepare("SELECT COUNT(*) count FROM evidence_items WHERE bundle_id = ?").get(input.evidence_bundle_id) as { count: number }).count;
        if (!count) throw new EvidenceRequiredError("Source-backed graph edge evidence bundle must contain evidence items");
      }
      requireRow(db, "graph_nodes", input.from_node_id); requireRow(db, "graph_nodes", input.to_node_id);
      const createdAt = timestamp(), row = { id: input.id ?? createId("edge_"), from_node_id: input.from_node_id, to_node_id: input.to_node_id, edge_type: input.edge_type, source_type: input.source_type, confidence: input.confidence, evidence_bundle_id: input.evidence_bundle_id ?? null, created_run_id: input.created_run_id ?? null, status: input.status ?? "active", created_at: createdAt, updated_at: createdAt, metadata_json: json(input.metadata) };
      db.prepare(`INSERT INTO graph_edges(id,from_node_id,to_node_id,edge_type,source_type,confidence,evidence_bundle_id,created_run_id,status,created_at,updated_at,metadata_json)
        VALUES (@id,@from_node_id,@to_node_id,@edge_type,@source_type,@confidence,@evidence_bundle_id,@created_run_id,@status,@created_at,@updated_at,@metadata_json)`).run(row);
      return getGraphEdge(row.id)!;
    },
    getGraphEdge,
    listEdgesForNode(nodeId: string): GraphEdge[] { return parseRows<GraphEdge>(db.prepare("SELECT * FROM graph_edges WHERE from_node_id = ? OR to_node_id = ? ORDER BY created_at").all(nodeId, nodeId)); },
    listContradictionsForNode(nodeId: string): GraphEdge[] { return parseRows<GraphEdge>(db.prepare("SELECT * FROM graph_edges WHERE edge_type = 'contradicts' AND (from_node_id = ? OR to_node_id = ?) ORDER BY created_at").all(nodeId, nodeId)); },
    updateGraphEdgeStatus(id: string, status: GraphEdgeStatus): void {
      const result = db.prepare("UPDATE graph_edges SET status = ?, updated_at = ? WHERE id = ?").run(status, timestamp(), id);
      if (!result.changes) throw new NotFoundError(`Graph edge not found: ${id}`);
    },
  };
}
