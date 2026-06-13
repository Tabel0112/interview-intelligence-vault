import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DuplicateContentError, EvidenceRequiredError, InvalidEvidenceError, ValidationError,
  contentHash, createRepositories, openDatabase, runMigrations,
  type SqliteDatabase,
} from "../src/db/index.js";

let db: SqliteDatabase;
let repos: ReturnType<typeof createRepositories>;

beforeEach(async () => {
  db = await openDatabase(":memory:");
  repos = createRepositories(db);
});
afterEach(() => db.close());

function seedTranscript(text = "Alice confirms the launch. Bob disagrees.") {
  const hash = contentHash(text);
  const source = repos.transcripts.createTranscriptSource({
    source_type: "pasted_text", raw_storage_uri: `.transcript-memory/raw/${hash}.txt`,
    content_hash: hash, byte_length: Buffer.byteLength(text),
  });
  const transcript = repos.transcripts.createTranscript({ source_id: source.id, title: "Meeting", content_hash: hash });
  const spans = repos.spans.createSpans([
    { transcript_id: transcript.id, source_id: source.id, ordinal: 0, start_char: 0, end_char: 26, text_preview: text.slice(0, 26), text_hash: contentHash(text.slice(0, 26)) },
    { transcript_id: transcript.id, source_id: source.id, ordinal: 1, start_char: 27, end_char: text.length, text_preview: text.slice(27), text_hash: contentHash(text.slice(27)) },
  ]);
  return { source, transcript, spans };
}

describe("migrations", () => {
  it("creates all requested tables, enables foreign keys, and is idempotent", () => {
    runMigrations(db);
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as Array<{ name: string }>).map((row) => row.name);
    for (const name of ["app_meta", "schema_migrations", "transcript_sources", "transcripts", "transcript_speakers", "transcript_spans", "processing_runs", "memory_objects", "memory_object_evidence", "evidence_bundles", "evidence_items", "ai_answers", "ai_answer_citations", "graph_nodes", "graph_edges", "user_corrections", "search_documents", "embedding_records", "source_pointers", "evidence_pointers", "answer_claims", "citation_links", "extraction_runs", "search_embeddings", "retrieval_index_status", "retrieval_documents", "evidence_score_runs", "evidence_score_items", "ask_ai_runs", "ask_ai_run_evidence", "ask_ai_claim_metadata", "ask_ai_suggested_followups", "conflict_assessments", "conflict_evidence_links", "conflict_graph_edges", "conflict_corrections", "ask_ai_run_conflicts", "pipeline_runs", "agent_runs", "pipeline_events", "reprocessing_jobs", "hermes_profiles", "hermes_label_preferences", "hermes_topic_profiles", "hermes_correction_history", "obsidian_view_runs", "obsidian_generated_files"]) {
      expect(names).toContain(name);
    }
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect((db.prepare("SELECT COUNT(*) count FROM schema_migrations").get() as { count: number }).count).toBe(12);
  });
});

describe("transcripts and spans", () => {
  it("creates sources/transcripts, detects duplicate content, and stores offsets/previews", () => {
    const seeded = seedTranscript();
    expect(repos.transcripts.getTranscript(seeded.transcript.id)?.source_id).toBe(seeded.source.id);
    expect(repos.transcripts.findTranscriptByContentHash(seeded.source.content_hash)?.id).toBe(seeded.transcript.id);
    expect(repos.spans.listSpansForTranscript(seeded.transcript.id)[0]).toMatchObject({ start_char: 0, end_char: 26, text_preview: "Alice confirms the launch." });
    expect(() => repos.transcripts.createTranscriptSource({ source_type: "pasted_text", raw_storage_uri: "other", content_hash: seeded.source.content_hash, byte_length: 1 })).toThrow(DuplicateContentError);
  });

  it("rejects invalid offsets and source mismatches", () => {
    const { source, transcript } = seedTranscript();
    expect(() => repos.spans.createSpan({ transcript_id: transcript.id, source_id: source.id, ordinal: 3, start_char: 4, end_char: 4, text_preview: "", text_hash: "x" })).toThrow(ValidationError);
  });

  it("cascades transcript spans but preserves raw source", () => {
    const { source, transcript, spans } = seedTranscript();
    db.prepare("DELETE FROM transcripts WHERE id = ?").run(transcript.id);
    expect(repos.spans.getSpan(spans[0].id)).toBeNull();
    expect(db.prepare("SELECT id FROM transcript_sources WHERE id = ?").get(source.id)).toBeTruthy();
  });

  it("restricts deleting an in-use raw source and prevents raw source updates", () => {
    const { source, transcript } = seedTranscript();
    expect(() => db.prepare("DELETE FROM transcript_sources WHERE id = ?").run(source.id)).toThrow();
    expect(() => db.prepare("UPDATE transcript_sources SET raw_storage_uri = ? WHERE id = ?").run("changed", source.id)).toThrow();
    expect(() => db.prepare("UPDATE transcripts SET title = ? WHERE id = ?").run("Changed", transcript.id)).toThrow();
    repos.transcripts.updateTranscriptStatus(transcript.id, "processed");
    expect(repos.transcripts.getTranscript(transcript.id)?.status).toBe("processed");
  });
});

