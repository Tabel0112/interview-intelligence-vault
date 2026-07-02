import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { askAI, createDatabaseAskAIDependencies } from "../src/ask-ai/index.js";
import { createSqliteFrontendApi, performReviewAction, renderRoute, routeHref, type FrontendApi } from "../src/frontend/index.js";
import { createLlmMemoryExtractor, DeterministicRuleExtractor } from "../src/memory/index.js";
import { searchMemoryObjects } from "../src/retrieval/index.js";
import { resolveEvidencePointer } from "../src/provenance/index.js";
import { MockLlmProvider } from "../src/llm/testing.js";
import type { LlmCompletion, LlmRequest } from "../src/llm/index.js";
import { ViewRefreshRegistry } from "../src/obsidian/viewRefreshRegistry.js";

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

// Seed a needs_review LLM memory via the live upload path and return the api + memory id. The candidate
// uses tentative phrasing ("might"), so the calibrated policy routes it to review (the case a human then
// approves) rather than auto-activating it.
async function seedNeedsReview(): Promise<{ api: FrontendApi; memoryId: string }> {
  const provider = new MockLlmProvider({
    completion: (req: LlmRequest): LlmCompletion => {
      const { spanId, text } = firstSpan(req.prompt);
      return { provider: "mock", model: "mock", text: objectsJson([{ type: "decision", title: "Use SQLite as the source of truth", body: "The team might use SQLite as the source of truth.", evidenceSpanIds: [spanId], supportingQuote: text, confidence: 0.99 }]), finishReason: "stop" };
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
    // After approval the memory is a discoverable memory_object retrieval document.
    expect(count(db, "retrieval_documents WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(1);
    expect((await searchMemoryObjects(db, { query: "SQLite source of truth" })).some((c) => c.targetId === memoryId)).toBe(true);

    const result = await api.reviewMemoryObject(memoryId, "reject");
    expect(result.status).toBe("rejected");
    expect((db.prepare("SELECT extraction_status FROM memory_objects WHERE id=?").get(memoryId) as { extraction_status: string }).extraction_status).toBe("rejected");
    expect(count(db, "evidence_pointers WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(0);
    expect(count(db, "retrieval_documents WHERE target_type='evidence_pointer'")).toBe(0); // cascade cleanup trigger
    // The memory_object retrieval doc and its index rows are removed; it is no longer searchable.
    expect(count(db, "retrieval_documents WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(0);
    expect(count(db, "retrieval_index_status WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(0);
    expect(count(db, "search_embeddings WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(0);
    expect((await searchMemoryObjects(db, { query: "SQLite source of truth" })).some((c) => c.targetId === memoryId)).toBe(false);
    expect((await askSourceOfTruth()).notEnoughEvidence).toBe(true);
    // Legacy evidence rows + source pointers are preserved for audit.
    expect(count(db, "memory_object_evidence WHERE memory_id=?", memoryId)).toBeGreaterThan(0);
    expect(count(db, "source_pointers")).toBeGreaterThan(0);

    // Idempotent: a second reject is a no-op; re-approval re-indexes the memory cleanly.
    await api.reviewMemoryObject(memoryId, "reject");
    expect(count(db, "retrieval_documents WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(0);
    await api.reviewMemoryObject(memoryId, "approve");
    expect(count(db, "retrieval_documents WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(1);
    expect((await searchMemoryObjects(db, { query: "SQLite source of truth" })).some((c) => c.targetId === memoryId)).toBe(true);
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

  it("a review action re-fetches the current route so the resolved item disappears without manual navigation", async () => {
    const { api, memoryId } = await seedNeedsReview();
    // The review queue lists the task before the action (its memory id is in the rendered HTML).
    expect(await renderRoute(api, "mv://review")).toContain(memoryId);

    const refreshed: string[] = [];
    const refresh = async (target: string) => { refreshed.push(target); };

    // Approve from the review list: the action runs and then refreshes the current (review) route.
    await performReviewAction(api, memoryId, "approve", refresh, "mv://review");
    expect(refreshed).toEqual(["mv://review"]);
    // Re-rendering that route now shows the resolved item gone — no manual navigation required.
    expect(await renderRoute(api, "mv://review")).not.toContain(memoryId);

    // From a detail page, the refresh falls back to the review queue (the detail item no longer exists).
    refreshed.length = 0;
    await performReviewAction(api, memoryId, "reject", refresh, `mv://review/memory:${memoryId}`);
    expect(refreshed).toEqual([routeHref.reviewQueue()]);
    expect((db.prepare("SELECT extraction_status FROM memory_objects WHERE id=?").get(memoryId) as { extraction_status: string }).extraction_status).toBe("rejected");
  });

  it("cross-view refresh: approving in one Review Queue view clears the item in another open view", async () => {
    const { api, memoryId } = await seedNeedsReview();
    const registry = new ViewRefreshRegistry();
    // Two open Review Queue views; each re-renders mv://review when the registry refreshes it.
    const makeView = () => {
      const view = { html: "", async refresh() { view.html = await renderRoute(api, "mv://review"); } };
      return view;
    };
    const viewA = makeView();
    const viewB = makeView();
    registry.register(viewA);
    registry.register(viewB);
    expect(registry.size()).toBe(2);

    // Both views initially show the pending item.
    await viewA.refresh();
    await viewB.refresh();
    expect(viewA.html).toContain(memoryId);
    expect(viewB.html).toContain(memoryId);

    // Approve from view A: the initiating view refreshes itself, then notifies the others.
    await api.reviewMemoryObject(memoryId, "approve");
    await viewA.refresh();
    await registry.notifyMutation(viewA);

    // Both views drop the resolved item — the OTHER view updated without manual navigation.
    expect(viewA.html).not.toContain(memoryId);
    expect(viewB.html).not.toContain(memoryId);
  });

  it("approve resolves the task without spawning a user-correction item; reject after approve ends rejected", async () => {
    const { api, memoryId } = await seedNeedsReview();
    expect((await api.listReviewItems()).some((i) => i.type === "memory_needs_review" && i.targetId === memoryId)).toBe(true);

    // Approve: the task resolves and the append-only confirm correction does NOT become a new review item.
    expect((await api.reviewMemoryObject(memoryId, "approve")).status).toBe("approved");
    const afterApprove = await api.listReviewItems();
    expect(afterApprove.some((i) => i.type === "memory_needs_review" && i.targetId === memoryId)).toBe(false);
    expect(afterApprove.some((i) => i.type === "weak_evidence" && i.targetId === memoryId)).toBe(false);
    expect(afterApprove.some((i) => i.type === "user_correction")).toBe(false);
    expect(count(db, "user_corrections WHERE target_id=? AND correction_type='confirm'", memoryId)).toBeGreaterThan(0); // audit kept

    // Reject after approve: canonical status becomes rejected even though history still holds the confirm.
    expect((await api.reviewMemoryObject(memoryId, "reject")).status).toBe("rejected");
    expect((db.prepare("SELECT extraction_status FROM memory_objects WHERE id=?").get(memoryId) as { extraction_status: string }).extraction_status).toBe("rejected");
    expect((await api.getMemory(memoryId))?.memory.status).toBe("rejected");
    expect((await api.listReviewItems()).some((i) => i.type === "user_correction")).toBe(false);
    expect(count(db, "user_corrections WHERE target_id=? AND correction_type='confirm'", memoryId)).toBeGreaterThan(0); // history preserved

    // UI render reflects the current (rejected) state, not stale approved/active text or controls.
    const html = await renderRoute(api, routeHref.memory(memoryId));
    expect(html).toContain('data-trust-state="rejected"');
    expect(html).not.toContain("Review decision");

    // Rejected memory stays out of evidence pointers and retrieval documents.
    expect(count(db, "evidence_pointers WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(0);
    expect(count(db, "retrieval_documents WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(0);
  });
});
