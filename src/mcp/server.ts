#!/usr/bin/env node
// Transcript Memory Vault — stdio MCP server (Phase 1).
//
// A minimal, dependency-free MCP stdio server (newline-delimited JSON-RPC 2.0) so it is fully
// self-contained and offline-testable. ALL tool logic lives in ./tools.ts (unit-tested); this file is
// only the wire/process shell, so the official @modelcontextprotocol/sdk can replace it later without
// touching tools. stdout carries ONLY JSON-RPC; all logging goes to stderr; secrets/raw provider errors
// are never written to either channel.
//
// This module is an ENTRYPOINT — it is not imported by anything (tests import ./tools.ts directly).

import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { openDatabase } from "../db/index.js";
import { createSqliteFrontendApi } from "../frontend/index.js";
import { isLlmConfigured } from "../obsidian/settings.js";
import { askAiSynthesisFromSettings } from "../obsidian/llmSettings.js";
import { loadMcpConfig, McpConfigError } from "./config.js";
import { createVaultTools, McpInputError } from "./tools.js";

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "transcript-memory-vault", version: "0.1.0" } as const;

interface JsonRpcMessage { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown }
const log = (message: string) => process.stderr.write(`[tmv-mcp] ${message}\n`);
const send = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id: JsonRpcMessage["id"], result: unknown) => send({ jsonrpc: "2.0", id, result });
const replyError = (id: JsonRpcMessage["id"], code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });

function main(): void {
  let config;
  try {
    config = loadMcpConfig(process.env);
  } catch (error) {
    log(error instanceof McpConfigError ? error.message : "Failed to load MCP configuration.");
    process.exit(1);
    return;
  }

  // Migrations are shipped next to the bundle (dist/mcp/migrations). Resolve from the launched script
  // path (process.argv[1]) — CJS-safe, unlike import.meta.url which is empty in a CJS bundle. Override
  // with TMV_MIGRATIONS_DIR. (Normally the DB is already migrated by the Obsidian plugin; this is idempotent.)
  const migrationDirectory = config.migrationDirectory ?? join(dirname(process.argv[1] ?? "."), "migrations");
  let tools: ReturnType<typeof createVaultTools>;
  try {
    const db = openDatabase(config.dbPath, { migrationDirectory });
    const api = createSqliteFrontendApi(db, {
      llmRequired: true,
      getLlmReady: () => isLlmConfigured(config.settings),
      // No transport injected -> ExternalLlmProvider uses its default Node fetch HTTP transport.
      getSynthesis: () => askAiSynthesisFromSettings(config.settings),
    });
    tools = createVaultTools({ db, api, obsidianVault: config.obsidianVault });
  } catch (error) {
    log(`Failed to open database at TMV_DB_PATH: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
    return;
  }

  log(`ready (db=${config.dbPath}, llmReady=${config.llmReady})`);

  const toolList = tools.definitions.map((d) => ({ name: d.name, description: d.description, inputSchema: d.inputSchema }));
  const rl = createInterface({ input: process.stdin, terminal: false });
  rl.on("line", (line) => { void handleLine(line); });

  async function handleLine(line: string): Promise<void> {
    const text = line.trim();
    if (!text) return;
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(text) as JsonRpcMessage;
    } catch {
      log("ignored a non-JSON line on stdin");
      return;
    }
    const { id, method, params } = message;
    const isNotification = id === undefined || id === null;
    try {
      if (method === "initialize") {
        const requested = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
        reply(id, { protocolVersion: requested ?? PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO });
      } else if (method === "notifications/initialized" || method === "notifications/cancelled") {
        // notifications: no response
      } else if (method === "ping") {
        reply(id, {});
      } else if (method === "tools/list") {
        reply(id, { tools: toolList });
      } else if (method === "tools/call") {
        const callParams = (params ?? {}) as { name?: string; arguments?: unknown };
        if (typeof callParams.name !== "string") { if (!isNotification) replyError(id, -32602, "tools/call requires a tool name"); return; }
        try {
          const result = await tools.call(callParams.name, callParams.arguments);
          if (!isNotification) reply(id, { content: [{ type: "text", text: JSON.stringify(result) }], isError: false });
        } catch (error) {
          // Tool-level errors are returned as an isError tool result with a SAFE message (never raw
          // provider errors / secrets). The real error is logged to stderr only.
          const safe = error instanceof McpInputError ? error.message : "Tool execution failed.";
          if (!(error instanceof McpInputError)) log(`tool "${callParams.name}" failed: ${error instanceof Error ? error.name : "error"}`);
          if (!isNotification) reply(id, { content: [{ type: "text", text: safe }], isError: true });
        }
      } else if (!isNotification) {
        replyError(id, -32601, `Method not found: ${method ?? "(none)"}`);
      }
    } catch (error) {
      log(`internal error handling "${method ?? "(none)"}": ${error instanceof Error ? error.name : "error"}`);
      if (!isNotification) replyError(id, -32603, "Internal server error.");
    }
  }
}

main();