describe("memory and evidence", () => {
  it("creates evidence-backed memory and cascades evidence without deleting spans", () => {
    const { spans } = seedTranscript();
    const memory = repos.memoryObjects.createMemoryObject({ type: "claim", generated_text: "Launch confirmed", confidence: 0.9, created_by: "agent" }, [{ span_id: spans[0].id, role: "supports", evidence_score: 0.9 }]);
    expect(repos.memoryObjects.getMemoryObjectWithEvidence(memory.id)?.evidence).toHaveLength(1);
    db.prepare("DELETE FROM memory_objects WHERE id = ?").run(memory.id);
    expect(db.prepare("SELECT * FROM memory_object_evidence WHERE memory_id = ?").get(memory.id)).toBeUndefined();
    expect(repos.spans.getSpan(spans[0].id)).toBeTruthy();
  });

  it("requires evidence, except needs_review with a missing-evidence reason", () => {
    expect(() => repos.memoryObjects.createMemoryObject({ type: "claim", generated_text: "Unsupported", confidence: 0.2, created_by: "agent" }, [])).toThrow(EvidenceRequiredError);
    expect(() => repos.memoryObjects.createMemoryObject({ type: "claim", generated_text: "Review", status: "needs_review", confidence: 0.2, created_by: "agent" }, [])).toThrow(EvidenceRequiredError);
    const review = repos.memoryObjects.createMemoryObject({ type: "claim", generated_text: "Review", status: "needs_review", confidence: 0.2, created_by: "agent", metadata: { reason: "missing_evidence" } }, []);
    expect(review.status).toBe("needs_review");
    expect(() => repos.memoryObjects.updateMemoryObjectStatus(review.id, "active")).toThrow(EvidenceRequiredError);
  });

  it("validates confidence and evidence scores between zero and one", () => {
    const { spans } = seedTranscript();
    expect(() => repos.memoryObjects.createMemoryObject({ type: "claim", generated_text: "Invalid", confidence: 1.1, created_by: "agent" }, [{ span_id: spans[0].id, role: "supports", evidence_score: 0.8 }])).toThrow(ValidationError);
    const bundle = repos.evidence.createEvidenceBundle({ purpose: "ask_ai" });
    expect(() => repos.evidence.addEvidenceItem(bundle.id, { span_id: spans[0].id, stance: "supports", final_score: -0.1 })).toThrow(ValidationError);
  });

  it.each([
    [[["supports", 0.9]], "strong"],
    [[["supports", 0.6]], "mixed"],
    [[["supports", 0.2]], "weak"],
    [[["supports", 0.9], ["contradicts", 0.8]], "conflicting"],
  ] as const)("scores bundles as %s -> %s", (items, expected) => {
    const { spans } = seedTranscript();
    const bundle = repos.evidence.createEvidenceBundle({ purpose: "ask_ai" });
    items.forEach(([stance, final_score], index) => repos.evidence.addEvidenceItem(bundle.id, { span_id: spans[index % spans.length].id, stance, final_score }));
    expect(repos.evidence.scoreEvidenceBundle(bundle.id).status).toBe(expected);
  });
});

