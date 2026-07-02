import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, createRepositories, type SqliteDatabase } from "../src/db/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";
import {
  createConflictRepository, detectAndPersistConflictsForMemory, detectAndPersistConflictsForTranscript,
} from "../src/conflicts/index.js";
import { askAI, createDatabaseAskAIDependencies, createLlmAskAILanguageModel } from "../src/ask-ai/index.js";
import { createSqliteFrontendApi, type FrontendApi } from "../src/frontend/index.js";
import { createLlmMemoryExtractor } from "../src/memory/index.js";
import { createVaultTools } from "../src/mcp/tools.js";
import { ExternalLlmProvider, type LlmTransport } from "../src/llm/index.js";

const now = () => new Date("2026-07-01T12:00:00.000Z");
const SECRET = "sk-live-conflict-PLANTED-1234567890";

// Two source-backed, opposing statements. Wordings are deliberately lexically distinct so extraction's
// near-duplicate detection (token Jaccard >= 0.82) does not mark the second one a possible duplicate —
// they must survive as two independent memories for conflict detection to compare.
const RAW = [
  "Alex: We must use SQLite as the source of truth for the vault.",
  "Sam: The team should not use SQLite for storage; avoid SQLite as the system of record.",
].join("\n");

const lastUserMessage = (body: string): string => {
  const messages = (JSON.parse(body) as { messages: Array<{ content: string }> }).messages;
  return messages[messages.length - 1].content;
};

// Grounded structured extraction: one decision object per SQLite span, body = span text minus the
// speaker prefix (maximally grounded), supportingQuote = the exact span line.
const extractionTransport: LlmTransport = async (req) => {
  const matches = [...lastUserMessage(req.body).matchAll(/\[span_id=(\S+) speaker=[^\]]*\]\n([^\n]+)/g)];
  const objects = matches
    .filter(([, , line]) => line.includes("SQLite"))
    .map(([, spanId, line]) => {
      const body = line.trim().replace(/^[^:]+:\s*/, "");
      const title = body.includes("not") ? "Do not use SQLite for storage" : "Use SQLite as the source of truth";
      return { type: "decision", title, body, evidenceSpanIds: [spanId], supportingQuote: line.trim() };
    });
  return { status: 200, body: { choices: [{ message: { content: JSON.stringify({ objects }) }, finish_reason: "stop" }] } };
};

const makeApi = (db: SqliteDatabase): FrontendApi => {
  const provider = new ExternalLlmProvider({ id: "openai", model: "gpt-extract", apiKey: SECRET, transport: extractionTransport });
  return createSqliteFrontendApi(db, {
    now,
    llmRequired: true,
    getLlmReady: () => true,
    getMemoryExtractor: () => createLlmMemoryExtractor(provider),
    // Synthesis is not exercised here (Ask AI runs through the deterministic dev/test seam below).
    getSynthesis: () => ({ llm: createLlmAskAILanguageModel(provider), info: { mode: "external_llm", provider: "openai", model: "gpt-extract", usedFallback: false } }),
  });
};

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());
const count = (sql: string, ...args: unknown[]) => (db.prepare(`SELECT COUNT(*) c FROM ${sql}`).get(...args) as { c: number }).c;

describe("live conflict detection: upload -> extraction -> review approval (the real product path)", () => {
  it("persists an active, both-sides-cited conflict once both opposing memories are evidence-grade", async () => {
    const api = makeApi(db);

    // 1. Live upload runs extraction; both opposing statements become memories.
    const uploaded = await api.uploadTranscript({ filename: "conflict.txt", rawText: RAW });
    expect(uploaded.status).toBe("imported");
    const memories = db.prepare("SELECT id, COALESCE(extraction_status,status) s FROM memory_objects WHERE duplicate_of_id IS NULL ORDER BY created_at,id").all() as Array<{ id: string; s: string }>;
    expect(memories).toHaveLength(2);
    // The activation gate held at least one side back (an opposing statement must not silently auto-activate).
    const held = memories.filter((m) => m.s === "needs_review");
    expect(held.length).toBeGreaterThanOrEqual(1);

    // 2. Approve the held-back side(s) through the live review path (bridges pointers, then detects).
    for (const memory of held) {
      expect((await api.reviewMemoryObject(memory.id, "approve")).status).toBe("approved");
    }

    // 3. An ACTIVE conflict assessment now exists, citing evidence on BOTH sides.
    const repo = createConflictRepository(db, { now });
    const active = repo.listActiveConflicts();
    expect(active.length).toBeGreaterThanOrEqual(1);
    const conflict = active[0];
    expect(conflict.kind).toBe("direct_contradiction");
    const sides = new Set(conflict.evidenceLinks.map((link) => link.side));
    expect(sides).toEqual(new Set(["left", "right"]));
    for (const link of conflict.evidenceLinks) {
      expect(link.provenanceValidated).toBe(true);
      expect(link.quotePreview ?? "").not.toHaveLength(0); // citations preserved for both sides
    }

    // 4. The Review queue surfaces it as a conflict item.
    expect((await api.listReviewItems()).some((item) => item.type === "conflict")).toBe(true);

    // 5. MCP get_conflicts reads the same persisted assessments.
    const tools = createVaultTools({ db, api });
    const viaMcp = await tools.call("get_conflicts", {}) as { conflicts: Array<{ conflict_id: string; sides: unknown[] }> };
    expect(viaMcp.conflicts.length).toBeGreaterThanOrEqual(1);
    expect(viaMcp.conflicts[0].sides).toHaveLength(2);

    // 6. Ask AI surfaces the conflict through its existing findConflicts wiring (deterministic dev/test seam).
    const response = await askAI({ question: "What did we decide about SQLite storage?" }, createDatabaseAskAIDependencies(db, { now }));
    expect(response.conflicts.length).toBeGreaterThanOrEqual(1);

    // 7. Idempotency: re-running detection (any hook) never duplicates the logical pair.
    const before = count("conflict_assessments");
    const transcriptId = uploaded.transcriptId;
    detectAndPersistConflictsForTranscript(db, transcriptId, { now });
    for (const memory of memories) detectAndPersistConflictsForMemory(db, memory.id, { now });
    expect(count("conflict_assessments")).toBe(before);

    // 8. Re-uploading identical content is a duplicate import and changes nothing.
    expect((await api.uploadTranscript({ filename: "conflict.txt", rawText: RAW })).status).toBe("duplicate");
    expect(count("conflict_assessments")).toBe(before);

    // 9. Rejecting one side deletes its pointers; the FK cascade + migration-010 trigger downgrade the
    //    conflict out of active (history preserved, never deleted).
    expect((await api.reviewMemoryObject(memories[1].id, "reject")).status).toBe("rejected");
    expect(repo.listActiveConflicts()).toHaveLength(0);
    const after = repo.getConflictAssessment(conflict.id);
    expect(after).not.toBeNull();
    expect(after!.status).toBe("needs_review");
  });
});

