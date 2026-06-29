import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { askAI, createDatabaseAskAIDependencies } from "../src/ask-ai/index.js";
import { createSqliteFrontendApi } from "../src/frontend/index.js";
import { DeterministicRuleExtractor, createLlmMemoryExtractor } from "../src/memory/index.js";
import { indexTranscriptForRetrieval } from "../src/retrieval/index.js";
import { resolveEvidencePointer } from "../src/provenance/index.js";
import { MockLlmProvider } from "../src/llm/testing.js";
import type { LlmCompletion, LlmRequest } from "../src/llm/index.js";

const RAW = "Alex: We decided to use SQLite as the source of truth for the vault.";
const objectsJson = (objects: unknown[]) => JSON.stringify({ objects });
const firstSpan = (prompt: string) => {
  const m = prompt.match(/\[span_id=(\S+) speaker=[^\]]*\]\n([^\n]+)/);
  return { spanId: m?.[1] ?? "unknown", text: m?.[2] ?? "" };
};
const count = (db: SqliteDatabase, table: string) => (db.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c;

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

describe("post-import provenance bridge + local indexing", () => {
  it("bridges usable deterministic memory to evidence pointers, indexes locally, and Ask AI can discover it", async () => {
    const api = createSqliteFrontendApi(db, { getMemoryExtractor: () => new DeterministicRuleExtractor() });
    await api.uploadTranscript({ filename: "m.txt", rawText: RAW });

    const pointers = db.prepare("SELECT * FROM evidence_pointers WHERE target_type='memory_object'").all() as Array<{ evidence_pointer_id: string; span_id: string }>;
    expect(pointers.length).toBeGreaterThan(0);
    expect(count(db, "retrieval_documents")).toBeGreaterThan(0);

    // Provenance integrity: each pointer resolves and traces to a real span (hash-validated).
    for (const pointer of pointers) {
      const resolved = resolveEvidencePointer(db, pointer.evidence_pointer_id);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(resolved.spanText.length).toBeGreaterThan(0);
    }

    // Ask AI (deterministic, no provider) now discovers the extracted memory's evidence.
    const answer = await askAI({ question: "What is the source of truth?" }, createDatabaseAskAIDependencies(db));
    expect(answer.notEnoughEvidence).toBe(false);
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it("does NOT bridge needs_review LLM memory (Policy A): it stays in review, not Ask AI evidence", async () => {
    const provider = new MockLlmProvider({
      completion: (req: LlmRequest): LlmCompletion => {
        const { spanId, text } = firstSpan(req.prompt);
        // Tentative phrasing -> the calibrated policy keeps this in review (Policy A applies to it).
        return { provider: "mock", model: "mock", text: objectsJson([{ type: "decision", title: "Use SQLite as source of truth", body: "The team might use SQLite as the source of truth.", evidenceSpanIds: [spanId], supportingQuote: text, confidence: 0.99 }]), finishReason: "stop" };
      },
    });
    const extractor = createLlmMemoryExtractor(provider, { fallback: new DeterministicRuleExtractor() });
    const api = createSqliteFrontendApi(db, { getMemoryExtractor: () => extractor });
    await api.uploadTranscript({ filename: "m.txt", rawText: RAW });

    // The LLM memory exists and is needs_review...
    const memory = db.prepare("SELECT extraction_status FROM memory_objects LIMIT 1").get() as { extraction_status: string };
    expect(memory.extraction_status).toBe("needs_review");
    // ...but it is NOT bridged to evidence pointers.
    expect(count(db, "evidence_pointers")).toBe(0);
    // ...and Ask AI finds no evidence to answer from.
    const answer = await askAI({ question: "What is the source of truth?" }, createDatabaseAskAIDependencies(db));
    expect(answer.notEnoughEvidence).toBe(true);
  });

  it("is idempotent: re-running does not duplicate evidence pointers or retrieval rows", async () => {
    const api = createSqliteFrontendApi(db, { getMemoryExtractor: () => new DeterministicRuleExtractor() });
    const result = await api.uploadTranscript({ filename: "m.txt", rawText: RAW });
    const pointersAfterUpload = count(db, "evidence_pointers");
    const docsAfterUpload = count(db, "retrieval_documents");
    expect(pointersAfterUpload).toBeGreaterThan(0);

    await indexTranscriptForRetrieval(db, result.transcriptId);
    await indexTranscriptForRetrieval(db, result.transcriptId);
    expect(count(db, "evidence_pointers")).toBe(pointersAfterUpload);
    expect(count(db, "retrieval_documents")).toBe(docsAfterUpload);
  });

  it("does not duplicate pointers/rows for a duplicate upload", async () => {
    const api = createSqliteFrontendApi(db, { getMemoryExtractor: () => new DeterministicRuleExtractor() });
    await api.uploadTranscript({ filename: "m.txt", rawText: RAW });
    const pointers = count(db, "evidence_pointers");
    const docs = count(db, "retrieval_documents");
    const second = await api.uploadTranscript({ filename: "again.txt", rawText: RAW }); // identical content
    expect(second.status).toBe("duplicate");
    expect(count(db, "evidence_pointers")).toBe(pointers);
    expect(count(db, "retrieval_documents")).toBe(docs);
  });

  it("never calls external embeddings: search_embeddings stays empty after auto-indexing", async () => {
    const api = createSqliteFrontendApi(db, { getMemoryExtractor: () => new DeterministicRuleExtractor() });
    await api.uploadTranscript({ filename: "m.txt", rawText: RAW });
    expect(count(db, "retrieval_documents")).toBeGreaterThan(0);
    expect(count(db, "search_embeddings")).toBe(0); // local keyword index only — no vectors, no network
  });
});
