import { generatedWarning, makeGeneratedFile } from "./markdown.js";
import type { GeneratedFile, ObsidianGraph } from "./types.js";

export function graphJson(graph: ObsidianGraph, includedNodeTypes: string[] = [], includedEdgeTypes: string[] = []): string {
  return `${JSON.stringify({ version: 1, generatedFrom: "sqlite", nodes: graph.nodes, edges: graph.edges, filters: { includedNodeTypes, includedEdgeTypes } }, null, 2)}\n`;
}
export function graphMarkdown(title: string, graph: ObsidianGraph, jsonPath: string, brokenPointerCount: number): string {
  const important = graph.nodes.filter((node) => node.notePath).slice(0, 20).map((node) => `- [[${node.notePath!.replace(/\.md$/, "")}|${node.label}]]`).join("\n") || "_No linked nodes._";
  return `# ${title}

${generatedWarning}

This graph is a generated SQLite-backed view.

- Nodes: ${graph.nodes.length}
- Edges: ${graph.edges.length}
- Broken evidence pointers: ${brokenPointerCount}
- JSON: [[${jsonPath.replace(/\.json$/, "")}]]

## Important Nodes

${important}`;
}
export const makeGraphJsonFile = (path: string, graph: ObsidianGraph): GeneratedFile => makeGeneratedFile("graph_json", path, graphJson(graph));
export const makeGraphMarkdownFile = (title: string, path: string, jsonPath: string, graph: ObsidianGraph, broken: number): GeneratedFile => makeGeneratedFile("graph_markdown", path, graphMarkdown(title, graph, jsonPath, broken));
