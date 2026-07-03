import { matchRoute } from "./router.js";

export interface ObsidianNavigation {
  openDashboard(): Promise<void>;
  openUpload(): Promise<void>;
  openTranscripts(): Promise<void>;
  openTranscript(transcriptId: string, options?: { spanId?: string }): Promise<void>;
  openAskAI(options?: { transcriptIds?: string[] }): Promise<void>;
  openAnswer(answerId: string): Promise<void>;
  /** Open the read-only Ask AI trace for a run/answer id. */
  openAnswerTrace(runIdOrAnswerId: string): Promise<void>;
  openEvidence(evidencePointerId: string): Promise<void>;
  openMemoryObject(memoryObjectId: string): Promise<void>;
  openGraph(options?: { selectedNodeId?: string; selectedEdgeId?: string; query?: string }): Promise<void>;
  openSearch(query?: string): Promise<void>;
  openReviewQueue(options?: { reviewItemId?: string }): Promise<void>;
}

export async function navigateInternal(navigation: ObsidianNavigation, target: string): Promise<void> {
  const route = matchRoute(target);
  switch (route.id) {
    case "dashboard": return navigation.openDashboard();
    case "upload": return navigation.openUpload();
    case "transcripts": return navigation.openTranscripts();
    case "transcript": return navigation.openTranscript(route.params.id, { spanId: route.query.get("span") ?? undefined });
    case "ask": return navigation.openAskAI();
    case "answer": return navigation.openAnswer(route.params.id);
    case "answer_trace": return navigation.openAnswerTrace(route.params.id);
    case "evidence": return navigation.openEvidence(route.params.id);
    case "memory": return navigation.openMemoryObject(route.params.id);
    case "graph": return navigation.openGraph({
      selectedNodeId: route.query.get("selectedNode") ?? undefined,
      selectedEdgeId: route.query.get("selectedEdge") ?? undefined,
      query: route.query.get("q") ?? undefined,
    });
    case "search": return navigation.openSearch(route.query.get("q") ?? undefined);
    case "review_detail": return navigation.openReviewQueue({ reviewItemId: route.params.id });
    case "review": return navigation.openReviewQueue();
    default: throw new Error(`Unsupported internal navigation target: ${target}`);
  }
}
