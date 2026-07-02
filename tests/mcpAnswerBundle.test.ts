import { describe, expect, it } from "vitest";
import { understandQuestion, type AskAIResponse, type EvidenceConfidence } from "../src/ask-ai/index.js";
import { toAnswerBundle } from "../src/mcp/answerBundle.js";

const now = () => new Date("2026-07-01T12:00:00.000Z");

// Build a synthetic AskAIResponse for a given evidence confidence. Mirrors how synthesis labels claims:
// strong/mixed -> "supported", weak -> "weakly_supported", conflicting -> "conflicting", no_evidence -> no claims.
function responseFor(confidence: EvidenceConfidence): AskAIResponse {
  const hasEvidence = confidence !== "no_evidence";
  const supportStatus = confidence === "conflicting" ? "conflicting" : confidence === "weak" ? "weakly_supported" : "supported";
  return {
    id: "ask_1", question: "What did we decide?", answerMarkdown: "Answer", evidenceConfidence: confidence,
    suggestedFollowups: [], notEnoughEvidence: !hasEvidence, createdAt: now().toISOString(),
    queryUnderstanding: understandQuestion("What did we decide?"), conflicts: [],
    claims: hasEvidence ? [{ id: "claim_1", kind: "fact", text: "We decided X.", supportStatus, evidencePointerIds: ["evp_1"], citationIds: ["cit_1"] }] : [],
    citations: hasEvidence ? [{ id: "cit_1", label: "[1]", evidencePointerId: "evp_1", transcriptId: "tr_1", spanId: "sp_1", quotePreview: "Source", clickbackUri: "mv://evidence/evp_1" }] : [],
    evidence: hasEvidence ? [{ evidencePointerId: "evp_1", transcriptId: "tr_1", spanId: "sp_1", quotePreview: "Source", evidenceScore: 0.6, evidenceConfidence: confidence, scoringExplanation: "Traceable", clickbackUri: "mv://evidence/evp_1", stance: confidence === "conflicting" ? "opposes" : "supports", sourceKind: "raw_transcript_span" }] : [],
  };
}

describe("MCP AnswerBundle surfaces mixed evidence (Pass B)", () => {
  it("mixed evidence produces a top-level warning indicating partial challenge (not a full contradiction)", () => {
    const bundle = toAnswerBundle(responseFor("mixed"));
    expect(bundle.evidence_confidence).toBe("mixed");
    const mixedWarning = bundle.warnings.find((w) => /mixed/i.test(w));
    expect(mixedWarning, "expected a mixed-evidence warning").toBeDefined();
    expect(mixedWarning!).toMatch(/qualify|partially challenge|not.*fully/i); // communicates partial challenge
    expect(mixedWarning!).toMatch(/inspect|citation|evidence/i); // points the user to the evidence
    // A mixed answer must not read as a full contradiction unless it is actually `conflicting`.
    expect(mixedWarning!.toLowerCase()).not.toContain("sources conflict");
    expect(mixedWarning!.toLowerCase()).not.toContain("contradict");
  });

  it("mixed no longer renders as cleanly supported with zero warnings — the claim carries a caution", () => {
    const bundle = toAnswerBundle(responseFor("mixed"));
    expect(bundle.warnings.length).toBeGreaterThan(0);
    const claim = bundle.claims[0];
    // support_state is unchanged (synthesis-owned) but the claim now carries a mixed caution warning.
    expect(claim.support_state).toBe("supported");
    expect(claim.warning, "expected a per-claim mixed caution").toBeDefined();
    expect(claim.warning!).toMatch(/mixed|qualify|partially challenge/i);
  });

  it("a strong answer stays clean — supported claim, no mixed warning", () => {
    const bundle = toAnswerBundle(responseFor("strong"));
    expect(bundle.claims[0].support_state).toBe("supported");
    expect(bundle.claims[0].warning).toBeUndefined(); // strong support carries no caution
    expect(bundle.warnings.some((w) => /mixed/i.test(w))).toBe(false);
  });

  it("preserves existing warnings for weak, conflicting, and no_evidence", () => {
    expect(toAnswerBundle(responseFor("weak")).warnings.some((w) => /weak/i.test(w))).toBe(true);
    expect(toAnswerBundle(responseFor("conflicting")).warnings.some((w) => /conflict/i.test(w))).toBe(true);
    const refusal = toAnswerBundle(responseFor("no_evidence"));
    expect(refusal.warnings.some((w) => /refusal, not an answer/i.test(w))).toBe(true);
    // Those states must NOT gain the mixed warning.
    for (const state of ["weak", "conflicting", "no_evidence"] as const) {
      expect(toAnswerBundle(responseFor(state)).warnings.some((w) => /some sources support this answer while others qualify/i.test(w))).toBe(false);
    }
  });
});
