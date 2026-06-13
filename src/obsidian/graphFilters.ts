import type { ObsidianGraph, ObsidianGraphEdgeType, ObsidianGraphNodeType } from "./types.js";

export function filterGraphByNodeTypes(graph: ObsidianGraph, types: ObsidianGraphNodeType[]): ObsidianGraph {
  const allowed = new Set(types), nodes = graph.nodes.filter((node) => allowed.has(node.type)), ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
}
export function filterGraphByEdgeTypes(graph: ObsidianGraph, types: ObsidianGraphEdgeType[]): ObsidianGraph {
  const allowed = new Set(types), edges = graph.edges.filter((edge) => allowed.has(edge.type)), ids = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  return { nodes: graph.nodes.filter((node) => ids.has(node.id)), edges };
}
export function filterGraphByEvidenceQuality(graph: ObsidianGraph, minQuality: number): ObsidianGraph {
  const nodes = graph.nodes.filter((node) => node.confidence == null || node.confidence >= minQuality), ids = new Set(nodes.map((node) => node.id));
  return { nodes, edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && (edge.confidence == null || edge.confidence >= minQuality)) };
}
const related = (graph: ObsidianGraph, focus: ObsidianGraphNodeType[]): ObsidianGraph => {
  const ids = new Set(graph.nodes.filter((node) => focus.includes(node.type)).map((node) => node.id));
  graph.edges.forEach((edge) => { if (ids.has(edge.source) || ids.has(edge.target)) { ids.add(edge.source); ids.add(edge.target); } });
  return { nodes: graph.nodes.filter((node) => ids.has(node.id)), edges: graph.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
};
export const buildTopicGraph = (graph: ObsidianGraph) => related(graph, ["topic"]);
export const buildPeopleGraph = (graph: ObsidianGraph) => related(graph, ["person"]);
export const buildDecisionGraph = (graph: ObsidianGraph) => related(graph, ["decision"]);
export const buildSourceEvidenceGraph = (graph: ObsidianGraph): ObsidianGraph => {
  const filtered = filterGraphByNodeTypes(graph, ["transcript", "span", "evidence", "memory", "decision", "answer", "claim"]);
  return {
    nodes: filtered.nodes,
    edges: filtered.edges.map((edge) => {
      const sourceType = filtered.nodes.find((node) => node.id === edge.source)?.type;
      const targetType = filtered.nodes.find((node) => node.id === edge.target)?.type;
      const reverse = (sourceType === "span" && targetType === "transcript")
        || (sourceType === "evidence" && targetType === "span")
        || ((sourceType === "memory" || sourceType === "decision" || sourceType === "claim" || sourceType === "answer") && targetType === "evidence");
      return reverse ? { ...edge, source: edge.target, target: edge.source, metadata: { ...edge.metadata, sourceLineageView: true } } : edge;
    }),
  };
};
