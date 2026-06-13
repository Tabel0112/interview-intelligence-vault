import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type SqliteDatabase } from "../src/db/index.js";
import {
  applyHermesDefaultFilters, applyHermesRankingHints, assertHermesOnlyChangedPresentationOrAllowedRanking,
  buildSuggestedFollowups, createHermesRepository, formatAnswerWithHermesStyle,
} from "../src/hermes/index.js";

const fixedNow = () => new Date("2026-06-12T12:00:00.000Z");

describe("Hermes personalization and trust boundaries", () => {
  let db: SqliteDatabase;
  beforeEach(() => { db = openDatabase(":memory:"); });
  afterEach(() => db.close());

  it("persists profiles, labels, topics, filters, styles, follow-ups, and append-only correction history", () => {
    const repo = createHermesRepository(db, { now: fixedNow });
    repo.createDefaultHermesProfile("user");
    repo.upsertAnswerStyle("user", { verbosity: "detailed", tone: "technical", citationDensity: "high", showUncertainty: true });
    repo.upsertDefaultFilters("user", { transcriptIds: ["default"], labels: ["project"] });
    repo.upsertRankingPreferences("user", { preferredTopics: ["SQLite"] });
    repo.upsertFollowupPreferences("user", { includeSuggestedFollowups: true, maxFollowups: 1, preferProjectContinuations: true });
    repo.upsertLabelPreference("user", { label: "decision", priority: 2 });
    repo.upsertTopicProfile("user", { topic: "SQLite", weight: 0.9, source: "explicit_user_preference" });
    const correction = repo.recordCorrectionHistory("user", { targetType: "claim", targetId: "claim_1", correctionType: "factual_correction", summary: "User corrected a claim." });
    const profile = repo.getHermesProfile("user")!;
    expect(profile).toMatchObject({ answerStyle: { tone: "technical" }, labels: [{ label: "decision" }], topics: [{ topic: "SQLite" }] });
    expect(repo.listCorrectionHistory("user")).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) count FROM evidence_pointers").get()).toEqual({ count: 0 });
    expect(() => db.prepare("DELETE FROM hermes_correction_history WHERE id=?").run(correction)).toThrow();
  });

  it("merges defaults without overriding explicit filters and limits follow-ups", () => {
    const repo = createHermesRepository(db);
    let profile = repo.createDefaultHermesProfile("user");
    profile = repo.upsertDefaultFilters("user", { transcriptIds: ["default"], labels: ["preferred"] });
    profile = repo.upsertFollowupPreferences("user", { includeSuggestedFollowups: true, maxFollowups: 1, preferProjectContinuations: false });
    const filtered = applyHermesDefaultFilters({ transcriptIds: ["explicit"] }, profile);
    expect(filtered.filters).toMatchObject({ transcriptIds: ["explicit"], labels: ["preferred"] });
    expect(buildSuggestedFollowups("answer", [{}], profile).followups).toHaveLength(1);
  });

  it("reorders only close candidates without changing scores or suppressing opposition", () => {
    const repo = createHermesRepository(db);
    const profile = repo.upsertTopicProfile("user", { topic: "SQLite", weight: 1, source: "explicit_user_preference" });
    const candidates = [
      { targetType: "evidence_pointer" as const, targetId: "a", textPreview: "Other topic", finalScore: 0.8, matchReasons: [], evidencePointerIds: ["a"], sourcePointerIds: [], supportRole: "opposing" as const },
      { targetType: "evidence_pointer" as const, targetId: "b", textPreview: "SQLite topic", finalScore: 0.78, matchReasons: [], evidencePointerIds: ["b"], sourcePointerIds: [], supportRole: "supporting" as const },
      { targetType: "evidence_pointer" as const, targetId: "c", textPreview: "SQLite low", finalScore: 0.5, matchReasons: [], evidencePointerIds: ["c"], sourcePointerIds: [] },
    ];
    const ranked = applyHermesRankingHints(candidates, profile).candidates;
    expect(ranked.map((item) => item.targetId)).toEqual(["b", "a", "c"]);
    expect(ranked.map((item) => item.finalScore).sort()).toEqual(candidates.map((item) => item.finalScore).sort());
    expect(ranked.some((item) => item.supportRole === "opposing")).toBe(true);
  });

  it("allows presentation changes but rejects score, warning, support, pointer, and conflict manipulation", () => {
    const profile = createHermesRepository(db).upsertAnswerStyle("user", { verbosity: "short", tone: "technical", citationDensity: "normal", showUncertainty: true });
    const before = { answerMarkdown: "The evidence is weak and conflicts.", evidenceConfidence: "weak", evidence: [{ evidencePointerId: "ev_1", evidenceScore: 0.4, stance: "opposes" }], conflicts: [{ id: "conf_1" }], claims: [{ id: "claim_1", support: "weak" }] };
    const styled = formatAnswerWithHermesStyle(before.answerMarkdown, profile);
    expect(() => assertHermesOnlyChangedPresentationOrAllowedRanking(before, { ...before, answerMarkdown: styled.answer })).not.toThrow();
    expect(() => assertHermesOnlyChangedPresentationOrAllowedRanking(before, { ...before, evidenceConfidence: "strong" })).toThrow();
    expect(() => assertHermesOnlyChangedPresentationOrAllowedRanking(before, { ...before, evidence: [{ ...before.evidence[0], evidenceScore: 1 }] })).toThrow();
    expect(() => assertHermesOnlyChangedPresentationOrAllowedRanking(before, { ...before, evidence: [] })).toThrow();
    expect(() => assertHermesOnlyChangedPresentationOrAllowedRanking(before, { ...before, answerMarkdown: "Looks good." })).toThrow();
    expect(() => assertHermesOnlyChangedPresentationOrAllowedRanking(before, { ...before, conflicts: [] })).toThrow();
  });
});
