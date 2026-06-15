import { describe, expect, it } from "vitest";
import {
  buildCitations, createLlmAskAILanguageModel, generateClaimsFromEvidence, LlmSynthesisError,
  parseAndGroundClaims, understandQuestion, type AskAIEvidenceItem,
} from "../src/ask-ai/index.js";
import { ExternalLlmProvider, type LlmTransport } from "../src/llm/index.js";
import { MockLlmProvider } from "../src/llm/testing.js";

const SECRET = "sk-synth-PLANTED-SECRET-1234567890";
const QUESTION = "Is SQLite the source of truth?";
const query = understandQuestion(QUESTION);

const materialized = (overrides: Partial<AskAIEvidenceItem> = {}): AskAIEvidenceItem => ({
  evidencePointerId: "evp_1", sourcePointerId: "mv://source/transcript/tr_1/span/sp_1", transcriptId: "tr_1", spanId: "sp_1",
  quotePreview: "Alex: SQLite is the source of truth for the vault.", evidenceScore: 0.9, evidenceConfidence: "strong",
  scoringExplanation: "Direct raw span.", clickbackUri: "mv://evidence/evp_1", stance: "supports", sourceKind: "raw_transcript_span", ...overrides,
});

const DETERMINISTIC_FACT = "SQLite is the source of truth for the vault."; // defaultClaimText for "fact"

const llmReturning = (text: string) =>
  createLlmAskAILanguageModel(new MockLlmProvider({ completion: { provider: "mock", model: "mock", text, finishReason: "stop" } }));

const claimsJson = (claims: unknown[]) => JSON.stringify({ claims });

describe("parseAndGroundClaims", () => {
  const evidence = [materialized()];

  it("keeps a grounded claim and discards unanchored / unselected ones", () => {
    const grounded = parseAndGroundClaims(claimsJson([
      { kind: "fact", text: "SQLite is the source of truth.", evidencePointerIds: ["evp_1"], supportingQuote: "SQLite is the source of truth" },
      { kind: "fact", text: "cites unselected", evidencePointerIds: ["nope"], supportingQuote: "SQLite is the source of truth" },
      { kind: "fact", text: "quote not in snippet", evidencePointerIds: ["evp_1"], supportingQuote: "the moon is made of cheese" },
      { kind: "fact", text: "no quote", evidencePointerIds: ["evp_1"] },
      { kind: "bogus", text: "bad kind", evidencePointerIds: ["evp_1"], supportingQuote: "SQLite" },
    ]), evidence);
    expect(grounded).toEqual([{ kind: "fact", text: "SQLite is the source of truth.", evidencePointerIds: ["evp_1"], explanation: undefined }]);
  });

  it("throws LlmSynthesisError on malformed JSON or a missing claims array", () => {
    expect(() => parseAndGroundClaims("not json", evidence)).toThrow(LlmSynthesisError);
    expect(() => parseAndGroundClaims(JSON.stringify({ notClaims: [] }), evidence)).toThrow(LlmSynthesisError);
  });
});

describe("grounded LLM synthesis via generateClaimsFromEvidence", () => {
  const evidence = [materialized()];
  const citations = buildCitations(evidence);

  it("keeps a grounded LLM claim", async () => {
    const llm = llmReturning(claimsJson([
      { kind: "fact", text: "SQLite is the source of truth.", evidencePointerIds: ["evp_1"], supportingQuote: "SQLite is the source of truth" },
    ]));
    const claims = await generateClaimsFromEvidence(query, evidence, citations, { confidence: "strong", llm });
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ text: "SQLite is the source of truth.", evidencePointerIds: ["evp_1"], supportStatus: "supported" });
  });

  it("discards a claim that cites an unselected pointer (keeps the grounded one)", async () => {
    const llm = llmReturning(claimsJson([
      { kind: "fact", text: "SQLite is the source of truth.", evidencePointerIds: ["evp_1"], supportingQuote: "SQLite is the source of truth" },
      { kind: "fact", text: "Injected from elsewhere", evidencePointerIds: ["not-selected"], supportingQuote: "anything" },
    ]));
    const claims = await generateClaimsFromEvidence(query, evidence, citations, { confidence: "strong", llm });
    expect(claims).toHaveLength(1);
    expect(claims.map((c) => c.text)).not.toContain("Injected from elsewhere");
  });

  it("discards a claim whose supportingQuote is not in the cited snippet", async () => {
    const llm = llmReturning(claimsJson([
      { kind: "fact", text: "SQLite is the source of truth.", evidencePointerIds: ["evp_1"], supportingQuote: "SQLite is the source of truth" },
      { kind: "fact", text: "Hallucinated", evidencePointerIds: ["evp_1"], supportingQuote: "this phrase is not in the evidence" },
    ]));
    const claims = await generateClaimsFromEvidence(query, evidence, citations, { confidence: "strong", llm });
    expect(claims).toHaveLength(1);
    expect(claims.map((c) => c.text)).not.toContain("Hallucinated");
  });

  it("falls back to deterministic claims on malformed JSON", async () => {
    const claims = await generateClaimsFromEvidence(query, evidence, citations, { confidence: "strong", llm: llmReturning("definitely not json {{{") });
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.some((c) => c.text === DETERMINISTIC_FACT)).toBe(true);
  });

  it("falls back to deterministic claims when the LLM returns no grounded claims", async () => {
    const empty = await generateClaimsFromEvidence(query, evidence, citations, { confidence: "strong", llm: llmReturning(claimsJson([])) });
    expect(empty.some((c) => c.text === DETERMINISTIC_FACT)).toBe(true);
    const allDiscarded = await generateClaimsFromEvidence(query, evidence, citations, {
      confidence: "strong",
      llm: llmReturning(claimsJson([{ kind: "fact", text: "ungrounded", evidencePointerIds: ["evp_1"], supportingQuote: "not present here" }])),
    });
    expect(allDiscarded.some((c) => c.text === DETERMINISTIC_FACT)).toBe(true);
  });

  it("preserves the weak-evidence support status (the LLM cannot upgrade it)", async () => {
    const llm = llmReturning(claimsJson([
      { kind: "fact", text: "SQLite is the source of truth.", evidencePointerIds: ["evp_1"], supportingQuote: "SQLite is the source of truth" },
    ]));
    const claims = await generateClaimsFromEvidence(query, evidence, citations, { confidence: "weak", llm });
    expect(claims[0].supportStatus).toBe("weakly_supported");
  });
});

