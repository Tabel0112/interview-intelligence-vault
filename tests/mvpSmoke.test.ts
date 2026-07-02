import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi, renderRoute, type FrontendApi } from "../src/frontend/index.js";
import { createLlmMemoryExtractor } from "../src/memory/index.js";
import { searchMemoryObjects } from "../src/retrieval/index.js";
import { resolveEvidencePointer } from "../src/provenance/index.js";
import { createLlmAskAILanguageModel } from "../src/ask-ai/index.js";
import { ExternalLlmProvider, type LlmTransport } from "../src/llm/index.js";

const RAW = "Alex: We decided to use SQLite as the source of truth for the vault.";
const SECRET = "sk-smoke-PLANTED-SECRET-1234567890";
const QUESTION = "What is the source of truth?";
const LLM_CLAIM = "SQLite is the source of truth for the vault.";

const lastUserMessage = (body: string): string => {
  const messages = (JSON.parse(body) as { messages: Array<{ content: string }> }).messages;
  return messages[messages.length - 1].content;
};

// Grounded structured extraction output, citing the real span id + an exact supporting quote.
const extractionTransport: LlmTransport = async (req) => {
  const m = lastUserMessage(req.body).match(/\[span_id=(\S+) speaker=[^\]]*\]\n([^\n]+)/);
  const spanId = m?.[1] ?? "unknown", text = (m?.[2] ?? "").trim();
  // Tentative phrasing keeps this in needs_review so the lifecycle exercises the human review->approve step.
  const content = JSON.stringify({ objects: [{ type: "decision", title: "Use SQLite as the source of truth", body: "The team might use SQLite as the source of truth.", evidenceSpanIds: [spanId], supportingQuote: text }] });
  return { status: 200, body: { choices: [{ message: { content }, finish_reason: "stop" }] } };
};

// Grounded structured synthesis output, citing only the selected evidence pointer + an exact quote.
const synthesisTransport: LlmTransport = async (req) => {
  const m = lastUserMessage(req.body).match(/pointerId:\s*(\S+)\n\s*quote:\s*(.+)/);
  const pointerId = m?.[1] ?? "unknown", quote = (m?.[2] ?? "").trim();
  const content = JSON.stringify({ claims: [{ kind: "fact", text: LLM_CLAIM, evidencePointerIds: [pointerId], supportingQuote: quote, explanation: "From the cited transcript span." }] });
  return { status: 200, body: { choices: [{ message: { content }, finish_reason: "stop" }] } };
};

const makeApi = (db: SqliteDatabase): FrontendApi => {
  const extractionProvider = new ExternalLlmProvider({ id: "openai", model: "gpt-extract", apiKey: SECRET, transport: extractionTransport });
  const synthesisProvider = new ExternalLlmProvider({ id: "openai", model: "gpt-synth", apiKey: SECRET, transport: synthesisTransport });
  // The live LLM-required config: a mock external LLM for extraction + synthesis, no deterministic fallback.
  return createSqliteFrontendApi(db, {
    llmRequired: true,
    getLlmReady: () => true,
    getMemoryExtractor: () => createLlmMemoryExtractor(extractionProvider),
    getSynthesis: () => ({ llm: createLlmAskAILanguageModel(synthesisProvider), info: { mode: "external_llm", provider: "openai", model: "gpt-synth", usedFallback: false } }),
  });
};

const AUDIT_TABLES = [
  "transcripts", "transcript_spans", "memory_objects", "memory_object_evidence", "extraction_runs", "evidence_pointers",
  "source_pointers", "ai_answers", "ask_ai_runs", "answer_claims", "ask_ai_claim_metadata", "user_corrections",
  "retrieval_documents", "ask_ai_run_evidence", "citation_links",
];
const dumpAll = (db: SqliteDatabase): string => JSON.stringify(AUDIT_TABLES.map((t) => db.prepare(`SELECT * FROM ${t}`).all()));
const count = (db: SqliteDatabase, sql: string, ...args: unknown[]) => (db.prepare(`SELECT COUNT(*) c FROM ${sql}`).get(...args) as { c: number }).c;

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

