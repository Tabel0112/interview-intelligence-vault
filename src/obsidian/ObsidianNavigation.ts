import type { App, WorkspaceLeaf } from "obsidian";
import type { ObsidianNavigation } from "../frontend/index.js";
import { OBSIDIAN_VIEW_TYPES, type TranscriptMemoryViewState, type TranscriptMemoryViewType } from "./pluginTypes.js";

export interface ObsidianWorkspaceLike {
  getLeaf(newLeaf?: boolean | "tab" | "split" | "window"): WorkspaceLeaf;
  revealLeaf(leaf: WorkspaceLeaf): void;
}

export function createObsidianNavigation(app: Pick<App, "workspace">): ObsidianNavigation {
  const open = async (type: TranscriptMemoryViewType, target: string) => {
    const leaf = app.workspace.getLeaf("tab");
    await leaf.setViewState({ type, active: true, state: { target } satisfies TranscriptMemoryViewState });
    app.workspace.revealLeaf(leaf);
  };
  return {
    openDashboard: () => open(OBSIDIAN_VIEW_TYPES.dashboard, "mv://dashboard"),
    openUpload: () => open(OBSIDIAN_VIEW_TYPES.upload, "mv://upload"),
    openTranscripts: () => open(OBSIDIAN_VIEW_TYPES.transcripts, "mv://transcripts"),
    openTranscript: (id, options) => open(OBSIDIAN_VIEW_TYPES.transcript, `mv://transcripts/${encodeURIComponent(id)}${options?.spanId ? `?span=${encodeURIComponent(options.spanId)}` : ""}`),
    openAskAI: (options) => open(OBSIDIAN_VIEW_TYPES.ask, `mv://ask${options?.transcriptIds?.length ? `?transcriptIds=${options.transcriptIds.map(encodeURIComponent).join(",")}` : ""}`),
    openAnswer: (id) => open(OBSIDIAN_VIEW_TYPES.answer, `mv://answers/${encodeURIComponent(id)}`),
    openEvidence: (id) => open(OBSIDIAN_VIEW_TYPES.evidence, `mv://evidence/${encodeURIComponent(id)}`),
    openMemoryObject: (id) => open(OBSIDIAN_VIEW_TYPES.memory, `mv://memory/${encodeURIComponent(id)}`),
    openGraph: (options) => {
      const params = new URLSearchParams();
      if (options?.selectedNodeId) params.set("selectedNode", options.selectedNodeId);
      if (options?.selectedEdgeId) params.set("selectedEdge", options.selectedEdgeId);
      if (options?.query) params.set("q", options.query);
      return open(OBSIDIAN_VIEW_TYPES.graph, `mv://graph${params.size ? `?${params}` : ""}`);
    },
    openSearch: (query) => open(OBSIDIAN_VIEW_TYPES.search, `mv://search${query ? `?q=${encodeURIComponent(query)}` : ""}`),
    openReviewQueue: (options) => open(OBSIDIAN_VIEW_TYPES.review, options?.reviewItemId ? `mv://review/${encodeURIComponent(options.reviewItemId)}` : "mv://review"),
  };
}