describe("conflict and refusal behavior is preserved regardless of the LLM", () => {
  it("uses the deterministic both-sides conflict path and never calls the LLM", async () => {
    const mock = new MockLlmProvider({ completion: { provider: "mock", model: "mock", text: claimsJson([]), finishReason: "stop" } });
    const llm = createLlmAskAILanguageModel(mock);
    const evidence = [
      materialized(),
      materialized({ evidencePointerId: "evp_2", spanId: "sp_2", quotePreview: "Sam: SQLite is not the source of truth.", clickbackUri: "mv://evidence/evp_2", stance: "opposes" }),
    ];
    const claims = await generateClaimsFromEvidence(query, evidence, buildCitations(evidence), { confidence: "conflicting", llm });
    expect(claims).toHaveLength(2);
    expect(mock.calls).toHaveLength(0); // conflict path is deterministic; the LLM is not invoked
  });

  it("still refuses (no claims) when the pipeline has no evidence, without calling the LLM", async () => {
    const mock = new MockLlmProvider({ completion: { provider: "mock", model: "mock", text: claimsJson([]), finishReason: "stop" } });
    const llm = createLlmAskAILanguageModel(mock);
    expect(await generateClaimsFromEvidence(query, [], [], { confidence: "strong", llm })).toEqual([]);
    expect(await generateClaimsFromEvidence(query, [materialized()], buildCitations([materialized()]), { confidence: "no_evidence", llm })).toEqual([]);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("API keys / provider internals never leak", () => {
  const evidence = [materialized()];
  const citations = buildCitations(evidence);
  const externalProvider = (transport: LlmTransport) => new ExternalLlmProvider({ id: "openai", model: "gpt-4o-mini", apiKey: SECRET, transport });

  it("does not expose the key in synthesized claims", async () => {
    const transport: LlmTransport = async () => ({
      status: 200,
      body: { choices: [{ message: { content: claimsJson([{ kind: "fact", text: "SQLite is the source of truth.", evidencePointerIds: ["evp_1"], supportingQuote: "SQLite is the source of truth" }]) }, finish_reason: "stop" }] },
    });
    const llm = createLlmAskAILanguageModel(externalProvider(transport));
    const claims = await generateClaimsFromEvidence(query, evidence, citations, { confidence: "strong", llm });
    expect(claims).toHaveLength(1);
    expect(JSON.stringify(claims)).not.toContain(SECRET);
  });

  it("does not expose the key in errors, and falls back deterministically on provider failure", async () => {
    const transport: LlmTransport = async () => ({ status: 401, body: { error: "bad key" } });
    const llm = createLlmAskAILanguageModel(externalProvider(transport));
    let thrown: unknown;
    try { await llm.generateClaims({ query, evidence }); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(LlmSynthesisError);
    expect(JSON.stringify({ message: (thrown as Error).message, str: String(thrown) })).not.toContain(SECRET);

    const claims = await generateClaimsFromEvidence(query, evidence, citations, { confidence: "strong", llm });
    expect(claims.some((c) => c.text === DETERMINISTIC_FACT)).toBe(true); // deterministic fallback
    expect(JSON.stringify(claims)).not.toContain(SECRET);
  });
});
