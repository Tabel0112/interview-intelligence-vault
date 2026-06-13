import { describe, expect, it } from "vitest";
import {
  calculateRecencyScore, calculateRepetitionScore, classifyEvidenceStrength, deduplicateEvidenceCandidates,
  scoreEvidenceBundle, scoreEvidenceCandidate, type EvidenceCandidate, type EvidenceScoringInput,
} from "../src/evidence/index.js";

const now = "2026-06-12T12:00:00.000Z";
const candidate = (overrides: Partial<EvidenceCandidate> = {}): EvidenceCandidate => ({
  id: overrides.id ?? "e1",
  transcriptId: "t1",
  spanIds: ["s1"],
  quote: "Alex: SQLite is the source of truth for the vault.",
  sourceKind: "raw_transcript_span",
  createdAt: "2026-06-10T12:00:00.000Z",
  retrievalScore: 0.95,
  vectorScore: 0.9,
  keywordScore: 0.95,
  stance: "supports",
  sourceConfidence: 0.95,
  ...overrides,
});
const input = (overrides: Partial<EvidenceScoringInput> = {}): EvidenceScoringInput => ({
  claimText: "SQLite is the source of truth for the vault",
  useType: "direct_fact",
  candidates: [candidate()],
  now,
  ...overrides,
});

describe("evidence scoring components and hard gates", () => {
  it("scores direct source-backed facts strongly and explains the result", () => {
    const result = scoreEvidenceBundle(input());
    expect(result).toMatchObject({ strength: "strong", hasConflict: false, hasNoEvidence: false });
    expect(result.bestSupportingEvidence[0].components).toMatchObject({ directness: 0.95, sourceStrength: 0.95 });
    expect(result.explanation).toContain("Strong evidence");
  });

  it("does not allow missing provenance, generated-only content, or vector-only vague matches to become strong", () => {
    const missing = scoreEvidenceBundle(input({ candidates: [candidate({ spanIds: [], evidencePointerId: undefined })] }));
    const generated = scoreEvidenceBundle(input({ candidates: [candidate({ sourceKind: "generated_summary_with_pointers", spanIds: [] })] }));
    const unvalidatedGenerated = scoreEvidenceBundle(input({ candidates: [candidate({ sourceKind: "generated_summary_with_pointers" })] }));
    const vectorOnly = scoreEvidenceBundle(input({ candidates: [candidate({ quote: "A nearby general topic.", retrievalScore: undefined, keywordScore: undefined, vectorScore: 1 })] }));
    expect(missing.strength).toBe("no_evidence");
    expect(generated.strength).toBe("no_evidence");
    expect(unvalidatedGenerated.strength).toBe("no_evidence");
    expect(vectorOnly.strength).toBe("weak");
  });

  it.each([
    "generated_summary_with_pointers",
    "memory_object_with_pointers",
    "graph_edge_with_pointers",
    "answer_claim_with_pointers",
  ] as const)("allows %s evidence only after its quote is validated against a raw span", (sourceKind) => {
    const rejected = scoreEvidenceBundle(input({ candidates: [candidate({ sourceKind, evidencePointerId: "p1" })] }));
    const validated = scoreEvidenceBundle(input({ candidates: [candidate({ sourceKind, evidencePointerId: "p1", provenanceValidated: true })] }));
    expect(rejected.strength).toBe("no_evidence");
    expect(validated.strength).not.toBe("no_evidence");
    expect(validated.scoredEvidence[0].caps.reasons).not.toContain("Generated-object evidence was not validated against a raw transcript span");
  });

  it("caps generic evidence for a specific claim and excludes rejected or superseded corrections", () => {
    const generic = scoreEvidenceBundle(input({ requiredSpecificityTerms: ["seven", "157"], claimText: "The user bought seven positions at 157", candidates: [candidate({ quote: "The user discussed investing.", retrievalScore: 0.9 })] }));
    const rejected = scoreEvidenceBundle(input({ candidates: [candidate({ sourceKind: "user_correction", userCorrectionStatus: "rejected", spanIds: [] })] }));
    const superseded = scoreEvidenceBundle(input({ candidates: [candidate({ sourceKind: "user_correction", userCorrectionStatus: "superseded", spanIds: [] })] }));
    expect(generic.strength).toBe("weak");
    expect(rejected.strength).toBe("no_evidence");
    expect(superseded.strength).toBe("no_evidence");
  });

  it("treats a confirmed user correction as strong traceable evidence", () => {
    const result = scoreEvidenceBundle(input({ candidates: [candidate({ sourceKind: "user_correction", userCorrectionStatus: "confirmed", isUserCorrection: true, spanIds: [], sourceConfidence: 1 })] }));
    expect(result.strength).toBe("strong");
    expect(result.bestSupportingEvidence[0].components.correctionWeight).toBe(1);
  });

  it("deduplicates pointers, spans, and normalized quotes before repetition scoring", () => {
    const first = candidate({ id: "one", evidencePointerId: "p1" });
    const sameSpan = candidate({ id: "two", evidencePointerId: "p2" });
    const separate = candidate({ id: "three", evidencePointerId: "p3", spanIds: ["s2"], quote: "Sam: SQLite is the source of truth for the vault." });
    expect(deduplicateEvidenceCandidates([first, sameSpan, separate]).map((item) => item.id)).toEqual(["one", "three"]);
    expect(calculateRepetitionScore(first, [first, sameSpan, separate], "pattern")).toBe(0.78);
  });

  it("uses deterministic recency decay and score caps", () => {
    expect(calculateRecencyScore(candidate({ createdAt: "2026-06-01T00:00:00Z" }), now, "recommendation")).toBe(0.8);
    expect(calculateRecencyScore(candidate({ createdAt: "2025-01-01T00:00:00Z" }), now, "recommendation")).toBe(0.4);
    expect(classifyEvidenceStrength(0.99, { maxStrength: "weak", reasons: ["gate"] })).toBe("weak");
  });
});

