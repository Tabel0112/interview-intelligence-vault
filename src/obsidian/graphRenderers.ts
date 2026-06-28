import { generatedWarning, makeGeneratedFile } from "./markdown.js";
import type { GeneratedFile, ObsidianGraph } from "./types.js";

export function graphJson(graph: ObsidianGraph, includedNodeTypes: string[] = [], includedEdgeTypes: string[] = []): string {
  return `${JSON.stringify({ version: 1, generatedFrom: "sqlite", nodes: graph.nodes, edges: graph.edges, filters: { includedNodeTypes, includedEdgeTypes } }, null, 2)}\n`;
}
export function graphMarkdown(title: string, graph: ObsidianGraph, jsonPath: string, brokenPointerCount: number): string {
  // Plain-text node names (NOT [[wikilinks]]) so this index note never becomes a native-graph hub linking
  // to every content note. Tagged #tmv/system. Use Obsidian's own graph + the tag filters for the real view.
  const important = graph.nodes.filter((node) => node.notePath).slice(0, 20).map((node) => `- ${node.label}`).join("\n") || "_No nodes yet._";
  return `---
tags: [tmv/system]
---
# ${title}

#tmv/system

${generatedWarning}

This is a generated SQLite-backed summary. For the actual graph, use Obsidian's native graph with a tag
filter (see \`_system/graph-guide.md\`); this note intentionally does not link to content notes.

- Nodes: ${graph.nodes.length}
- Edges: ${graph.edges.length}
- Broken evidence pointers: ${brokenPointerCount}
- JSON data: ${jsonPath} (plain path, not a link)

## Nodes (names only)

${important}`;
}
export const makeGraphJsonFile = (path: string, graph: ObsidianGraph): GeneratedFile => makeGeneratedFile("graph_json", path, graphJson(graph));
export const makeGraphMarkdownFile = (title: string, path: string, jsonPath: string, graph: ObsidianGraph, broken: number): GeneratedFile => makeGeneratedFile("graph_markdown", path, graphMarkdown(title, graph, jsonPath, broken));
