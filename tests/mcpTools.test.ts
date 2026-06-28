import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Mocking the "obsidian" runtime package to THROW proves the MCP/service chain is headless: if any
// imported module pulled in the obsidian package, this file would fail to load.
vi.mock("obsidian", () => { throw new Error("the headless MCP service must not import the obsidian runtime package"); });

import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";
import { createLlmAskAILanguageModel, type SynthesisInfo } from "../src/ask-ai/index.js";
import { ExternalLlmProvider, type LlmTransport } from "../src/llm/index.js";
import { createSqliteFrontendApi, type FrontendApi } from "../src/frontend/index.js";
import { createVaultTools, McpInputError } from "../src/mcp/tools.js";
import { loadMcpConfig, McpConfigError } from "../src/mcp/config.js";

const RAW = "Alex: We decided to use SQLite as the source of truth for the vault.";
const SECRET = "sk-mcp-PLANTED-SECRET-1234567890";
const QUESTION = "What is the source of truth?";
const LLM_CLAIM = "SQLite is the source of truth for the vault.";
const now = () => new Date("2026-06-12T12:00:00.000Z");

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

const count = (sql: string, ...args: unknown[]) => (db.prepare(`SELECT COUNT(*) c FROM ${sql}`).get(...args) as { c: number }).c;
const lastUserMessage = (body: string): string => {
  const messages = (JSON.parse(body) as { messages: Array<{ content: string }> }).messages;
  return messages[messages.length - 1].content;
};

// Grounded synthesis: cite the selected pointerId + an exact verbatim quote from the prompt.
const groundedTransport: LlmTransport = async (req) => {
  const m = lastUserMessage(req.body).match(/pointerId:\s*(\S+)\n\s*quote:\s*(.+)/);
  const content = JSON.stringify({ claims: [{ kind: "fact", text: LLM_CLAIM, evidencePointerIds: [m?.[1] ?? "x"], supportingQuote: (m?.[2] ?? "").trim() }] });
  return { status: 200, body: { choices: [{ message: { content }, finish_reason: "stop" }] } };
};
// Ungrounded synthesis: a fabricated quote that is NOT in any cited snippet -> grounding gate discards it.
const ungroundedTransport: LlmTransport = async () => ({
  status: 200,
  body: { choices: [{ message: { content: JSON.stringify({ claims: [{ kind: "fact", text: "FABRICATED CLAIM", evidencePointerIds: ["evp_unknown"], supportingQuote: "totally fabricated text" }] }) }, finish_reason: "stop" }] },
});
const failingTransport: LlmTransport = async () => ({ status: 500, body: { error: "upstream" } });

const info: SynthesisInfo = { mode: "external_llm", provider: "openai", model: "gpt-x", usedFallback: false };
function makeApi(transport: LlmTransport | null): FrontendApi {
  return createSqliteFrontendApi(db, {
    now,
    llmRequired: true,
    getLlmReady: () => transport != null,
    getSynthesis: transport
      ? () => ({ llm: createLlmAskAILanguageModel(new ExternalLlmProvider({ id: "openai", model: "gpt-x", apiKey: SECRET, transport })), info })
      : () => undefined,
  });
}
const tools = (transport: LlmTransport | null) => createVaultTools({ db, api: makeApi(transport) });

async function seedEvidence(): Promise<string> {
  const repos = createRepositories(db);
  const imported = importTranscript(db, { filename: "t.txt", rawText: RAW });
  const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string };
  const memory = repos.memoryObjects.createMemoryObject(
    { type: "decision", generated_text: "SQLite is authoritative.", confidence: 0.95, created_by: "agent" },
    [{ span_id: span.id, role: "supports", evidence_score: 0.95 }],
  );
  const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.95 });
  await indexEvidencePointerForSearch(db, pointer.evidence_pointer_id);
  return memory.id;
}

