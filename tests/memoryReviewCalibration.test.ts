import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import { createSqliteFrontendApi } from "../src/frontend/index.js";
import { importTranscript } from "../src/ingest/index.js";
import {
  assessBodyQuoteSupport, createLlmMemoryExtractor, extractMemoryObjectsForTranscript, scoreCandidateConfidence,
  type ExtractedMemoryCandidate, type ExtractionWindow, type MemoryExtractor,
} from "../src/memory/extraction/index.js";
import { createLlmAskAILanguageModel } from "../src/ask-ai/index.js";
import { ExternalLlmProvider, type LlmTransport } from "../src/llm/index.js";
import { MockLlmProvider } from "../src/llm/testing.js";

// A grounded LLM extractor whose JSON is derived from the transcript span text, mirroring the live path
// (every candidate must anchor a supportingQuote to a cited in-window span). The candidate the test wants
// is parameterized per case; supportingQuote defaults to a phrase guaranteed to appear in the span.
const objectsJson = (objects: unknown[]) => JSON.stringify({ objects });
function llmExtractorFor(build: (spanId: string, text: string) => unknown[]): MemoryExtractor {
  return createLlmMemoryExtractor(new MockLlmProvider({
    completion: (req) => {
      const m = req.prompt.match(/\[span_id=(\S+) speaker=[^\]]*\]\n([^\n]+)/);
      return { provider: "mock", model: "mock", text: objectsJson(build(m?.[1] ?? "unknown", m?.[2] ?? "")), finishReason: "stop" };
    },
  }));
}

let db: SqliteDatabase;
beforeEach(() => { db = openDatabase(":memory:"); });
afterEach(() => db.close());

function importLine(rawText: string) {
  const imported = importTranscript(db, { filename: "cal.txt", rawText, sourceType: "test" });
  return imported.transcriptId;
}
const statusOf = (runId: string) => db.prepare("SELECT extraction_status FROM memory_objects WHERE extraction_run_id=? ORDER BY created_at LIMIT 1").get(runId) as { extraction_status: string } | undefined;

// Run the grounded LLM extractor over a transcript that contains exactly the given line, producing one
// decision-type candidate (title/body parameterized). Returns the stored status.
async function extractDecision(rawText: string, title: string, body: string): Promise<string | undefined> {
  const transcriptId = importLine(rawText);
  const extractor = llmExtractorFor((id, text) => [{ type: "decision", title, body, evidenceSpanIds: [id], supportingQuote: text }]);
  const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
  return statusOf(result.extractionRunId)?.extraction_status;
}

