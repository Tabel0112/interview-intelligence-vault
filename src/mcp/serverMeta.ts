// MCP server metadata + the InitializeResult builder.
//
// Extracted from server.ts (the process entrypoint, which runs main() on import and so can't be unit
// tested) so the initialize response — including the server-level `instructions` hint — is importable and
// testable. server.ts is a thin wire shell that reuses these.
//
// `instructions` is a spec-supported optional field of the MCP InitializeResult (protocol 2024-11-05+):
// a model-facing hint the client MAY add to its system prompt. We use it as a GLOBAL steering layer on
// top of the per-tool descriptions (which are unchanged): user-facing questions should go through
// `ask_vault` (the validated, citation-grounded answer path), and `search_evidence` stays inspection-only.
// This changes only metadata/steering — no tool behavior, no synthesis, no retrieval, no network.

export const MCP_PROTOCOL_VERSION = "2024-11-05";
export const MCP_SERVER_INFO = { name: "transcript-memory-vault", version: "0.1.0" } as const;

/**
 * Server-level instructions surfaced in the MCP initialize response. Concise and stable (tests assert the
 * key intents, not the exact prose). Reinforces the per-tool descriptions without changing tool behavior.
 */
export const MCP_SERVER_INSTRUCTIONS = [
  "Use `ask_vault` for user-facing questions about this vault. It runs the vault's evidence-first pipeline (retrieve → score → grounded synthesis → citation validation) and returns a validated, citation-grounded answer with any trust warnings.",
  "Do NOT synthesize a final answer from `search_evidence` results. `search_evidence` is for inspection, debugging, and exploration only — it returns raw scored evidence cards, not an answer.",
  "Preserve the citations and warnings that `ask_vault` returns; present them to the user and do not drop or override them.",
  "If `ask_vault` refuses because there is not enough evidence, or reports a setup/reindex requirement, surface that refusal or setup state to the user — do not invent an answer from raw snippets.",
].join(" ");

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: { tools: { listChanged: boolean } };
  serverInfo: { name: string; version: string };
  instructions: string;
}

/** Build the MCP initialize result, echoing the client's requested protocol version when provided. */
export function buildInitializeResult(requestedProtocolVersion?: string): McpInitializeResult {
  return {
    protocolVersion: requestedProtocolVersion ?? MCP_PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { ...MCP_SERVER_INFO },
    instructions: MCP_SERVER_INSTRUCTIONS,
  };
}
