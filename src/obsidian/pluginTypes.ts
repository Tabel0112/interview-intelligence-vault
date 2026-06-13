export const OBSIDIAN_VIEW_TYPES = {
  dashboard: "transcript-memory-dashboard",
  upload: "transcript-memory-upload",
  transcript: "transcript-memory-transcript",
  ask: "transcript-memory-ask",
  answer: "transcript-memory-answer",
  evidence: "transcript-memory-evidence",
  memory: "transcript-memory-memory-object",
  graph: "transcript-memory-graph",
  search: "transcript-memory-search",
  review: "transcript-memory-review",
} as const;

export type TranscriptMemoryViewType = typeof OBSIDIAN_VIEW_TYPES[keyof typeof OBSIDIAN_VIEW_TYPES];

export interface TranscriptMemoryViewState extends Record<string, unknown> {
  target?: string;
}

export const OBSIDIAN_COMMANDS = [
  { id: "open-dashboard", name: "Open Transcript Memory Dashboard", viewType: OBSIDIAN_VIEW_TYPES.dashboard },
  { id: "upload-transcript", name: "Upload Transcript", viewType: OBSIDIAN_VIEW_TYPES.upload },
  { id: "ask-ai", name: "Ask AI About Transcripts", viewType: OBSIDIAN_VIEW_TYPES.ask },
  { id: "search-vault", name: "Search Transcript Memory Vault", viewType: OBSIDIAN_VIEW_TYPES.search },
  { id: "open-graph", name: "Open Memory Graph", viewType: OBSIDIAN_VIEW_TYPES.graph },
  { id: "open-review", name: "Open Review Queue", viewType: OBSIDIAN_VIEW_TYPES.review },
] as const;

export const OBSIDIAN_RIBBON = { icon: "database", title: "Open Transcript Memory Dashboard" } as const;

export const viewTitle = (type: TranscriptMemoryViewType): string => ({
  [OBSIDIAN_VIEW_TYPES.dashboard]: "Transcript Memory Dashboard",
  [OBSIDIAN_VIEW_TYPES.upload]: "Upload Transcript",
  [OBSIDIAN_VIEW_TYPES.transcript]: "Transcript Source",
  [OBSIDIAN_VIEW_TYPES.ask]: "Ask AI",
  [OBSIDIAN_VIEW_TYPES.answer]: "AI Answer",
  [OBSIDIAN_VIEW_TYPES.evidence]: "Evidence",
  [OBSIDIAN_VIEW_TYPES.memory]: "Memory Object",
  [OBSIDIAN_VIEW_TYPES.graph]: "Memory Graph",
  [OBSIDIAN_VIEW_TYPES.search]: "Search Transcript Memory",
  [OBSIDIAN_VIEW_TYPES.review]: "Review Queue",
})[type];

export const defaultTarget = (type: TranscriptMemoryViewType): string => ({
  [OBSIDIAN_VIEW_TYPES.dashboard]: "mv://dashboard",
  [OBSIDIAN_VIEW_TYPES.upload]: "mv://upload",
  [OBSIDIAN_VIEW_TYPES.transcript]: "mv://transcripts/missing",
  [OBSIDIAN_VIEW_TYPES.ask]: "mv://ask",
  [OBSIDIAN_VIEW_TYPES.answer]: "mv://answers/missing",
  [OBSIDIAN_VIEW_TYPES.evidence]: "mv://evidence/missing",
  [OBSIDIAN_VIEW_TYPES.memory]: "mv://memory/missing",
  [OBSIDIAN_VIEW_TYPES.graph]: "mv://graph",
  [OBSIDIAN_VIEW_TYPES.search]: "mv://search",
  [OBSIDIAN_VIEW_TYPES.review]: "mv://review",
})[type];