describe("memory review-status calibration: clear well-supported statements become active", () => {
  it("1. a clear repeated SQLite source-of-truth decision becomes active", async () => {
    expect(await extractDecision("Alex: We decided to use SQLite as the source of truth.", "Use SQLite as the source of truth", "We decided to use SQLite as the source of truth.")).toBe("active");
  });

  it("2. 'Generated Markdown is disposable' becomes active", async () => {
    const transcriptId = importLine("Alex: Generated Markdown is disposable and can be regenerated.");
    const extractor = llmExtractorFor((id, text) => [{ type: "topic", title: "Generated Markdown is disposable", body: "Generated Markdown is disposable.", evidenceSpanIds: [id], supportingQuote: text }]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    expect(statusOf(result.extractionRunId)?.extraction_status).toBe("active");
  });

  it("3. 'Raw transcripts cannot be edited after import' becomes active", async () => {
    expect(await extractDecision("Alex: Raw transcripts cannot be edited after import.", "Raw transcripts cannot be edited after import", "Raw transcripts cannot be edited after import.")).toBe("active");
  });

  it("4. 'Evidence should point back to exact transcript spans' becomes active", async () => {
    const transcriptId = importLine("Alex: Evidence should point back to exact transcript spans.");
    const extractor = llmExtractorFor((id, text) => [{ type: "advice_idea", title: "Evidence points back to exact transcript spans", body: "Evidence should point back to exact transcript spans.", evidenceSpanIds: [id], supportingQuote: text }]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    expect(statusOf(result.extractionRunId)?.extraction_status).toBe("active");
  });
});

describe("memory review-status calibration: uncertain cases need review", () => {
  it("5. an ambiguous restatement ('Decided using SQL') with medium confidence needs review", () => {
    // "SQL" may not mean "SQLite": a lossy restatement realistically lands at MEDIUM confidence and is
    // routed to review by the status policy, not auto-activated. (Driven by confidence, not a synonym map.)
    const spans = [{ transcriptId: "t", turnId: null, spanId: "s1", speaker: null, startOffset: 0, endOffset: 1, text: "Decided using SQL.", startTimeMs: null, endTimeMs: null }];
    const scored = scoreCandidateConfidence({ type: "decision", title: "SQL store", body: "Decided using SQL as the source of truth.", evidenceSpanIds: ["s1"], confidence: 0.55 } as ExtractedMemoryCandidate, spans);
    expect(scored.confidenceLabel).toBe("medium");
    expect(scored.status).toBe("needs_review");
  });

  it("6. a statement contradicting an existing active memory needs review (both sides preserved)", async () => {
    // First establish the active decision.
    expect(await extractDecision("Alex: We decided to use SQLite as the source of truth.", "Use SQLite as the source of truth", "We decided to use SQLite as the source of truth.")).toBe("active");
    // Now a directly-contradicting statement must NOT auto-activate.
    const transcriptId = importLine("Sam: We decided not to use SQLite as the source of truth.");
    const extractor = llmExtractorFor((id, text) => [{ type: "decision", title: "Do not use SQLite as the source of truth", body: "We decided not to use SQLite as the source of truth.", evidenceSpanIds: [id], supportingQuote: text }]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    expect(statusOf(result.extractionRunId)?.extraction_status).toBe("needs_review");
    // The original active memory is preserved (not deleted/merged).
    expect((db.prepare("SELECT COUNT(*) c FROM memory_objects WHERE extraction_status='active'").get() as { c: number }).c).toBe(1);
  });

  it("7. a tentative 'maybe PostgreSQL instead' statement needs review even when grounded", async () => {
    const transcriptId = importLine("Alex: Maybe we should use PostgreSQL as the source of truth instead.");
    const extractor = llmExtractorFor((id, text) => [{ type: "decision", title: "Switch to PostgreSQL", body: "Maybe we should use PostgreSQL as the source of truth instead.", evidenceSpanIds: [id], supportingQuote: text }]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    expect(statusOf(result.extractionRunId)?.extraction_status).toBe("needs_review");
  });

  it("8. a candidate produced from broken/missing evidence cannot become active", async () => {
    const transcriptId = importLine("Alex: We decided to use SQLite as the source of truth.");
    // The candidate cites a span that does not exist in the window -> grounding discards it -> nothing stored.
    const extractor = llmExtractorFor(() => [{ type: "decision", title: "Use SQLite", body: "We decided to use SQLite.", evidenceSpanIds: ["sp_missing"], supportingQuote: "use SQLite" }]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    expect(result.objectsInserted).toBe(0);
    expect((db.prepare("SELECT COUNT(*) c FROM memory_objects WHERE extraction_status='active'").get() as { c: number }).c).toBe(0);
  });

  it("the status policy maps high->active, medium->review, low->review/weak, tentative->review", () => {
    const span = [{ transcriptId: "t", turnId: null, spanId: "s1", speaker: null, startOffset: 0, endOffset: 1, text: "x", startTimeMs: null, endTimeMs: null }];
    const score = (c: Partial<ExtractedMemoryCandidate>) => scoreCandidateConfidence({ type: "decision", title: "Use SQLite as the source of truth", body: "We decided to use SQLite.", evidenceSpanIds: ["s1"], confidence: 0.9, ...c } as ExtractedMemoryCandidate, span);
    expect(score({}).status).toBe("active"); // high, direct
    expect(score({ confidence: 0.5 }).status).toBe("needs_review"); // medium
    expect(score({ confidence: 0.0 }).status).toBe("needs_review"); // low decision
    expect(score({ type: "topic", confidence: 0.0 }).status).toBe("weak"); // low non-decision
    expect(score({ body: "Maybe we should use SQLite." }).status).toBe("needs_review"); // tentative overrides high
  });
});

describe("body-to-quote support guard (deterministic)", () => {
  const status = (body: string, quote: string) => assessBodyQuoteSupport(body, quote).status;

  it("1. exact quote/body match -> strong", () => {
    expect(status("We decided to use SQLite as the source of truth.", "We decided to use SQLite as the source of truth.")).toBe("strong");
  });

  it("2. faithful short paraphrase -> strong", () => {
    expect(status("We use SQLite as the source of truth.", "We decided to use SQLite as the source of truth for the vault.")).toBe("strong");
  });

  it("3. 'should be immutable' -> 'cannot be edited' -> strong (safe allowance)", () => {
    expect(status("Raw transcripts cannot be edited after import.", "Raw transcripts should be immutable after import.")).toBe("strong");
  });

  it("4. 'only a disposable view' -> 'disposable' -> strong (safe allowance)", () => {
    expect(status("Generated Markdown is disposable.", "Generated Markdown is only a disposable view.")).toBe("strong");
  });

  it("5. an unrelated claim introduced by the body -> unsupported", () => {
    expect(status("SQLite is the source of truth.", "Generated Markdown is disposable.")).toBe("unsupported");
  });

  it("6. discussed -> decided commitment mismatch -> unsupported", () => {
    expect(status("We decided to use SQLite.", "We discussed using SQLite.")).toBe("unsupported");
  });

  it("7. maybe/proposed -> decided/will commitment mismatch -> unsupported", () => {
    expect(status("We will use SQLite.", "We proposed maybe using SQLite.")).toBe("unsupported");
  });

  it("8. negation mismatch (not use vs use) -> unsupported", () => {
    expect(status("We decided to use SQLite.", "We decided not to use SQLite.")).toBe("unsupported");
  });

  it("9. person mismatch (Sam vs Alex) -> unsupported", () => {
    expect(status("Alex needs onboarding docs.", "Sam needs onboarding docs.")).toBe("unsupported");
  });

  it("10. SQL vs SQLite does not auto-pass unless the exact quote supports it", () => {
    expect(status("SQL is the source of truth.", "SQLite is the source of truth.")).toBe("unsupported");
    expect(status("SQLite is the source of truth.", "SQL is the source of truth.")).toBe("unsupported");
    // Only an exact-token match passes.
    expect(status("SQLite is the source of truth.", "SQLite is the source of truth.")).toBe("strong");
  });
});

describe("body-to-quote guard blocks unsupported auto-activation end-to-end", () => {
  it("an unrelated body (high confidence, non-tentative) is routed to review, not active", async () => {
    const transcriptId = importLine("Alex: Generated Markdown is disposable.");
    const extractor = llmExtractorFor((id, text) => [{ type: "decision", title: "SQLite is the source of truth", body: "SQLite is the source of truth.", evidenceSpanIds: [id], supportingQuote: text }]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    expect(statusOf(result.extractionRunId)?.extraction_status).toBe("needs_review");
  });

  it("a discussed->decided body is routed to review, not active", async () => {
    const transcriptId = importLine("Alex: We discussed using SQLite.");
    const extractor = llmExtractorFor((id, text) => [{ type: "decision", title: "Use SQLite", body: "We decided to use SQLite.", evidenceSpanIds: [id], supportingQuote: text }]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    expect(statusOf(result.extractionRunId)?.extraction_status).toBe("needs_review");
  });
});

describe("memory review-status calibration: review queue hygiene", () => {
  it("9. the review queue does not list normal active memories as needing approval", async () => {
    expect(await extractDecision("Alex: We decided to use SQLite as the source of truth.", "Use SQLite as the source of truth", "We decided to use SQLite as the source of truth.")).toBe("active");
    const reviewItems = await createSqliteFrontendApi(db).listReviewItems();
    expect(reviewItems.some((item) => item.type === "memory_needs_review")).toBe(false);

    // A genuinely uncertain (tentative) memory DOES surface for review.
    const transcriptId = importLine("Alex: Maybe we should use PostgreSQL instead.");
    const extractor = llmExtractorFor((id, text) => [{ type: "decision", title: "Switch to PostgreSQL", body: "Maybe we should use PostgreSQL instead.", evidenceSpanIds: [id], supportingQuote: text }]);
    await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    const after = await createSqliteFrontendApi(db).listReviewItems();
    expect(after.some((item) => item.type === "memory_needs_review")).toBe(true);
  });
});

describe("calibration pass 2: grounded non-decision types and faithful wording auto-activate", () => {
  it("a grounded topic with a short specific title becomes active (type/title no longer double-penalize)", async () => {
    const transcriptId = importLine("Alex: Vector spaces must never be mixed across providers.");
    const extractor = llmExtractorFor((id, text) => [{ type: "topic", title: "Vector spaces", body: "Vector spaces must never be mixed across providers.", evidenceSpanIds: [id], supportingQuote: text }]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    expect(statusOf(result.extractionRunId)?.extraction_status).toBe("active");
  });

  it("a grounded question becomes active when verbatim-supported", async () => {
    const transcriptId = importLine("Sam: Should citations link back to exact transcript spans?");
    const extractor = llmExtractorFor((id, text) => [{ type: "question", title: "Citation spans", body: "Should citations link back to exact transcript spans?", evidenceSpanIds: [id], supportingQuote: text }]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    expect(statusOf(result.extractionRunId)?.extraction_status).toBe("active");
  });

  it("a faithful light paraphrase (clean blockers, ~0.67 coverage) is strong -> active", () => {
    // Two benign uncovered tokens ("data", "vault"); negation/commitment/entities/numbers all clean.
    // Coverage 4/6 ≈ 0.67 — this used to be "uncertain" (band started at 0.75) and forced review.
    expect(assessBodyQuoteSupport("We will keep the provenance data visible in the vault.", "We will keep provenance visible.").status).toBe("strong");
  });

  it("plural/singular wording differences no longer break coverage (stemming is comparison-only)", () => {
    expect(assessBodyQuoteSupport("Generated Markdown views are disposable.", "Each generated Markdown view is disposable.").status).toBe("strong");
  });
});

describe("calibration pass 2: overbroad/number-introducing claims still need review", () => {
  it("a body that broadens the claim with quantifiers/absolutes is blocked from auto-activation", async () => {
    const support = assessBodyQuoteSupport("We will always use SQLite for everything.", "We will use SQLite.");
    expect(support.status).toBe("unsupported");
    expect(support.reasons.join(" ")).toMatch(/broadens the claim/i);
    // End-to-end: high-confidence, non-tentative, but overbroad -> needs_review with the reason persisted.
    const transcriptId = importLine("Alex: We will use SQLite.");
    const extractor = llmExtractorFor((id, text) => [{ type: "decision", title: "Always use SQLite", body: "We will always use SQLite for everything.", evidenceSpanIds: [id], supportingQuote: text }]);
    const result = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    expect(statusOf(result.extractionRunId)?.extraction_status).toBe("needs_review");
    const meta = db.prepare("SELECT metadata_json FROM memory_objects WHERE extraction_run_id=?").get(result.extractionRunId) as { metadata_json: string };
    expect(JSON.parse(meta.metadata_json).review_reason).toMatch(/broadens the claim/i);
  });

  it("a body that introduces a number absent from the quote is blocked from auto-activation", () => {
    const support = assessBodyQuoteSupport("The deadline is in 3 days for the migration work.", "The deadline for the migration work is soon.");
    expect(support.status).toBe("unsupported");
    expect(support.reasons.join(" ")).toMatch(/numbers absent/i);
  });
});

describe("calibration pass 2: the review queue explains WHY an item needs review", () => {
  it("tentative wording surfaces its reason in the review item detail", async () => {
    const transcriptId = importLine("Alex: Maybe we should use PostgreSQL instead.");
    const extractor = llmExtractorFor((id, text) => [{ type: "decision", title: "Switch to PostgreSQL", body: "Maybe we should use PostgreSQL instead.", evidenceSpanIds: [id], supportingQuote: text }]);
    await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    const item = (await createSqliteFrontendApi(db).listReviewItems()).find((entry) => entry.type === "memory_needs_review");
    expect(item?.detail).toMatch(/tentative|hedged/i);
  });

  it("an unsupported-body demotion surfaces the support-gate reason", async () => {
    const transcriptId = importLine("Alex: Generated Markdown is disposable.");
    const extractor = llmExtractorFor((id, text) => [{ type: "decision", title: "SQLite is the source of truth", body: "SQLite is the source of truth.", evidenceSpanIds: [id], supportingQuote: text }]);
    await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    const item = (await createSqliteFrontendApi(db).listReviewItems()).find((entry) => entry.type === "memory_needs_review");
    expect(item?.detail).toMatch(/not strongly supported/i);
  });

  it("a near-duplicate surfaces the possible-duplicate reason", async () => {
    expect(await extractDecision("Alex: We decided to use SQLite as the source of truth.", "Use SQLite as the source of truth", "We decided to use SQLite as the source of truth.")).toBe("active");
    const transcriptId = importLine("Sam: We decided to use SQLite as our source of truth going forward.");
    const extractor = llmExtractorFor((id, text) => [{ type: "decision", title: "Use SQLite as the source of truth", body: "We decided to use SQLite as our source of truth going forward.", evidenceSpanIds: [id], supportingQuote: text }]);
    await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    const duplicates = (await createSqliteFrontendApi(db).listReviewItems()).filter((entry) => entry.type === "memory_needs_review");
    if (duplicates.length) expect(duplicates.some((entry) => /duplicate/i.test(entry.detail))).toBe(true);
  });
});

describe("calibration pass 2: review volume for a realistic grounded batch", () => {
  it("most clearly-grounded items activate; only genuinely uncertain ones remain for review", async () => {
    const RAW = [
      "Alex: Let's confirm the architecture for the transcript memory vault.",
      "Sam: The main rule is that SQLite is the source of truth.",
      "Alex: Agreed. We decided to use SQLite as the source of truth.",
      "Sam: I will write the onboarding documentation before launch.",
      "Alex: The deadline for the migration work is Friday.",
      "Sam: Maybe we should consider Postgres later for scale.",
      "Alex: Action item: Sam owns the embedding reindex command documentation.",
    ].join("\n");
    const imported = importTranscript(db, { filename: "batch.txt", rawText: RAW, sourceType: "test" });
    const extractor: MemoryExtractor = {
      kind: "llm", model: "mock", promptVersion: "cal2",
      async extract(window) {
        const mk = (type: string, title: string, frag: string) => {
          const span = window.spans.find((s) => s.text.includes(frag));
          // Source-close body (prompt v2 behavior): reuse the span's own wording minus the speaker label.
          return span ? [{ type: type as never, title, body: span.text.replace(/^[^:]{1,60}:\s*/, "").replace(/^Agreed\.\s*/, "").replace(/^Action item:\s*/i, ""), evidenceSpanIds: [span.spanId], confidence: 0.9 }] : [];
        };
        return [
          ...mk("decision", "Use SQLite as source of truth", "We decided to use SQLite"),
          ...mk("action_item", "Write onboarding documentation", "onboarding documentation before launch"),
          ...mk("decision", "Migration deadline is Friday", "deadline for the migration"),
          ...mk("advice_idea", "Consider Postgres later", "consider Postgres"),
          ...mk("action_item", "Reindex docs ownership", "embedding reindex command"),
        ];
      },
    };
    await extractMemoryObjectsForTranscript(db, { transcriptId: imported.transcriptId, extractor });
    const statuses = db.prepare("SELECT extraction_status st, COUNT(*) c FROM memory_objects GROUP BY extraction_status").all() as Array<{ st: string; c: number }>;
    const byStatus = Object.fromEntries(statuses.map((row) => [row.st, row.c]));
    expect(byStatus.active ?? 0).toBe(4); // all clearly grounded items auto-activate
    expect(byStatus.needs_review ?? 0).toBe(1); // ONLY the tentative "maybe consider Postgres" needs review
  });
});

describe("calibration pass 2: auto-activated memory is usable by Ask AI without manual approval", () => {
  it("upload -> auto-active -> bridged evidence -> grounded cited answer (no review step)", async () => {
    const extractionTransport: LlmTransport = async (req) => {
      const messages = (JSON.parse(req.body) as { messages: Array<{ content: string }> }).messages;
      const m = messages[messages.length - 1].content.match(/\[span_id=(\S+) speaker=[^\]]*\]\n([^\n]+)/);
      const spanId = m?.[1] ?? "unknown", text = (m?.[2] ?? "").trim();
      // Clear, non-tentative, source-close body -> auto-activates under the calibrated policy.
      const content = JSON.stringify({ objects: [{ type: "decision", title: "Use SQLite as the source of truth", body: "We decided to use SQLite as the source of truth.", evidenceSpanIds: [spanId], supportingQuote: text }] });
      return { status: 200, body: { choices: [{ message: { content }, finish_reason: "stop" }] } };
    };
    const synthesisTransport: LlmTransport = async (req) => {
      const messages = (JSON.parse(req.body) as { messages: Array<{ content: string }> }).messages;
      const m = messages[messages.length - 1].content.match(/pointerId:\s*(\S+)\n\s*quote:\s*(.+)/);
      const content = JSON.stringify({ claims: [{ kind: "fact", text: "SQLite is the source of truth.", evidencePointerIds: [m?.[1] ?? "unknown"], supportingQuote: (m?.[2] ?? "").trim(), explanation: "From the cited span." }] });
      return { status: 200, body: { choices: [{ message: { content }, finish_reason: "stop" }] } };
    };
    const api = createSqliteFrontendApi(db, {
      llmRequired: true, getLlmReady: () => true,
      getMemoryExtractor: () => createLlmMemoryExtractor(new ExternalLlmProvider({ id: "openai", model: "gpt-extract", apiKey: "sk-cal2-PLANTED-TEST-KEY-123456", transport: extractionTransport })),
      getSynthesis: () => ({ llm: createLlmAskAILanguageModel(new ExternalLlmProvider({ id: "openai", model: "gpt-synth", apiKey: "sk-cal2-PLANTED-TEST-KEY-123456", transport: synthesisTransport })), info: { mode: "external_llm", provider: "openai", model: "gpt-synth", usedFallback: false } }),
    });
    const uploaded = await api.uploadTranscript({ filename: "auto.txt", rawText: "Alex: We decided to use SQLite as the source of truth." });
    // Auto-activated (no review step) and bridged to evidence pointers (Policy A: active memory only).
    const memory = db.prepare("SELECT extraction_status FROM memory_objects LIMIT 1").get() as { extraction_status: string };
    expect(memory.extraction_status).toBe("active");
    expect((db.prepare("SELECT COUNT(*) c FROM evidence_pointers").get() as { c: number }).c).toBeGreaterThan(0);
    expect((await api.listReviewItems()).some((item) => item.type === "memory_needs_review")).toBe(false);
    // Ask AI can answer from the auto-activated memory, with citations.
    const answer = await api.ask("What is the source of truth?");
    expect(answer.notEnoughEvidence).toBe(false);
    expect(answer.claims.length).toBeGreaterThan(0);
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(uploaded.status).toBe("imported");
  });
});

// Guard: nothing here mutates raw transcript text.
describe("memory review-status calibration: raw transcript immutability", () => {
  it("never edits raw transcript text while extracting/activating", async () => {
    const transcriptId = importLine("Alex: We decided to use SQLite as the source of truth.");
    const before = (db.prepare("SELECT raw_text FROM transcripts WHERE id=?").get(transcriptId) as { raw_text: string }).raw_text;
    const extractor = llmExtractorFor((id, text) => [{ type: "decision", title: "Use SQLite as the source of truth", body: "We decided to use SQLite.", evidenceSpanIds: [id], supportingQuote: text }]);
    await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
    expect((db.prepare("SELECT raw_text FROM transcripts WHERE id=?").get(transcriptId) as { raw_text: string }).raw_text).toBe(before);
    void createRepositories(db); // sanity: repositories construct against the post-extraction db
  });
});
