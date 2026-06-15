import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import { indexEvidencePointerForSearch } from "../src/retrieval/index.js";
import {
  askAI, createDatabaseAskAIDependencies, createLlmAskAILanguageModel, getAskAIResponse,
} from "../src/ask-ai/index.js";
import { askAiSynthesisFromSettings } from "../src/obsidian/llmSettings.js";
import { DEFAULT_SETTINGS, setApiKey, type TranscriptMemorySettings } from "../src/obsidian/settings.js";
import { ExternalLlmProvider, type LlmTransport } from "../src/llm/index.js";

const SECRET = "sk-wiring-PLANTED-SECRET-1234567890";
const now = () => new Date("2026-06-12T12:00:00.000Z");

let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;
beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); });
afterEach(() => db.close());

// Seed a transcript + memory object + indexed evidence pointer so retrieval returns one candidate.
async function seedEvidence() {
  const imported = importTranscript(db, { filename: "t.txt", rawText: "Alex: SQLite is the source of truth for the vault." });
  const span = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string };
  const memory = repos.memoryObjects.createMemoryObject(
    { type: "decision", generated_text: "SQLite is authoritative.", confidence: 0.95, created_by: "agent" },
    [{ span_id: span.id, role: "supports", evidence_score: 0.95 }],
  );
  const pointer = linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: span.id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.95 });
  await indexEvidencePointerForSearch(db, pointer.evidence_pointer_id);
  return pointer;
}

const externalSettings = (overrides: Partial<TranscriptMemorySettings["llm"]> = {}, withKey = true): TranscriptMemorySettings => {
  const base: TranscriptMemorySettings = {
    schemaVersion: 1, mode: "external",
    llm: { provider: "openai", model: "gpt-4o-mini", ...overrides },
    embedding: { provider: "deterministic-test", model: "token-hash-v1" }, apiKeys: {},
  };
  return withKey ? setApiKey(base, "openai", SECRET) : base;
};

describe("askAiSynthesisFromSettings (no network)", () => {
  const forbidden: LlmTransport = async () => { throw new Error("network must not be called"); };

  it("returns no llm and deterministic info for local/default settings", () => {
    const synth = askAiSynthesisFromSettings(DEFAULT_SETTINGS, { transport: forbidden });
    expect(synth.llm).toBeUndefined();
    expect(synth.info).toMatchObject({ mode: "deterministic", usedFallback: false });
  });

  it("returns an llm adapter and external info when fully configured (no network on resolve)", () => {
    const synth = askAiSynthesisFromSettings(externalSettings(), { transport: forbidden });
    expect(synth.llm).toBeDefined();
    expect(synth.info).toEqual({ mode: "external_llm", provider: "openai", model: "gpt-4o-mini", usedFallback: false });
  });

  it("falls back to deterministic (no llm) with usedFallback when the key is missing", () => {
    const synth = askAiSynthesisFromSettings(externalSettings({}, false), { transport: forbidden });
    expect(synth.llm).toBeUndefined();
    expect(synth.info.mode).toBe("deterministic");
    expect(synth.info.usedFallback).toBe(true);
    expect(JSON.stringify(synth.info)).not.toContain(SECRET);
  });
});

describe("live Ask AI wiring through createDatabaseAskAIDependencies", () => {
  it("defaults to deterministic synthesis (no llm injected)", async () => {
    await seedEvidence();
    const response = await askAI({ question: "SQLite source of truth" }, createDatabaseAskAIDependencies(db, { now }));
    expect(response.notEnoughEvidence).toBe(false);
    expect(response.synthesis).toMatchObject({ mode: "deterministic", usedFallback: false });
    const reloaded = getAskAIResponse(db, response.id);
    expect(reloaded.synthesis).toMatchObject({ mode: "deterministic" });
  });
});

describe("live external-LLM synthesis persists accurate, non-secret metadata", () => {
  it("records mode=external_llm with provider/model and no API key", async () => {
    const pointer = await seedEvidence();
    const transport: LlmTransport = async () => ({
      status: 200,
      body: { choices: [{ message: { content: JSON.stringify({ claims: [{ kind: "fact", text: "SQLite is the source of truth.", evidencePointerIds: [pointer.evidence_pointer_id], supportingQuote: "SQLite is the source of truth" }] }) }, finish_reason: "stop" }] },
    });
    const provider = new ExternalLlmProvider({ id: "openai", model: "gpt-4o-mini", apiKey: SECRET, transport });
    const llm = createLlmAskAILanguageModel(provider);
    const synthesisInfo = { mode: "external_llm" as const, provider: "openai", model: "gpt-4o-mini", usedFallback: false };

    const response = await askAI({ question: "SQLite source of truth" }, createDatabaseAskAIDependencies(db, { now, llm, synthesisInfo }));
    expect(response.synthesis).toEqual({ mode: "external_llm", provider: "openai", model: "gpt-4o-mini", usedFallback: false, reason: undefined });

    const stored = db.prepare("SELECT model_name, metadata_json FROM ai_answers WHERE id=?").get(response.id) as { model_name: string; metadata_json: string };
    expect(stored.model_name).toBe("gpt-4o-mini");
    expect(JSON.parse(stored.metadata_json).synthesis).toMatchObject({ mode: "external_llm", provider: "openai", model: "gpt-4o-mini", usedFallback: false });
    // No secret anywhere in the persisted answer / run rows.
    expect(stored.metadata_json).not.toContain(SECRET);
    const run = db.prepare("SELECT * FROM ask_ai_runs WHERE id=?").get(response.id) as Record<string, unknown>;
    expect(JSON.stringify(run)).not.toContain(SECRET);
  });

  it("records usedFallback=true (mode=deterministic) when the configured LLM fails at runtime, without leaking the key", async () => {
    await seedEvidence();
    const transport: LlmTransport = async () => ({ status: 401, body: { error: "bad key" } }); // provider rejects -> adapter throws -> fallback
    const provider = new ExternalLlmProvider({ id: "openai", model: "gpt-4o-mini", apiKey: SECRET, transport });
    const llm = createLlmAskAILanguageModel(provider);
    const synthesisInfo = { mode: "external_llm" as const, provider: "openai", model: "gpt-4o-mini", usedFallback: false };

    const response = await askAI({ question: "SQLite source of truth" }, createDatabaseAskAIDependencies(db, { now, llm, synthesisInfo }));
    expect(response.synthesis).toMatchObject({ mode: "deterministic", provider: "openai", model: "gpt-4o-mini", usedFallback: true });
    expect(response.synthesis?.reason).toBeTruthy();
    expect(response.notEnoughEvidence).toBe(false); // still answered, via deterministic fallback

    const stored = db.prepare("SELECT metadata_json FROM ai_answers WHERE id=?").get(response.id) as { metadata_json: string };
    expect(stored.metadata_json).not.toContain(SECRET);
    expect(JSON.stringify(response)).not.toContain(SECRET);
  });
});