describe("live conflict detection: transcript hook with already-trusted sides", () => {
  function seedOpposingActives() {
    const repos = createRepositories(db);
    const imported = importTranscript(db, {
      filename: "seeded.txt",
      rawText: "Alex: We will use SQLite as the source of truth.\nSam: We will not use SQLite as the source of truth.",
    });
    const spans = db.prepare("SELECT id FROM transcript_spans WHERE transcript_id=? ORDER BY ordinal").all(imported.transcriptId) as Array<{ id: string }>;
    const left = repos.memoryObjects.createMemoryObject(
      { type: "decision", title: "Use SQLite", generated_text: "We will use SQLite as the source of truth.", confidence: 0.9, created_by: "agent" },
      [{ span_id: spans[0].id, role: "supports", evidence_score: 0.9 }],
    );
    const right = repos.memoryObjects.createMemoryObject(
      { type: "decision", title: "Do not use SQLite", generated_text: "We will not use SQLite as the source of truth.", confidence: 0.9, created_by: "agent" },
      [{ span_id: spans[1].id, role: "supports", evidence_score: 0.9 }],
    );
    linkMemoryObjectToSpan(db, { memoryObjectId: left.id, transcriptId: imported.transcriptId, spanId: spans[0].id, evidenceStrength: "strong", confidence: 0.9 });
    linkMemoryObjectToSpan(db, { memoryObjectId: right.id, transcriptId: imported.transcriptId, spanId: spans[1].id, evidenceStrength: "strong", confidence: 0.9 });
    return { imported, left, right };
  }

  it("persists an immediately-active conflict when both sides are already active with strong evidence", () => {
    const { imported } = seedOpposingActives();
    const persisted = detectAndPersistConflictsForTranscript(db, imported.transcriptId, { now });
    expect(persisted).toHaveLength(1);
    expect(persisted[0].status).toBe("active");
    expect(persisted[0].kind).toBe("direct_contradiction");
    expect(persisted[0].confidence).toBeGreaterThanOrEqual(0.6);
    // Weak evidence caps / trust caps stayed inside the repository; both sides carry validated links.
    expect(persisted[0].evidenceLinks.filter((link) => link.side === "left")).not.toHaveLength(0);
    expect(persisted[0].evidenceLinks.filter((link) => link.side === "right")).not.toHaveLength(0);
  });

  it("is idempotent across repeated runs and scoped to transcripts that actually touch the pair", () => {
    const { imported } = seedOpposingActives();
    detectAndPersistConflictsForTranscript(db, imported.transcriptId, { now });
    detectAndPersistConflictsForTranscript(db, imported.transcriptId, { now });
    expect(count("conflict_assessments")).toBe(1);
    // A transcript with no evidence-backed memories creates nothing.
    const unrelated = importTranscript(db, { filename: "other.txt", rawText: "Pat: Nothing controversial here." });
    expect(detectAndPersistConflictsForTranscript(db, unrelated.transcriptId, { now })).toHaveLength(0);
    expect(count("conflict_assessments")).toBe(1);
  });

  it("hard-deleting a transcript leaves no active conflict behind (downgrade, not deletion)", async () => {
    const { imported } = seedOpposingActives();
    detectAndPersistConflictsForTranscript(db, imported.transcriptId, { now });
    expect(createConflictRepository(db, { now }).listActiveConflicts()).toHaveLength(1);
    const api = createSqliteFrontendApi(db, { now });
    await api.deleteTranscript(imported.transcriptId);
    const repo = createConflictRepository(db, { now });
    expect(repo.listActiveConflicts()).toHaveLength(0);
    expect(count("conflict_assessments")).toBe(1); // preserved as history, never silently erased
  });
});