describe("MVP smoke: full lifecycle through the live frontend API", () => {
  it("upload -> auto extract -> review -> approve -> grounded LLM Ask AI -> reject, with trust preserved", async () => {
    const api = makeApi(db);

    // 1-2. Upload + raw transcript and spans exist.
    const uploaded = await api.uploadTranscript({ filename: "smoke.txt", rawText: RAW });
    expect(uploaded.status).toBe("imported");
    const transcriptId = uploaded.transcriptId;
    const span = db.prepare("SELECT id, text FROM transcript_spans WHERE transcript_id=? ORDER BY ordinal LIMIT 1").get(transcriptId) as { id: string; text: string };
    expect(span?.id).toBeTruthy();
    expect((db.prepare("SELECT raw_text FROM transcripts WHERE id=?").get(transcriptId) as { raw_text: string }).raw_text).toContain("source of truth");

    // 3. Raw mutation is blocked by immutability triggers.
    expect(() => db.prepare("UPDATE transcript_spans SET text='tampered' WHERE id=?").run(span.id)).toThrow();
    expect(() => db.prepare("UPDATE transcripts SET raw_text='tampered' WHERE id=?").run(transcriptId)).toThrow();

    // 4-6. Extraction ran automatically; LLM memory landed in needs_review.
    expect(count(db, "extraction_runs WHERE transcript_id=? AND status='completed'", transcriptId)).toBe(1);
    const memory = db.prepare("SELECT id, extraction_status FROM memory_objects WHERE extraction_run_id IN (SELECT id FROM extraction_runs WHERE transcript_id=?)").get(transcriptId) as { id: string; extraction_status: string };
    const memoryId = memory.id;
    expect(memory.extraction_status).toBe("needs_review");

    // 7. Review queue shows the memory.
    expect((await api.listReviewItems()).some((r) => r.type === "memory_needs_review" && r.targetId === memoryId)).toBe(true);

    // 8. needs_review memory is not Ask-AI evidence before approval (Policy A).
    expect(count(db, "evidence_pointers")).toBe(0);
    expect((await api.ask(QUESTION)).notEnoughEvidence).toBe(true);

    // 9-11. Approve via the correction/trust path (not a raw status write).
    expect((await api.reviewMemoryObject(memoryId, "approve")).status).toBe("approved");
    const promoted = db.prepare("SELECT extraction_status, user_corrected FROM memory_objects WHERE id=?").get(memoryId) as { extraction_status: string; user_corrected: number };
    expect(promoted.extraction_status).toBe("active");
    expect(promoted.user_corrected).toBe(1);
    expect(count(db, "user_corrections WHERE target_id=? AND correction_type='confirm'", memoryId)).toBeGreaterThan(0);

    // 12. Evidence pointers created and resolve to real spans.
    const pointers = db.prepare("SELECT evidence_pointer_id FROM evidence_pointers WHERE target_type='memory_object' AND target_id=?").all(memoryId) as Array<{ evidence_pointer_id: string }>;
    expect(pointers.length).toBeGreaterThan(0);
    for (const p of pointers) {
      const resolved = resolveEvidencePointer(db, p.evidence_pointer_id);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(resolved.spanText.length).toBeGreaterThan(0);
    }

    // 13. Local retrieval index updated; ordinary memory search finds it.
    expect(count(db, "retrieval_documents WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(1);
    expect((await searchMemoryObjects(db, { query: "SQLite source of truth" })).some((c) => c.targetId === memoryId)).toBe(true);

    // 14-15. Ask AI via mock external LLM synthesis -> grounded answer with a validated citation.
    const answer = await api.ask(QUESTION);
    expect(answer.notEnoughEvidence).toBe(false);
    expect(answer.claims.some((c) => c.text === LLM_CLAIM)).toBe(true); // proves LLM synthesis ran (not deterministic fallback)
    expect(answer.citations.length).toBeGreaterThan(0);
    for (const citation of answer.citations) expect(resolveEvidencePointer(db, citation.evidencePointerId).ok).toBe(true);
    expect(answer.answerMarkdown).toContain("mv://evidence/");

    // UI: answer route renders a citation/evidence link and no secret.
    const answerHtml = await renderRoute(api, `mv://answers/${answer.id}`);
    expect(answerHtml).toContain("mv://evidence/");
    expect(answerHtml).not.toContain(SECRET);

    // 16-17. Reject the same memory -> not Ask-AI evidence, not search-visible.
    expect((await api.reviewMemoryObject(memoryId, "reject")).status).toBe("rejected");
    expect((db.prepare("SELECT extraction_status FROM memory_objects WHERE id=?").get(memoryId) as { extraction_status: string }).extraction_status).toBe("rejected");
    expect(count(db, "evidence_pointers WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(0);
    expect(count(db, "retrieval_documents WHERE target_type='memory_object' AND target_id=?", memoryId)).toBe(0);
    expect((await searchMemoryObjects(db, { query: "SQLite source of truth" })).some((c) => c.targetId === memoryId)).toBe(false);
    expect((await api.ask(QUESTION)).notEnoughEvidence).toBe(true);

    // 18. Audit/provenance rows preserved.
    expect(count(db, "memory_object_evidence WHERE memory_id=?", memoryId)).toBeGreaterThan(0);
    expect(count(db, "source_pointers")).toBeGreaterThan(0);
    expect(count(db, "user_corrections WHERE target_id=?", memoryId)).toBeGreaterThan(0);

    // 19. No external embedding API was called automatically.
    expect(count(db, "search_embeddings")).toBe(0);

    // 20. No secret/prompt/header/url/provider-object/upstream-error persisted anywhere.
    const dump = dumpAll(db);
    for (const forbidden of [SECRET, "Bearer", "Authorization", "chat/completions", "api.openai.com", "never use outside knowledge", "Return JSON of the form"]) {
      expect(dump).not.toContain(forbidden);
    }
  });

  it("review route renders the memory item with Approve/Reject (renderRoute, no jsdom)", async () => {
    const api = makeApi(db);
    await api.uploadTranscript({ filename: "smoke.txt", rawText: RAW });
    const html = await renderRoute(api, "mv://review");
    expect(html).toContain('data-action="review"');
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).not.toContain(SECRET);
  });
});
