import { contentHash } from "../db/ids.js";
import { makeGeneratedFile } from "./markdown.js";
import type { GeneratedFile, ObsidianGraph, ObsidianViewManifest } from "./types.js";

export function buildManifest(files: GeneratedFile[], graph: ObsidianGraph, warnings: string[]): { manifest: ObsidianViewManifest; file: GeneratedFile } {
  const stableFiles = files.map(({ content: _content, ...file }) => file).sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = contentHash(stableFiles.map((file) => `${file.relativePath}:${file.contentHash}`).join("\n"));
  const manifest: ObsidianViewManifest = {
    version: 1, generatedFrom: "sqlite", contentHash: hash, files: stableFiles,
    entityPaths: Object.fromEntries(stableFiles.filter((file) => file.entityType && file.entityId).map((file) => [`${file.entityType}:${file.entityId}`, file.relativePath])),
    graphStats: { nodes: graph.nodes.length, edges: graph.edges.length }, warnings: [...warnings].sort(),
    brokenPointerCount: warnings.filter((warning) => warning.startsWith("Broken evidence pointer")).length,
  };
  return { manifest, file: makeGeneratedFile("system_manifest", "_system/view-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`) };
}