describe("answers and graph", () => {
  it("enforces bundle status and citation bundle membership", () => {
    const { spans } = seedTranscript();
    expect(() => repos.answers.createAnswer({ question_text: "Q", answer_text: "A", evidence_bundle_id: "missing", confidence: "low", answer_status: "answered" })).toThrow(InvalidEvidenceError);
    const weak = repos.evidence.createEvidenceBundle({ purpose: "ask_ai", status: "weak" });
    expect(() => repos.answers.createAnswer({ question_text: "Q", answer_text: "A", evidence_bundle_id: weak.id, confidence: "low", answer_status: "answered" })).toThrow(InvalidEvidenceError);
    expect(() => repos.answers.createAnswer({ question_text: "Q", answer_text: "Maybe", evidence_bundle_id: weak.id, confidence: "low", answer_status: "weak_evidence" })).toThrow(InvalidEvidenceError);
    const answer = repos.answers.createAnswer({ question_text: "Q", answer_text: "No evidence", evidence_bundle_id: weak.id, confidence: "low", answer_status: "refused_no_evidence" });
    repos.evidence.addEvidenceItem(weak.id, { span_id: spans[0].id, final_score: 0.2, stance: "unknown" });
    expect(repos.answers.createAnswer({ question_text: "Q", answer_text: "Maybe", evidence_bundle_id: weak.id, confidence: "low", answer_status: "weak_evidence" }).answer_status).toBe("weak_evidence");
    const other = repos.evidence.createEvidenceBundle({ purpose: "ask_ai", status: "mixed" });
    const item = repos.evidence.addEvidenceItem(other.id, { span_id: spans[0].id, final_score: 0.5, stance: "supports" });
    expect(() => repos.answers.addCitation(answer.id, item.id)).toThrow(InvalidEvidenceError);
  });

  it("requires evidence for source-backed edges and permits evidence-free inferred edges", () => {
    const { spans } = seedTranscript();
    const a = repos.graph.createGraphNode({ node_type: "topic", ref_id: "topic-a", label: "A" });
    const b = repos.graph.createGraphNode({ node_type: "topic", ref_id: "topic-b", label: "B" });
    expect(() => repos.graph.createGraphEdge({ from_node_id: a.id, to_node_id: b.id, edge_type: "related_to", source_type: "source_backed", confidence: 0.8 })).toThrow(EvidenceRequiredError);
    expect(repos.graph.createGraphEdge({ from_node_id: a.id, to_node_id: b.id, edge_type: "related_to", source_type: "inferred", confidence: 0.5 }).source_type).toBe("inferred");
    const bundle = repos.evidence.createEvidenceBundle({ purpose: "graph_edge" });
    repos.evidence.addEvidenceItem(bundle.id, { span_id: spans[0].id, final_score: 0.9, stance: "supports" });
    expect(repos.graph.createGraphEdge({ from_node_id: b.id, to_node_id: a.id, edge_type: "supports", source_type: "source_backed", evidence_bundle_id: bundle.id, confidence: 0.9 }).evidence_bundle_id).toBe(bundle.id);
  });
});

describe("corrections and search", () => {
  it("records append-only correction history while updating the target", () => {
    const { spans } = seedTranscript();
    const memory = repos.memoryObjects.createMemoryObject({ type: "claim", generated_text: "Initial", confidence: 0.7, created_by: "agent" }, [{ span_id: spans[0].id, role: "supports", evidence_score: 0.8 }]);
    const updated = repos.corrections.applyMemoryObjectCorrection(memory.id, { correction_type: "edit", new_value: { generated_text: "Corrected" } });
    expect(updated.generated_text).toBe("Corrected");
    const corrections = repos.corrections.listCorrectionsForTarget("memory_object", memory.id);
    expect(corrections).toHaveLength(1);
    expect(() => db.prepare("DELETE FROM user_corrections WHERE id = ?").run(corrections[0].id)).toThrow();
  });

  it("finds search documents and stores embedding metadata", () => {
    const doc = repos.search.upsertSearchDocument({ doc_type: "span", ref_id: "span_x", search_text: "launch decision approved" });
    expect(repos.search.searchKeyword("launch", 5).map((result) => result.id)).toContain(doc.id);
    const embedding = repos.search.createEmbeddingRecord({ doc_type: "span", ref_id: "span_x", embedding_model: "test", embedding_dim: 3, embedding: [0.1, 0.2, 0.3], content_hash: contentHash(doc.search_text) });
    expect(repos.search.getEmbeddingRecord("span", "span_x", "test", embedding.content_hash)?.embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("falls back to LIKE when FTS5 is unavailable", () => {
    const doc = repos.search.upsertSearchDocument({ doc_type: "span", ref_id: "span_fallback", search_text: "fallback keyword result" });
    db.exec("DROP TABLE IF EXISTS search_documents_fts");
    expect(repos.search.searchKeyword("fallback", 5).map((result) => result.id)).toContain(doc.id);
  });

  it("tracks processing run completion and failure", () => {
    const completed = repos.runs.completeRun(repos.runs.startRun({ run_type: "ingestion", agent_name: "normal-agent" }).id, { imported: 1 });
    expect(completed).toMatchObject({ status: "completed", output: { imported: 1 } });
    const failed = repos.runs.failRun(repos.runs.startRun({ run_type: "embedding" }).id, { message: "model unavailable" });
    expect(failed.status).toBe("failed");
  });
});
