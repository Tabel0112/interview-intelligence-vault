import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Headless: the MCP metadata + tools must not pull in the obsidian runtime package.
vi.mock("obsidian", () => { throw new Error("the headless MCP service must not import the obsidian runtime package"); });

import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi } from "../src/frontend/index.js";
import { createVaultTools } from "../src/mcp/tools.js";
import { buildInitializeResult, MCP_PROTOCOL_VERSION, MCP_SERVER_INFO, MCP_SERVER_INSTRUCTIONS } from "../src/mcp/serverMeta.js";

describe("MCP initialize result exposes server-level instructions steering to ask_vault", () => {
  it("includes a non-empty instructions string alongside protocolVersion/capabilities/serverInfo", () => {
    const result = buildInitializeResult();
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.serverInfo).toEqual(MCP_SERVER_INFO);
    expect(result.capabilities.tools.listChanged).toBe(false);
    expect(typeof result.instructions).toBe("string");
    expect(result.instructions.length).toBeGreaterThan(0);
    expect(result.instructions).toBe(MCP_SERVER_INSTRUCTIONS);
  });

  it("echoes the client's requested protocol version but always carries the instructions", () => {
    const result = buildInitializeResult("2025-06-18");
    expect(result.protocolVersion).toBe("2025-06-18"); // client-requested version echoed
    expect(result.instructions).toBe(MCP_SERVER_INSTRUCTIONS);
  });

  it("communicates the required steering intents (semantic, not exact prose)", () => {
    const text = MCP_SERVER_INSTRUCTIONS;
    expect(text).toContain("ask_vault"); // primary answer path named
    expect(text).toContain("search_evidence"); // low-level path named
    expect(text).toMatch(/inspection|debug|exploration/i); // search_evidence framed as inspection-only
    expect(text).toMatch(/do not synthesize|not synthesize a final answer/i); // no snippet-synthesis
    expect(text).toMatch(/citation/i); // preserve citations
    expect(text).toMatch(/warning/i); // preserve warnings
    expect(text).toMatch(/refus|setup|reindex/i); // surface refusals / setup state
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{16,}/); // never leaks a secret
  });

  it("does NOT weaken the per-tool descriptions — ask_vault stays primary, search_evidence stays inspection-only", () => {
    const db: SqliteDatabase = openDatabase(":memory:");
    try {
      const tools = createVaultTools({ db, api: createSqliteFrontendApi(db, {}) });
      const byName = new Map(tools.definitions.map((d) => [d.name, d.description]));
      expect(byName.get("ask_vault")).toMatch(/Primary answer tool/i);
      expect(byName.get("ask_vault")).toMatch(/do NOT synthesize your own answer from search_evidence/i);
      expect(byName.get("search_evidence")).toMatch(/INSPECTION\/DEBUG ONLY/i);
      expect(byName.get("search_evidence")).toMatch(/use ask_vault instead/i);
    } finally {
      db.close();
    }
  });
});
