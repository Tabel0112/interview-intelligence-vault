import { askAI, createDatabaseAskAIDependencies, EmbeddingReindexRequiredError, EmbeddingSetupRequiredError, getAskAIResponse, SynthesisSetupRequiredError, type AskAIAnalysisModel, type AskAILanguageModel, type AskAIResponse, type SynthesisInfo } from "../ask-ai/index.js";
import type { EmbeddingProvider } from "../retrieval/index.js";

/** Read-only production-readiness of Ask AI embeddings (resolved by the plugin from settings). */
export type EmbeddingHealth = { state: "ok" | "setup_required" | "reindex_required"; reason: string };
import { createConflictRepository, detectAndPersistConflictsForMemory, detectAndPersistConflictsForTranscript } from "../conflicts/index.js";
import type { SqliteDatabase } from "../db/connection.js";
import { createCorrectionsRepo } from "../db/repositories/correctionsRepo.js";
import { createMemoryObjectsRepo } from "../db/repositories/memoryObjectsRepo.js";
import { createTranscriptsRepo } from "../db/repositories/transcriptsRepo.js";
import { importTranscript } from "../ingest/index.js";
import { extractMemoryObjectsForTranscript, isStrongMemoryObject, type MemoryExtractor } from "../memory/index.js";
import { indexTranscriptForRetrieval, removeRetrievalDocument } from "../retrieval/index.js";
// Import directly from the (Obsidian-runtime-free) graph builder, NOT the obsidian barrel: the barrel
// re-exports ObsidianAppApi/ObsidianNavigation which import the "obsidian" package, which would make
// this headless service unloadable in a plain Node process (e.g. the MCP server).
import { buildObsidianGraph } from "../obsidian/graphBuilder.js";
import { resolveEvidencePointer, type EvidencePointer } from "../provenance/index.js";
import { routeHref } from "./router.js";
import { DEGRADED_MEMORY_REASON } from "./types.js";
import type {
  DashboardView, EvidenceView, FrontendApi, GeneratedSyncResult, GeneratedSyncStatus, MemoryView, ReviewItemView, SearchResultView, SetupSummary, TranscriptListItem, TranscriptView, TrustState,
} from "./types.js";

/**
 * Live-evidence count for a memory, EXACTLY mirroring the approve trust gate (correctionsRepo): a memory is
 * approvable iff it has >=1 memory_object_evidence row OR >=1 evidence_pointer targeting it. After its source
 * transcript is deleted both are gone, so this returns false and the memory is degraded (reject-only).
 */
function memoryHasLiveEvidenceForReview(db: SqliteDatabase, memoryId: string): boolean {
  return (db.prepare(`SELECT
    (SELECT COUNT(*) FROM memory_object_evidence WHERE memory_id=?) +
    (SELECT COUNT(*) FROM evidence_pointers WHERE target_type IN ('memory_object','claim','summary') AND target_id=?) c`)
    .get(memoryId, memoryId) as { c: number }).c > 0;
}
import type { PluginHealth } from "../obsidian/startup.js";

type Row = Record<string, unknown>;

const trust = (value: unknown): TrustState => {
  const state = String(value ?? "no_evidence");
  return ["strong", "mixed", "weak", "conflicting", "no_evidence", "broken", "needs_review", "rejected", "superseded"].includes(state)
    ? state as TrustState
    : "weak";
};

const preview = (value: unknown, length = 180) => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= length ? text : `${text.slice(0, length - 3)}...`;
};
const evidenceRole = (value: string) => value === "support" ? "supporting" : value === "opposition" ? "opposing" : "context";

export function validateTranscriptUpload(input: { filename: string; rawText: string }): void {
  if (!/\.(txt|md|srt|vtt)$/i.test(input.filename)) throw new Error("Unsupported transcript type. Use .txt, .md, .srt, or .vtt.");
  if (!input.rawText.trim()) throw new Error("Select a non-empty transcript file.");
}

function transcriptList(db: SqliteDatabase): TranscriptListItem[] {
  return (db.prepare(`SELECT t.id,t.title,t.status,t.imported_at,t.source_type,COUNT(DISTINCT s.id) span_count,COUNT(DISTINCT s.speaker_id) speaker_count
    FROM transcripts t LEFT JOIN transcript_spans s ON s.transcript_id=t.id
    GROUP BY t.id ORDER BY t.imported_at DESC,t.id`).all() as Row[]).map((row) => ({
    id: String(row.id), title: String(row.title), sourceType: String(row.source_type), status: String(row.status),
    createdAt: String(row.imported_at), importedAt: String(row.imported_at), spanCount: Number(row.span_count), speakerCount: Number(row.speaker_count),
    processingStatus: row.status === "failed" ? "failed" : row.status === "imported" ? "processing" : "ready",
  }));
}

