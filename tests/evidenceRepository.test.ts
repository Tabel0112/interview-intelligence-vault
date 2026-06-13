import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositories, openDatabase, type SqliteDatabase } from "../src/db/index.js";
import {
  getEvidenceCandidatesForTarget, getEvidenceScoreRun, saveEvidenceScoreRun, scoreEvidenceBundle,
} from "../src/evidence/index.js";
import { importTranscript } from "../src/ingest/index.js";
import { linkMemoryObjectToSpan } from "../src/provenance/index.js";

let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;
beforeEach(() => { db = openDatabase(":memory:"); repos = createRepositories(db); });
afterEach(() => db.close());

function fixture(status: "active" | "needs_review" = "active") {
  const imported = importTranscript(db, { filename: "evidence.txt", rawText: `Alex: SQLite is the source of truth for the vault.
Sam: SQLite is not the source of truth for every future system.
Alex: I usually prefer concise implementation prompts.` });
  const spans = db.prepare("SELECT id,transcript_id,text FROM transcript_spans ORDER BY ordinal").all() as Array<{ id: string; transcript_id: string; text: string }>;
  const memory = repos.memoryObjects.createMemoryObject({
    type: "decision", title: "SQLite truth", generated_text: "SQLite is the source of truth for the vault.",
    status, confidence: status === "active" ? 0.95 : 0.3, created_by: "agent",
  }, [{ span_id: spans[0].id, role: "supports", evidence_score: 0.95 }]);
  linkMemoryObjectToSpan(db, { memoryObjectId: memory.id, transcriptId: imported.transcriptId, spanId: spans[0].id, evidenceRole: "support", evidenceStrength: "strong", confidence: 0.95 });
  return { imported, spans, memory };
}

describe("evidence score persistence and provenance integration", () => {
  it("dereferences memory evidence to raw spans and respects canonical memory trust", () => {
    const strong = fixture();
    const candidates = getEvidenceCandidatesForTarget(db, "memory_object", strong.memory.id);
    expect(candidates[0]).toMatchObject({ sourceKind: "memory_object_with_pointers", quote: strong.spans[0].text, provenanceValidated: true, metadata: { canonicalMemoryStatus: "active", memoryUsableAsEvidence: true } });
    expect(scoreEvidenceBundle({ claimText: "SQLite is the source of truth for the vault", useType: "direct_fact", candidates, now: "2026-06-12T00:00:00Z" }).strength).not.toBe("no_evidence");
  });

  it("does not promote a weak canonical memory object through a high-quality pointer", () => {
    const weak = fixture("needs_review");
    const candidates = getEvidenceCandidatesForTarget(db, "memory_object", weak.memory.id);
    expect(candidates[0].metadata).toMatchObject({ canonicalMemoryStatus: "needs_review", memoryUsableAsEvidence: false });
    expect(scoreEvidenceBundle({ claimText: "SQLite is the source of truth for the vault", useType: "direct_fact", candidates, now: "2026-06-12T00:00:00Z" }).strength).toBe("weak");
  });

  it("loads legacy memory-object evidence when no provenance pointer exists", () => {
    const imported = importTranscript(db, { filename: "legacy.txt", rawText: "Alex: Raw spans remain the evidence source." });
    const span = db.prepare("SELECT id,text FROM transcript_spans WHERE transcript_id=?").get(imported.transcriptId) as { id: string; text: string };
    const memory = repos.memoryObjects.createMemoryObject(
      { type: "claim", generated_text: "Raw spans remain the evidence source.", confidence: 0.95, created_by: "agent" },
      [{ span_id: span.id, role: "supports", evidence_score: 0.95 }],
    );
    const candidates = getEvidenceCandidatesForTarget(db, "memory_object", memory.id);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ quote: span.text, sourceKind: "memory_object_with_pointers", spanIds: [span.id], provenanceValidated: true });
  });

  it("saves and reloads score runs, components, version, JSON metadata, and cascades items", () => {
    const { memory } = fixture();
    const assessment = scoreEvidenceBundle({
      claimText: "SQLite is the source of truth for the vault", useType: "direct_fact",
      candidates: getEvidenceCandidatesForTarget(db, "memory_object", memory.id), now: "2026-06-12T00:00:00Z",
    });
    const runId = saveEvidenceScoreRun(db, assessment, { targetType: "memory_object", targetId: memory.id });
    expect(getEvidenceScoreRun(db, runId)).toEqual(assessment);
    const run = db.prepare("SELECT scorer_version,reasons_json,assessment_json FROM evidence_score_runs WHERE id=?").get(runId) as Record<string, string>;
    const item = db.prepare("SELECT relevance,caps_json,reasons_json,candidate_json FROM evidence_score_items WHERE run_id=?").get(runId) as Record<string, string | number>;
    expect(run.scorer_version).toBe(assessment.scorerVersion);
    expect(() => JSON.parse(run.reasons_json)).not.toThrow();
    expect(() => JSON.parse(run.assessment_json)).not.toThrow();
    expect(item.relevance).toBeGreaterThan(0);
    expect(() => JSON.parse(String(item.caps_json))).not.toThrow();
    expect(() => JSON.parse(String(item.candidate_json))).not.toThrow();
    db.prepare("DELETE FROM evidence_score_runs WHERE id=?").run(runId);
    expect(db.prepare("SELECT * FROM evidence_score_items WHERE run_id=?").get(runId)).toBeUndefined();
  });

  it("persists unusable candidates for audit without requiring an existing pointer row", () => {
    const assessment = scoreEvidenceBundle({
      claimText: "Unsupported claim", useType: "direct_fact",
      candidates: [{ id: "generated", evidencePointerId: "missing-pointer", spanIds: [], sourceKind: "generated_summary_with_pointers", quote: "Unsupported claim" }],
    });
    const runId = saveEvidenceScoreRun(db, assessment, { targetType: "claim" });
    expect(assessment.strength).toBe("no_evidence");
    expect(db.prepare("SELECT strength,evidence_pointer_id FROM evidence_score_items WHERE run_id=?").get(runId)).toEqual({ strength: "no_evidence", evidence_pointer_id: null });
  });

  it("scores direct facts, repeated patterns, and explicit conflict from ingested transcript spans", () => {
    const { spans } = fixture();
    const raw = (index: number, stance: "supports" | "opposes" = "supports") => ({
      id: spans[index].id, transcriptId: spans[index].transcript_id, spanIds: [spans[index].id], quote: spans[index].text,
      sourceKind: "raw_transcript_span" as const, stance, retrievalScore: 0.95, keywordScore: 0.95, sourceConfidence: 0.95,
    });
    expect(scoreEvidenceBundle({ claimText: "SQLite is the source of truth for the vault", useType: "direct_fact", candidates: [raw(0)] }).strength).toBe("strong");
    expect(scoreEvidenceBundle({ claimText: "I usually prefer concise implementation prompts", useType: "pattern", candidates: [raw(2)] }).strength).toBe("strong");
    const conflict = scoreEvidenceBundle({ claimText: "SQLite is the source of truth for the vault", useType: "direct_fact", candidates: [raw(0), raw(1, "opposes")] });
    expect(conflict.strength).toBe("conflicting");
  });
});
