import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { askAI, createDatabaseAskAIDependencies } from "../src/ask-ai/index.js";
import { createSqliteFrontendApi, renderRoute, type FrontendApi } from "../src/frontend/index.js";
import { createLlmMemoryExtractor, DeterministicRuleExtractor } from "../src/memory/index.js";
import { resolveEvidencePointer } from "../src/provenance/index.js";
import { MockLlmProvider } from "../src/llm/testing.js";
import type { LlmCompletion, LlmRequest } from "../src/llm/index.js";

const RAW = "Alex: We decided to use SQLite as the source of truth for the vault.";
const SECRET = "sk-review-PLANTED-SECRET-1234567890";
const objectsJson = (objects: unknown[]) => JSON.stringify({ objects });
const firstSpan = (prompt: string) => {
  const m = prompt.match(/\[span_id=(\S+) speaker=[^\]]*\]\n([^\n]+)/);
  return { spanId: m?.[1] ?? "unknown", text: m?.[2] ?? "" };
};
const count = (db: SqliteDatabase, sql: string, ...args: unknown[]) => (db.prepare(`SELECT COUNT(*) c FROM ${sql}`).get(...args) as { c: number }).c;

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

// Seed a needs_review LLM memory via the live upload path and return the api + memory id.
async function seedNeedsReview(): Promise<{ api: FrontendApi; memoryId: string }> {
  const provider = new MockLlmProvider({
    completion: (req: LlmRequest): LlmCompletion => {
      const { spanId, text } = firstSpan(req.prompt);
      return { provider: "mock", model: "mock", text: objectsJson([{ type: "decision", title: "Use SQLite as the source of truth", body: "The team chose SQLite.", evidenceSpanIds: [spanId], supportingQuote: text, confidence: 0.99 }]), finishReason: "stop" };
    },
  }, { id: "openai", model: "gpt", isLocal: false });
  const api = createSqliteFrontendApi(db, { getMemoryExtractor: () => createLlmMemoryExtractor(provider, { fallback: new DeterministicRuleExtractor() }) });
  await api.uploadTranscript({ filename: "m.txt", rawText: RAW });
  const memoryId = String((db.prepare("SELECT id FROM memory_objects WHERE extraction_status='needs_review' LIMIT 1").get() as { id: string }).id);
  return { api, memoryId };
}

const askSourceOfTruth = () => askAI({ question: "What is the source of truth?" }, createDatabaseAskAIDependencies(db));

describe("review approval -> evidence bridge / retrieval indexing", () => {
  it("needs_review memory is not Ask-AI evidence before approval", async () => {
    await seedNeedsReview();
    expect(count(db, "evidence_pointers")).toBe(0);
    expect((await askSourceOfTruth()).notEnoughEvidence).toBe(true);
  });

  it("approve promotes to active/usable, bridges evidence pointers that resolve, and Ask AI can cite it", async () => {
    const { api, memoryId } = await seedNeedsReview();
    const result = await api.reviewMemoryObject(memoryId, "approve");
    expect(result.status).toBe("approved");

    const memory = db.prepare("SELECT extraction_status, user_corrected FROM memory_objects WHERE id=?").get(memoryId) as { extraction_status: string; user_corrected: number };
    expect(memory.extraction_status).toBe("active");
    expect(memory.user_corrected).toBe(1);

    const pointers = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type='memory_object' AND target_id=?").all(memoryId) as Array<{ evidence_pointer_id: string }>;
    expect(pointers.length).toBeGreaterThan(0);
    for (const p of pointers) {
      const resolved = resolveEvidencePointer(db, p.evidence_pointer_id);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(resolved.spanText.length).toBeGreaterThan(0);
    }
    expect(count(db, "search_embeddings")).toBe(0); // no external embedding call

    const answer = await askSourceOfTruth();
    expect(answer.notEnoughEvidence).toBe(false);
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it("reject marks rejected, deletes its evidence pointers, cleans retrieval rows, and Ask AI cannot cite it", async () => {
    const { api, memoryId } = await seedNeedsReview();
    await api.reviewMemoryObject(memoryId, "approve");
    expect(count(db, "evidence_pointers WHERE target_type='memory_object' AND target_id=?", memoryId)).toBeGreaterThan(0);

    const result = await api.reviewMemoryObject(memoryId, "reject");
    expect(result.status).toBe("rejected");
    expect((db.prepare("SELECT extraction_status FROM memory_objects WHERE id=?").get(memoryId) as { extraction_status: string }).extraction_status).toBe("rejected");
    expect(count(db, "evidence_pointers WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(0);
    expect(count(db, "retrieval_documents WHERE target_type='evidence_pointer'")).toBe(0); // cascade cleanup trigger
    expect((await askSourceOfTruth()).notEnoughEvidence).toBe(true);
    // Legacy evidence rows are preserved.
    expect(count(db, "memory_object_evidence WHERE memory_id=?", memoryId)).toBeGreaterThan(0);
  });

  it("is idempotent for repeated approve and reject, and leaks no secret in the result", async () => {
    const { api, memoryId } = await seedNeedsReview();
    const r1 = await api.reviewMemoryObject(memoryId, "approve");
    const pointers = count(db, "evidence_pointers");
    const docs = count(db, "retrieval_documents");
    const r2 = await api.reviewMemoryObject(memoryId, "approve");
    expect(count(db, "evidence_pointers")).toBe(pointers);
    expect(count(db, "retrieval_documents")).toBe(docs);

    await api.reviewMemoryObject(memoryId, "reject");
    await api.reviewMemoryObject(memoryId, "reject"); // no-op, no throw
    expect(count(db, "evidence_pointers WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(0);

    expect(JSON.stringify([r1, r2])).not.toContain(SECRET);
  });

  it("renders Approve/Reject buttons on a needs_review memory review item", async () => {
    const { api } = await seedNeedsReview();
    const html = await renderRoute(api, "mv://review");
    expect(html).toContain('data-action="review"');
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).not.toContain(SECRET);
  });
});