function brokenEvidence(db: SqliteDatabase, id: string, reason: string): EvidenceView {
  const row = db.prepare(`SELECT p.*,t.title transcript_title FROM evidence_pointers p
    LEFT JOIN transcripts t ON t.id=p.transcript_id WHERE p.evidence_pointer_id=?`).get(id) as Row | undefined;
  if (!row) {
    return {
      id, pointerUri: `mv://evidence/${id}`, sourcePointerUri: "", targetType: "unknown", targetId: "", role: "unclear",
      strength: "broken", confidence: 0, finalScore: null, quotePreview: "", transcriptId: "", transcriptTitle: "Unavailable",
      spanId: "", spanText: "", rawText: "", brokenReason: reason,
    };
  }
  return {
    id, pointerUri: String(row.pointer_uri), sourcePointerUri: String(row.source_pointer_uri), targetType: String(row.target_type),
    targetId: String(row.target_id), role: evidenceRole(String(row.evidence_role)), strength: "broken", confidence: Number(row.confidence),
    finalScore: row.final_score == null ? null : Number(row.final_score), quotePreview: String(row.quote_preview),
    transcriptId: String(row.transcript_id), transcriptTitle: String(row.transcript_title ?? row.transcript_id),
    spanId: String(row.span_id), spanText: "", rawText: "", brokenReason: reason,
  };
}

function evidenceView(db: SqliteDatabase, id: string): EvidenceView {
  const resolved = resolveEvidencePointer(db, id);
  if (!resolved.ok) return brokenEvidence(db, id, resolved.reason);
  const title = db.prepare("SELECT title FROM transcripts WHERE id=?").get(resolved.evidence.transcript_id) as { title: string } | undefined;
  return {
    id: resolved.evidence.evidence_pointer_id, pointerUri: resolved.evidence.pointer_uri,
    sourcePointerUri: resolved.evidence.source_pointer_uri, targetType: resolved.evidence.target_type, targetId: resolved.evidence.target_id,
    role: evidenceRole(resolved.evidence.evidence_role), strength: trust(resolved.evidence.evidence_strength), confidence: resolved.evidence.confidence,
    finalScore: resolved.evidence.final_score, quotePreview: resolved.evidence.quote_preview, transcriptId: resolved.evidence.transcript_id,
    transcriptTitle: title?.title ?? resolved.evidence.transcript_id, spanId: resolved.evidence.span_id,
    spanText: resolved.spanText, rawText: resolved.rawText, brokenReason: null,
  };
}