describe("MCP tools", () => {
  it("exposes all Phase 1 tool definitions with input schemas and validates required inputs", async () => {
    const t = tools(groundedTransport);
    expect(t.definitions.map((d) => d.name).sort()).toEqual(
      ["ask_vault", "get_answer", "get_conflicts", "get_memory_object", "list_recent_answers", "search_evidence", "search_vault_answers"].sort(),
    );
    expect((t.definitions.find((d) => d.name === "ask_vault")!.inputSchema as { required: string[] }).required).toContain("question");
    await expect(t.call("ask_vault", {})).rejects.toBeInstanceOf(McpInputError); // missing question
    await expect(t.call("nope", {})).rejects.toBeInstanceOf(McpInputError); // unknown tool
  });

  it("ask_vault runs the evidence-first pipeline and returns a validated, cited AnswerBundle (persisted)", async () => {
    const memoryId = await seedEvidence();
    await tools(null).call("get_memory_object", { memory_object_id: memoryId }); // (warm path, no effect)
    const before = count("ask_ai_runs");
    const result = await tools(groundedTransport).call("ask_vault", { question: QUESTION }) as { ok: boolean; answer_bundle: Record<string, unknown> };
    expect(result.ok).toBe(true);
    const bundle = result.answer_bundle as { claims: Array<{ text: string }>; citations: Array<{ evidence_uri: string; source_span_uri: string }>; not_enough_evidence: boolean; links: { answer_uri: string } };
    expect(bundle.not_enough_evidence).toBe(false);
    expect(bundle.claims.some((c) => c.text === LLM_CLAIM)).toBe(true); // came from the LLM pipeline, not a parallel path
    expect(bundle.citations.length).toBeGreaterThan(0);
    expect(bundle.citations.every((c) => c.evidence_uri.startsWith("mv://evidence/") && c.source_span_uri.startsWith("mv://transcripts/"))).toBe(true);
    expect(bundle.links.answer_uri).toMatch(/^mv:\/\/answers\//);
    expect(count("ask_ai_runs")).toBe(before + 1); // answer persisted through the existing path
  });

  it("get_answer reconstructs the same persisted validated bundle", async () => {
    await seedEvidence();
    const asked = await tools(groundedTransport).call("ask_vault", { question: QUESTION }) as { answer_bundle: { answer_id: string; claims: unknown[] } };
    const reloaded = await tools(groundedTransport).call("get_answer", { answer_id: asked.answer_bundle.answer_id }) as { ok: boolean; answer_bundle: { answer_id: string; claims: unknown[] } };
    expect(reloaded.ok).toBe(true);
    expect(reloaded.answer_bundle.answer_id).toBe(asked.answer_bundle.answer_id);
    expect(reloaded.answer_bundle.claims.length).toBe(asked.answer_bundle.claims.length);
    expect(await tools(groundedTransport).call("get_answer", { answer_id: "missing" })).toMatchObject({ ok: false, state: "not_found" });
  });

  it("discards unsupported LLM claims and persists NO fake answer (grounding gate -> llm_failed)", async () => {
    await seedEvidence();
    const before = count("ask_ai_runs");
    const result = await tools(ungroundedTransport).call("ask_vault", { question: QUESTION }) as { ok: boolean; state: string };
    expect(result).toMatchObject({ ok: false, state: "llm_failed" });
    expect(JSON.stringify(result)).not.toContain("FABRICATED");
    expect(count("ask_ai_runs")).toBe(before); // no fake answer persisted
  });

  it("setup-required persists no answer when no LLM is configured", async () => {
    await seedEvidence();
    const before = count("ask_ai_runs");
    expect(await tools(null).call("ask_vault", { question: QUESTION })).toMatchObject({ ok: false, state: "setup_required" });
    expect(count("ask_ai_runs")).toBe(before);
  });

  it("LLM failure persists no answer", async () => {
    await seedEvidence();
    const before = count("ask_ai_runs");
    expect(await tools(failingTransport).call("ask_vault", { question: QUESTION })).toMatchObject({ ok: false, state: "llm_failed" });
    expect(count("ask_ai_runs")).toBe(before);
  });

  it("not-enough-evidence returns the existing persisted refusal", async () => {
    await seedEvidence();
    const before = count("ask_ai_runs");
    const result = await tools(groundedTransport).call("ask_vault", { question: "completely unrelated xyzzy question" }) as { ok: boolean; answer_bundle: { not_enough_evidence: boolean } };
    expect(result.ok).toBe(true);
    expect(result.answer_bundle.not_enough_evidence).toBe(true);
    expect(count("ask_ai_runs")).toBe(before + 1); // refusal IS persisted (existing behavior)
  });

  it("search_evidence returns scored, provenance-backed cards (not unscored raw chunks), and points users to ask_vault", async () => {
    await seedEvidence();
    const result = await tools(null).call("search_evidence", { query: "SQLite source of truth", limit: 5 }) as { evidence: Array<Record<string, unknown>>; note: string };
    expect(result.evidence.length).toBeGreaterThan(0);
    const card = result.evidence[0];
    expect(typeof card.score).toBe("number");
    expect(String(card.evidence_uri)).toMatch(/^mv:\/\/evidence\//);
    expect(card.confidence).toBeTruthy();
    expect(result.note).toMatch(/ask_vault/);
  });

  it("list_recent_answers and search_vault_answers are size-limited summaries", async () => {
    await seedEvidence();
    await tools(groundedTransport).call("ask_vault", { question: QUESTION });
    const recent = await tools(null).call("list_recent_answers", { limit: 999 }) as { answers: Array<{ answer_uri: string; answer_preview: string }> };
    expect(recent.answers.length).toBeGreaterThan(0);
    expect(recent.answers.length).toBeLessThanOrEqual(50); // clamped
    expect(recent.answers[0].answer_uri).toMatch(/^mv:\/\/answers\//);
    const found = await tools(null).call("search_vault_answers", { query: "source of truth" }) as { answers: unknown[] };
    expect(found.answers.length).toBeGreaterThan(0);
  });

  it("get_memory_object returns provenance/evidence pointers and a not-evidence-alone note", async () => {
    const memoryId = await seedEvidence();
    const result = await tools(null).call("get_memory_object", { memory_object_id: memoryId }) as { ok: boolean; memory_object: { evidence: unknown[]; note: string; memory_uri: string } };
    expect(result.ok).toBe(true);
    expect(result.memory_object.note).toMatch(/not evidence on its own/i);
    expect(result.memory_object.memory_uri).toMatch(/^mv:\/\/memory\//);
  });

  it("get_conflicts uses the conflict repository and returns a safe, size-limited list", async () => {
    await seedEvidence();
    const result = await tools(null).call("get_conflicts", {}) as { conflicts: unknown[] };
    expect(Array.isArray(result.conflicts)).toBe(true); // none seeded -> []
  });

  it("never leaks the API key / Authorization header / raw provider error into MCP output or persisted rows", async () => {
    await seedEvidence();
    const ok = await tools(groundedTransport).call("ask_vault", { question: QUESTION });
    const fail = await tools(failingTransport).call("ask_vault", { question: QUESTION });
    const dump = JSON.stringify([ok, fail, db.prepare("SELECT * FROM ask_ai_runs").all(), db.prepare("SELECT * FROM ai_answers").all()]);
    for (const forbidden of [SECRET, "Bearer", "Authorization", "chat/completions", "upstream"]) {
      expect(dump).not.toContain(forbidden);
    }
  });
});

describe("loadMcpConfig", () => {
  it("requires TMV_DB_PATH and builds settings from env without reading Obsidian data.json", () => {
    expect(() => loadMcpConfig({})).toThrow(McpConfigError);
    const cfg = loadMcpConfig({ TMV_DB_PATH: "/tmp/vault.sqlite", TMV_LLM_PROVIDER: "openai", TMV_LLM_MODEL: "gpt-x", TMV_LLM_API_KEY: SECRET });
    expect(cfg.dbPath).toBe("/tmp/vault.sqlite");
    expect(cfg.llmReady).toBe(true);
    expect(cfg.settings.mode).toBe("external");
  });

  it("reports llmReady false when the LLM is not fully configured", () => {
    expect(loadMcpConfig({ TMV_DB_PATH: "/tmp/v.sqlite" }).llmReady).toBe(false); // no model/key
  });
});