describe("evidence bundle classification", () => {
  it("returns no evidence and weak evidence deterministically", () => {
    expect(scoreEvidenceBundle(input({ candidates: [] })).strength).toBe("no_evidence");
    const weak = scoreEvidenceBundle(input({ candidates: [candidate({ quote: "SQLite was mentioned.", retrievalScore: 0.3, vectorScore: 0.4, keywordScore: 0.3, sourceConfidence: 0.4 })] }));
    expect(weak.strength).toBe("weak");
  });

  it("requires independent repetition for patterns", () => {
    const one = scoreEvidenceBundle(input({ useType: "pattern", candidates: [candidate()] }));
    const repeated = scoreEvidenceBundle(input({ useType: "pattern", candidates: [
      candidate({ id: "p1", spanIds: ["s1"] }),
      candidate({ id: "p2", transcriptId: "t2", spanIds: ["s2"], quote: "Sam: SQLite is the source of truth for the vault." }),
    ] }));
    expect(one.strength).toBe("weak");
    expect(repeated.strength).toBe("strong");
  });

  it("requires multiple explainable supports for inferences", () => {
    const one = scoreEvidenceBundle(input({ useType: "inference", candidates: [candidate()] }));
    const multiple = scoreEvidenceBundle(input({ useType: "inference", candidates: [
      candidate({ id: "i1", spanIds: ["s1"] }),
      candidate({ id: "i2", spanIds: ["s2"], quote: "Sam: SQLite is the source of truth for the vault." }),
    ] }));
    expect(one.strength).toBe("weak");
    expect(multiple.strength).toBe("strong");
    expect(multiple.explanation).toContain("Strong evidence");
    expect(multiple.explanation).toContain("inference");
  });

  it("returns conflicting for comparable opposition and mixed for qualifications or explicit updates", () => {
    const opposing = candidate({ id: "opp", spanIds: ["s2"], stance: "opposes", quote: "Sam: SQLite is not the source of truth for the vault." });
    const conflict = scoreEvidenceBundle(input({ candidates: [candidate(), opposing] }));
    const qualified = scoreEvidenceBundle(input({ candidates: [candidate(), candidate({ id: "q", spanIds: ["s3"], stance: "qualifies", quote: "SQLite is the source of truth only for the MVP vault." })] }));
    const updated = scoreEvidenceBundle(input({ candidates: [opposing, candidate({ id: "u", spanIds: ["s4"], stance: "updates", createdAt: "2026-06-12T00:00:00Z" })] }));
    expect(conflict.strength).toBe("conflicting");
    expect(conflict.bestOpposingEvidence).toHaveLength(1);
    expect(qualified.strength).toBe("mixed");
    expect(updated.strength).toBe("mixed");
  });

  it("scores current source-backed recommendations and rejects unpersonalized ones", () => {
    const recommendation = scoreEvidenceBundle(input({ useType: "recommendation", candidates: [candidate({ quote: "Alex: I prefer SQLite as the source of truth for the vault." })] }));
    const absent = scoreEvidenceBundle(input({ useType: "recommendation", candidates: [candidate({ quote: "A database exists somewhere.", retrievalScore: 0.2, vectorScore: 0.2, keywordScore: 0.1 })] }));
    expect(recommendation.strength).toBe("strong");
    expect(absent.strength).toBe("weak");
  });

  it("produces identical output for fixed input and now", () => {
    expect(scoreEvidenceBundle(input())).toEqual(scoreEvidenceBundle(input()));
    expect(scoreEvidenceCandidate(candidate(), { ...input(), allCandidates: [candidate()] })).toEqual(scoreEvidenceCandidate(candidate(), { ...input(), allCandidates: [candidate()] }));
  });
});