function reviewItems(db: SqliteDatabase): ReviewItemView[] {
  const items: ReviewItemView[] = [];
  // Memory objects the user has explicitly approved/rejected (user_corrected=1) are resolved: their
  // weak evidence is an accepted, known state and must not resurface as an unresolved review task.
  const userReviewedMemoryIds = new Set(
    (db.prepare("SELECT id FROM memory_objects WHERE user_corrected=1").all() as Array<{ id: string }>).map((row) => row.id),
  );
  const pointers = db.prepare("SELECT evidence_pointer_id,evidence_strength,target_type,target_id,quote_preview,transcript_id,created_at FROM evidence_pointers ORDER BY created_at,evidence_pointer_id").all() as Array<{
    evidence_pointer_id: string; evidence_strength: string; target_type: string; target_id: string; quote_preview: string; transcript_id: string; created_at: string;
  }>;
  for (const pointer of pointers) {
    const resolved = resolveEvidencePointer(db, pointer.evidence_pointer_id);
    if (!resolved.ok) {
      items.push({
        id: `broken:${pointer.evidence_pointer_id}`, type: "broken_pointer", title: "Broken evidence pointer",
        detail: `${pointer.evidence_pointer_id}: ${resolved.reason}`, targetType: pointer.target_type, targetId: pointer.target_id,
        trustState: "broken", href: routeHref.evidence(pointer.evidence_pointer_id),
        createdAt: pointer.created_at, severity: "high", status: "open", relatedTranscriptIds: [pointer.transcript_id], relatedEvidenceIds: [pointer.evidence_pointer_id],
      });
    } else if ((pointer.evidence_strength === "weak" || pointer.evidence_strength === "unknown")
      && !(pointer.target_type === "memory_object" && userReviewedMemoryIds.has(pointer.target_id))) {
      items.push({
        id: `weak:${pointer.evidence_pointer_id}`, type: "weak_evidence", title: "Weak evidence",
        detail: preview(pointer.quote_preview), targetType: pointer.target_type, targetId: pointer.target_id,
        trustState: "weak", href: routeHref.evidence(pointer.evidence_pointer_id),
        createdAt: pointer.created_at, severity: "medium", status: "open", relatedTranscriptIds: [resolved.evidence.transcript_id], relatedEvidenceIds: [pointer.evidence_pointer_id],
      });
    }
  }
  for (const memory of createMemoryObjectsRepo(db).listCanonicalMemoryObjects()) {
    if (memory.status === "needs_review" || memory.status === "weak") {
      const row = db.prepare("SELECT created_at, metadata_json FROM memory_objects WHERE id=?").get(memory.id) as { created_at: string; metadata_json: string | null };
      // The extraction pipeline persists WHY this item was routed to review (tentative wording, medium
      // confidence, unsupported body, possible duplicate, conflict) — show it instead of a bare status.
      let reviewReason: string | undefined;
      try {
        const parsed = row.metadata_json ? JSON.parse(row.metadata_json) as { review_reason?: unknown } : undefined;
        if (typeof parsed?.review_reason === "string" && parsed.review_reason.trim()) reviewReason = parsed.review_reason.trim();
      } catch { /* legacy/malformed metadata -> fall back to the generic detail */ }
      const transcriptIds = (db.prepare(`SELECT DISTINCT s.transcript_id FROM transcript_spans s
        WHERE s.id IN (SELECT span_id FROM memory_object_evidence WHERE memory_id=?) ORDER BY s.transcript_id`).all(memory.id) as Array<{ transcript_id: string }>).map((item) => item.transcript_id);
      // Live-evidence count mirrors the approve trust gate (memory_object_evidence + evidence_pointers).
      // A memory with zero live evidence (e.g. its source transcript was deleted) is degraded: it cannot be
      // approved, but stays visible in Review as dismissible (Reject) so it is never a dead/actionless item.
      const hasLiveEvidence = memoryHasLiveEvidenceForReview(db, memory.id);
      items.push({
        id: `memory:${memory.id}`, type: "memory_needs_review", title: memory.title || memory.body,
        detail: reviewReason ?? `${memory.status}; ${memory.evidenceSpanIds.length} evidence span(s)`, targetType: "memory_object", targetId: memory.id,
        trustState: memory.status, href: routeHref.memory(memory.id),
        createdAt: row.created_at, severity: "medium", status: "open", relatedTranscriptIds: transcriptIds, relatedEvidenceIds: [],
        hasLiveEvidence, canApprove: hasLiveEvidence, canReject: true,
        degradedReason: hasLiveEvidence ? undefined : DEGRADED_MEMORY_REASON,
      });
    }
  }
  const conflictRepo = createConflictRepository(db);
  const conflicts = (db.prepare("SELECT id FROM conflict_assessments ORDER BY created_at,id").all() as Array<{ id: string }>)
    .map(({ id }) => conflictRepo.get(id)).filter((item) => item != null);
  for (const conflict of conflicts) {
    if (conflict.status === "resolved" || conflict.status === "dismissed" || conflict.status === "superseded") continue;
    items.push({
      id: `conflict:${conflict.id}`, type: "conflict", title: conflict.summary, detail: conflict.explanation,
      targetType: conflict.leftTargetType, targetId: conflict.leftTargetId, trustState: "conflicting", href: routeHref.review(`conflict:${conflict.id}`),
      createdAt: conflict.createdAt, severity: "high", status: "open",
      relatedTranscriptIds: [...new Set(conflict.evidenceLinks.flatMap((link) => link.transcriptId ? [link.transcriptId] : []))],
      relatedEvidenceIds: conflict.evidenceLinks.map((link) => link.evidencePointerId),
    });
  }
  // confirm/reject corrections are append-only audit records of an approve/reject DECISION, not new
  // review tasks. They stay in history but must not reappear as unresolved "user correction" items.
  for (const row of db.prepare("SELECT id,target_type,target_id,reason,created_at FROM user_corrections WHERE correction_type NOT IN ('confirm','reject') ORDER BY created_at,id").all() as Row[]) {
    items.push({
      id: `correction:${String(row.id)}`, type: "user_correction", title: "User correction received",
      detail: String(row.reason ?? "Awaiting review or reprocessing"), targetType: String(row.target_type), targetId: String(row.target_id),
      trustState: "needs_review", href: routeHref.review(`correction:${String(row.id)}`),
      createdAt: String(row.created_at), severity: "low", status: "open", relatedTranscriptIds: [], relatedEvidenceIds: [],
    });
  }
  return items.sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeCorrectionTarget(db: SqliteDatabase, input: Parameters<FrontendApi["submitCorrection"]>[0]) {
  if (["memory_object", "graph_edge", "speaker", "answer", "span", "transcript"].includes(input.targetType)) {
    return { targetType: input.targetType as "memory_object" | "graph_edge" | "speaker" | "answer" | "span" | "transcript", targetId: input.targetId };
  }
  if (input.targetType === "answer_claim") {
    const row = db.prepare("SELECT answer_id FROM answer_claims WHERE answer_claim_id=?").get(input.targetId) as { answer_id: string } | undefined;
    if (row) return { targetType: "answer" as const, targetId: row.answer_id };
  }
  if (input.targetType === "citation") {
    const row = db.prepare("SELECT answer_id FROM citation_links WHERE citation_link_id=?").get(input.targetId) as { answer_id: string | null } | undefined;
    if (row?.answer_id) return { targetType: "answer" as const, targetId: row.answer_id };
  }
  if (input.targetType === "evidence") {
    const row = db.prepare("SELECT target_type,target_id FROM evidence_pointers WHERE evidence_pointer_id=?").get(input.targetId) as { target_type: string; target_id: string } | undefined;
    if (row && ["memory_object", "graph_edge", "answer"].includes(row.target_type)) return { targetType: row.target_type as "memory_object" | "graph_edge" | "answer", targetId: row.target_id };
    if (row?.target_type === "answer_claim") return normalizeCorrectionTarget(db, { ...input, targetType: "answer_claim", targetId: row.target_id });
    if (row?.target_type === "graph_node") return normalizeCorrectionTarget(db, { ...input, targetType: "graph_node", targetId: row.target_id });
  }
  if (input.targetType === "graph_node") {
    const row = db.prepare("SELECT node_type,ref_id FROM graph_nodes WHERE id=?").get(input.targetId) as { node_type: string; ref_id: string } | undefined;
    if (row?.node_type === "memory_object") return { targetType: "memory_object" as const, targetId: row.ref_id };
    if (row?.node_type === "transcript") return { targetType: "transcript" as const, targetId: row.ref_id };
    if (row?.node_type === "span") return { targetType: "span" as const, targetId: row.ref_id };
  }
  throw new Error(`Correction target ${input.targetType}:${input.targetId} has no supported append-only owner`);
}

/**
 * Best-effort status of the last generated-Markdown view sync (powers Obsidian's native graph). Read-only;
 * `obsidian_view_runs` is a generation audit log, never source truth. Any error -> "never synced" (the
 * dashboard must never break because the optional view layer was never written).
 */
function generatedSyncStatus(db: SqliteDatabase): GeneratedSyncStatus {
  try {
    const run = db.prepare(`SELECT created_at,file_count,graph_node_count,graph_edge_count,status,error_message
      FROM obsidian_view_runs ORDER BY created_at DESC,id DESC LIMIT 1`).get() as Row | undefined;
    if (!run) return { synced: false };
    return {
      synced: true, lastSyncedAt: String(run.created_at), fileCount: Number(run.file_count),
      graphNodeCount: Number(run.graph_node_count), graphEdgeCount: Number(run.graph_edge_count),
      status: run.status === "failed" ? "failed" : "completed",
      error: run.error_message ? String(run.error_message) : undefined,
    };
  } catch {
    return { synced: false };
  }
}

export function createSqliteFrontendApi(
  db: SqliteDatabase,
  options: {
    now?: () => Date;
    /** Static health snapshot. Prefer `getHealth` for a LIVE read; `health` is a fallback for callers/tests. */
    health?: PluginHealth;
    /** Live health getter — the dashboard reads this so it never renders a startup-frozen snapshot. */
    getHealth?: () => PluginHealth | undefined;
    getSynthesis?: () => { llm?: AskAILanguageModel; analysis?: AskAIAnalysisModel; info: SynthesisInfo } | undefined;
    getMemoryExtractor?: () => MemoryExtractor | undefined;
    /** Live app: require a configured LLM for generation; never fall back to deterministic output. */
    llmRequired?: boolean;
    /** Current-settings readiness (no construction); used for setup-required UI. */
    getLlmReady?: () => boolean;
    /**
     * Live app: require a production API embedding provider with a matching index before Ask AI answers.
     * When true, Ask AI blocks (setup_required / reindex_required) instead of silently using token-hash-v1.
     * Tests/dev leave this false, preserving deterministic keyword-only retrieval without API keys.
     */
    embeddingsRequired?: boolean;
    /** Read-only embedding health (no network, no reindex). Required when `embeddingsRequired` is true. */
    getEmbeddingHealth?: () => EmbeddingHealth;
    /** The live external embedding provider for retrieval (never the token-hash fallback). Undefined => none. */
    getEmbeddingProvider?: () => EmbeddingProvider | undefined;
    /**
     * Non-secret setup summary for the Claude/MCP dashboard card. Injected by the Obsidian plugin (which
     * has the settings + database path). Read-only, no secrets — presence booleans + provider/model/paths.
     */
    getSetupSummary?: () => SetupSummary;
    /**
     * Injected by the Obsidian plugin (which knows the on-disk vault path) to write the generated
     * Markdown view layer. Headless/MCP callers leave this unset -> syncGeneratedGraphNotes is unavailable.
     */
    syncGeneratedViews?: () => Promise<GeneratedSyncResult>;
  } = {},
): FrontendApi {
  // Shared Ask AI entrypoint with the production gates. Order: LLM gate -> embedding gate -> answer.
  const askGated = (question: string, askOptions?: { transcriptIds?: string[]; maxEvidence?: number }): Promise<AskAIResponse> => {
    const synth = options.getSynthesis?.();
    // LLM-required: with no LLM configured, refuse with setup-required before answering (no deterministic answer).
    if (options.llmRequired && !synth?.llm) throw new SynthesisSetupRequiredError();
    // Embedding-required (production): block factual answers unless an API embedding provider is configured and
    // the index matches it. token-hash-v1 is never used for production answers (no silent fallback).
    if (options.embeddingsRequired) {
      const health = options.getEmbeddingHealth?.() ?? { state: "setup_required" as const, reason: "Embedding health is unavailable." };
      if (health.state === "setup_required") throw new EmbeddingSetupRequiredError();
      if (health.state === "reindex_required") throw new EmbeddingReindexRequiredError();
    }
    // When healthy, pass the live external embedding provider so retrieval is semantic, not keyword-only.
    const embeddingProvider = options.embeddingsRequired ? options.getEmbeddingProvider?.() : undefined;
    return askAI({ question, transcriptIds: askOptions?.transcriptIds, maxEvidenceItems: askOptions?.maxEvidence },
      createDatabaseAskAIDependencies(db, { now: options.now, llm: synth?.llm, analysis: synth?.analysis, synthesisInfo: synth?.info, requireLlm: options.llmRequired, embeddingProvider }));
  };
  return {
    async getDashboard(): Promise<DashboardView> {
      const answers = db.prepare("SELECT id,question,evidence_confidence,created_at FROM ask_ai_runs ORDER BY created_at DESC,id LIMIT 8").all() as Row[];
      const review = reviewItems(db);
      // Read-only projection of existing review items — highest-severity weak/broken/conflicting first.
      // No scoring/trust/review-semantics change; just a dashboard view.
      const severityRank = { high: 3, medium: 2, low: 1 } as const;
      const attention = review
        .filter((item) => item.trustState === "weak" || item.trustState === "broken" || item.trustState === "conflicting")
        .sort((a, b) => severityRank[b.severity] - severityRank[a.severity])
        .slice(0, 5);
      return {
        totalTranscriptCount: transcriptList(db).length,
        transcripts: transcriptList(db).slice(0, 10),
        recentAnswers: answers.map((row) => ({ id: String(row.id), question: String(row.question), confidence: trust(row.evidence_confidence), createdAt: String(row.created_at) })),
        reviewCount: review.length,
        weakCount: review.filter((item) => item.trustState === "weak" || item.trustState === "needs_review").length,
        conflictCount: review.filter((item) => item.trustState === "conflicting").length,
        brokenCount: review.filter((item) => item.trustState === "broken").length,
        // Live read (getHealth) so the dashboard reflects current status; static `health` is the fallback.
        health: options.getHealth?.() ?? options.health,
        llmRequired: !!options.llmRequired,
        llmReady: options.getLlmReady ? options.getLlmReady() : !options.llmRequired,
        generatedSync: generatedSyncStatus(db),
        attention,
      };
    },
    async listTranscripts() { return transcriptList(db); },
    async uploadTranscript(input) {
      validateTranscriptUpload(input);
      // The raw transcript is committed first (its own immutable transaction).
      const result = importTranscript(db, { filename: input.filename, rawText: input.rawText, sourceType: "upload" });
      let warning = result.warning;
      // Automatically extract memory only after a successful NEW import, and never twice for the same
      // transcript. Extraction failure must never lose/roll back the imported transcript.
      const extractor = result.status === "imported" ? options.getMemoryExtractor?.() : undefined;
      // LLM-required: a new import with no configured LLM keeps the raw transcript but skips AI extraction.
      if (result.status === "imported" && !extractor && options.llmRequired) {
        warning = warning ?? "Transcript imported. AI memory extraction needs a configured LLM — set one up in Settings, then run \"Run AI extraction\".";
      }
      if (extractor && !db.prepare("SELECT 1 FROM extraction_runs WHERE transcript_id=? AND status='completed' LIMIT 1").get(result.transcriptId)) {
        try {
          const extraction = await extractMemoryObjectsForTranscript(db, { transcriptId: result.transcriptId, extractor });
          const runStatus = db.prepare("SELECT status FROM extraction_runs WHERE id=?").get(extraction.extractionRunId) as { status: string } | undefined;
          if (runStatus?.status !== "completed") warning = warning ?? "Transcript imported, but automatic memory extraction did not complete.";
        } catch {
          warning = warning ?? "Transcript imported, but automatic memory extraction did not complete.";
        }
        // Post-import: bridge usable memory to provenance pointers + local keyword indexing (offline,
        // idempotent). Runs even if extraction warned, so spans are still indexed. Never rolls back.
        try {
          await indexTranscriptForRetrieval(db, result.transcriptId);
        } catch {
          warning = warning ?? "Transcript imported, but automatic memory indexing did not complete.";
        }
        // LIVE conflict detection (deterministic, offline, idempotent by pair): compare this transcript's
        // bridged memories against existing active memory and persist assessments so Review, MCP
        // get_conflicts, the graph, and Ask AI surface them. Best-effort — never blocks the import.
        try {
          detectAndPersistConflictsForTranscript(db, result.transcriptId, { now: options.now });
        } catch {
          warning = warning ?? "Transcript imported, but conflict detection did not complete.";
        }
      }
      return { transcriptId: result.transcriptId, status: result.status, warning };
    },
    async getTranscript(id): Promise<TranscriptView | null> {
      const row = db.prepare("SELECT id,title,status,imported_at,raw_text,source_type FROM transcripts WHERE id=?").get(id) as Row | undefined;
      if (!row) return null;
      const spans = db.prepare(`SELECT s.id,s.ordinal,s.start_time_ms,s.end_time_ms,s.start_char,s.end_char,s.text,
        COALESCE(s.speaker_label,sp.display_name,sp.speaker_label) speaker
        FROM transcript_spans s LEFT JOIN transcript_speakers sp ON sp.id=s.speaker_id
        WHERE s.transcript_id=? ORDER BY s.ordinal,s.id`).all(id) as Row[];
      return {
        id, title: String(row.title), sourceType: String(row.source_type), status: String(row.status), createdAt: String(row.imported_at),
        importedAt: String(row.imported_at), rawText: String(row.raw_text), immutable: true, speakerCount: new Set(spans.map((span) => span.speaker).filter(Boolean)).size,
        processingStatus: row.status === "failed" ? "failed" : row.status === "imported" ? "processing" : "ready",
        spanCount: spans.length, spans: spans.map((span) => ({
          id: String(span.id), transcriptId: id, ordinal: Number(span.ordinal), speaker: span.speaker == null ? null : String(span.speaker),
          startTimeMs: span.start_time_ms == null ? null : Number(span.start_time_ms), startChar: Number(span.start_char),
          endTimeMs: span.end_time_ms == null ? null : Number(span.end_time_ms), endChar: Number(span.end_char), text: String(span.text),
        })),
      };
    },
    async ask(question, askOptions) { return askGated(question, askOptions); },
    async askAI(question, askOptions) { return askGated(question, askOptions); },
    async getEmbeddingStatus() {
      const required = !!options.embeddingsRequired;
      const health = options.getEmbeddingHealth?.();
      return { required, state: required ? (health?.state ?? "setup_required") : "ok", reason: health?.reason };
    },
    async getSetupSummary() {
      // Display-only; returns null when not wired (headless/MCP/dev). Never carries secrets.
      return options.getSetupSummary?.() ?? null;
    },
    async getAnswer(id) {
      try {
        const answer = getAskAIResponse(db, id);
        return { ...answer, brokenCitationIds: answer.citations.filter((citation) => !resolveEvidencePointer(db, citation.evidencePointerId).ok).map((citation) => citation.id) };
      } catch { return null; }
    },
    async getEvidence(id) { return evidenceView(db, id); },
    async getMemory(id): Promise<MemoryView | null> {
      const memory = createMemoryObjectsRepo(db).getCanonicalMemoryObject(id);
      if (!memory) return null;
      const pointers = db.prepare(`SELECT evidence_pointer_id FROM evidence_pointers
        WHERE target_type IN ('memory_object','claim','summary') AND target_id=? ORDER BY evidence_pointer_id`).all(id) as Array<{ evidence_pointer_id: string }>;
      return {
        memory,
        trustState: isStrongMemoryObject(memory) ? "strong" : trust(memory.status),
        evidence: pointers.map((pointer) => evidenceView(db, pointer.evidence_pointer_id)),
        conflicts: createConflictRepository(db).listConflictsForTarget("memory_object", id),
      };
    },
    async getMemoryObject(id) { return this.getMemory(id); },
    async getGraph(graphOptions) {
      const built = buildObsidianGraph(db);
      if (!graphOptions) return built;
      const query = graphOptions.query?.toLowerCase(), types = graphOptions.nodeTypes, limit = Math.min(graphOptions.limit ?? 100, 100);
      const nodes = built.graph.nodes.filter((node) => (!query || node.label.toLowerCase().includes(query)) && (!types?.length || types.includes(node.type))).slice(0, limit);
      const ids = new Set(nodes.map((node) => node.id));
      return { ...built, graph: { nodes, edges: built.graph.edges.filter((edge) => ids.has(edge.source) || ids.has(edge.target)).slice(0, limit) } };
    },
    async search(query, filters): Promise<SearchResultView[]> {
      if (!query.trim()) return [];
      const like = `%${query.trim()}%`;
      const results: SearchResultView[] = [];
      for (const row of db.prepare("SELECT id,title,raw_text FROM transcripts WHERE title LIKE ? OR raw_text LIKE ? ORDER BY imported_at DESC LIMIT 20").all(like, like) as Row[]) {
        results.push({ type: "transcript", id: String(row.id), title: String(row.title), preview: preview(row.raw_text), href: routeHref.transcript(String(row.id)) });
      }
      for (const row of db.prepare("SELECT id,transcript_id,text FROM transcript_spans WHERE text LIKE ? ORDER BY transcript_id,ordinal LIMIT 30").all(like) as Row[]) {
        results.push({ type: "span", id: String(row.id), title: `Transcript span ${String(row.id)}`, preview: preview(row.text), href: routeHref.transcript(String(row.transcript_id), String(row.id)) });
      }
      for (const memory of createMemoryObjectsRepo(db).listCanonicalMemoryObjects().filter((item) => `${item.title} ${item.body}`.toLowerCase().includes(query.toLowerCase())).slice(0, 20)) {
        results.push({ type: "memory_object", id: memory.id, title: memory.title || memory.type, preview: preview(memory.body), href: routeHref.memory(memory.id), trustState: isStrongMemoryObject(memory) ? "strong" : trust(memory.status) });
      }
      for (const row of db.prepare("SELECT id,question,answer_markdown,evidence_confidence FROM ask_ai_runs WHERE question LIKE ? OR answer_markdown LIKE ? ORDER BY created_at DESC LIMIT 20").all(like, like) as Row[]) {
        results.push({ type: "answer", id: String(row.id), title: String(row.question), preview: preview(row.answer_markdown), href: routeHref.answer(String(row.id)), trustState: trust(row.evidence_confidence) });
      }
      for (const row of db.prepare("SELECT evidence_pointer_id,quote_preview,evidence_strength FROM evidence_pointers WHERE quote_preview LIKE ? ORDER BY created_at DESC LIMIT 30").all(like) as Row[]) {
        results.push({
          type: "evidence", id: String(row.evidence_pointer_id), title: `Evidence ${String(row.evidence_pointer_id)}`,
          preview: preview(row.quote_preview), href: routeHref.evidence(String(row.evidence_pointer_id)), trustState: trust(row.evidence_strength),
        });
      }
      return results.filter((item) =>
        (!filters?.evidenceStrength || item.trustState === filters.evidenceStrength)
        && (!filters?.type || filters.type === "all"
          || filters.type === "transcripts" && (item.type === "transcript" || item.type === "span")
          || filters.type === "memory" && item.type === "memory_object"
          || filters.type === "answers" && item.type === "answer"
          || filters.type === "evidence" && item.type === "evidence"));
    },
    async searchVault(query, filters) {
      const results = await this.search(query, filters);
      return {
        transcripts: results.filter((item) => item.type === "transcript" || item.type === "span"),
        memoryObjects: results.filter((item) => item.type === "memory_object"),
        answers: results.filter((item) => item.type === "answer"),
        evidence: results.filter((item) => item.type === "evidence"),
      };
    },
    async listReviewItems(filter) {
      return reviewItems(db).filter((item) => (!filter?.type || item.type === filter.type) && (!filter?.status || item.status === filter.status));
    },
    async getReviewItem(id) { return reviewItems(db).find((item) => item.id === id) ?? null; },
    async submitCorrection(input) {
      const target = normalizeCorrectionTarget(db, input);
      const correction = createCorrectionsRepo(db).createCorrection({
        target_type: target.targetType, target_id: target.targetId, correction_type: "edit",
        new_value: { correction_text: input.correctionText }, reason: input.reason ?? null,
        metadata: { submitted_from: "frontend_review_queue", append_only: true, requested_target_type: input.targetType, requested_target_id: input.targetId },
      });
      return { correctionId: correction.id, status: "received" };
    },
    async reviewMemoryObject(memoryId, decision) {
      const corrections = createCorrectionsRepo(db);
      if (decision === "approve") {
        // Defense-in-depth: a memory with no live evidence can NEVER be promoted (the correction trust gate
        // would throw EvidenceRequiredError). Return a clear friendly result instead of a raw failure, and
        // do not promote / create evidence / change status. The trust gate remains the ultimate backstop.
        if (!memoryHasLiveEvidenceForReview(db, memoryId)) {
          return { status: "cannot_approve", warning: DEGRADED_MEMORY_REASON };
        }
        // Promote through the existing trust gate: append-only user correction (sets status+extraction_status
        // active and user_corrected=1; throws if no evidence exists). Then bridge + local keyword index.
        corrections.applyMemoryObjectCorrection(memoryId, { correction_type: "confirm", new_value: { status: "active" } });
        let warning: string | undefined;
        try {
          const transcriptIds = db.prepare("SELECT DISTINCT transcript_id FROM memory_object_evidence WHERE memory_id=? AND transcript_id IS NOT NULL").all(memoryId) as Array<{ transcript_id: string }>;
          for (const { transcript_id } of transcriptIds) await indexTranscriptForRetrieval(db, transcript_id);
        } catch {
          warning = "Memory approved, but automatic retrieval indexing did not complete.";
        }
        // The approval above just bridged this memory to evidence pointers, so it is NOW a citable
        // conflict side (Policy A: needs_review memory has no pointers). Detect + persist conflicts
        // against other active memory — e.g. the pair that originally held this memory back for review.
        // Best-effort and idempotent by pair; never blocks the approval.
        try {
          detectAndPersistConflictsForMemory(db, memoryId, { now: options.now });
        } catch {
          warning = warning ?? "Memory approved, but conflict detection did not complete.";
        }
        return { status: "approved", warning };
      }
      // Reject: mark rejected (append-only correction) and delete this memory's evidence pointers; the
      // retrieval_cleanup_evidence trigger removes the corresponding retrieval rows. memory_object_evidence kept.
      corrections.applyMemoryObjectCorrection(memoryId, { correction_type: "reject", new_value: { status: "rejected" } });
      try {
        db.prepare("DELETE FROM evidence_pointers WHERE target_type='memory_object' AND target_id=?").run(memoryId);
        // Remove the rejected memory's own retrieval document/index rows so it is no longer discoverable
        // in normal search (the evidence-pointer retrieval rows are cleaned by the cascade trigger above).
        removeRetrievalDocument(db, "memory_object", memoryId);
      } catch {
        return { status: "rejected", warning: "Memory rejected, but evidence cleanup did not complete." };
      }
      return { status: "rejected" };
    },
    async getLlmStatus() {
      const required = !!options.llmRequired;
      return { required, ready: options.getLlmReady ? options.getLlmReady() : !required };
    },
    async runExtraction(transcriptId) {
      if (!db.prepare("SELECT 1 FROM transcripts WHERE id=?").get(transcriptId)) return { status: "failed", warning: "Transcript not found." };
      if (db.prepare("SELECT 1 FROM extraction_runs WHERE transcript_id=? AND status='completed' LIMIT 1").get(transcriptId)) return { status: "skipped" };
      const extractor = options.getMemoryExtractor?.();
      if (!extractor) return { status: "setup_required", warning: "AI memory extraction needs a configured LLM — set one up in Settings." };
      try {
        const extraction = await extractMemoryObjectsForTranscript(db, { transcriptId, extractor });
        const runStatus = db.prepare("SELECT status FROM extraction_runs WHERE id=?").get(extraction.extractionRunId) as { status: string } | undefined;
        if (runStatus?.status !== "completed") return { status: "failed", warning: "AI memory extraction did not complete. Please try again." };
      } catch {
        return { status: "failed", warning: "AI memory extraction did not complete. Please try again." };
      }
      try { await indexTranscriptForRetrieval(db, transcriptId); } catch { /* indexing is best-effort */ }
      // Same live conflict-detection hook as uploadTranscript (deterministic, offline, idempotent by pair).
      try { detectAndPersistConflictsForTranscript(db, transcriptId, { now: options.now }); } catch { /* best-effort */ }
      return { status: "extracted" };
    },
    async deleteTranscript(id) {
      // Transactional hard delete; triggers downgrade dependent memories/conflicts/answers. Generated
      // Markdown self-prunes on the next sync (we never touch it here).
      return { status: "deleted", summary: createTranscriptsRepo(db).deleteTranscript(id) };
    },
    async syncGeneratedGraphNotes(): Promise<GeneratedSyncResult> {
      // File writing + on-disk vault path live in the Obsidian plugin; headless/MCP callers have neither.
      if (!options.syncGeneratedViews) {
        return { status: "unavailable", message: "Generated graph notes can only be synced inside the Obsidian plugin. Use the \"Sync generated graph notes\" command." };
      }
      return options.syncGeneratedViews();
    },
  };
}
