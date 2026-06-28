// Phase 1 MCP tools over the existing Transcript Memory Vault backend.
//
// These are PURE async functions (no stdio, no SDK) so they are fully unit-testable offline. The wire
// protocol lives in server.ts. The trust rules are inherited, not re-implemented:
//   - ask_vault calls the existing Ask AI pipeline (api.ask -> askAI): retrieve -> score -> select ->
//     grounded LLM synthesis -> citation/grounding validation -> persist. It returns a validated
//     AnswerBundle, never raw chunks for Claude to synthesize from. Setup-required / LLM-failure persist
//     no fake answer; not-enough-evidence is the existing persisted refusal.
//   - The inspection tools (search_evidence, get_memory_object, get_conflicts) return scored,
//     provenance-backed data with `mv://` links, never secrets.

import { SynthesisFailedError, SynthesisSetupRequiredError } from "../ask-ai/index.js";
import { createConflictRepository } from "../conflicts/index.js";
import type { SqliteDatabase } from "../db/connection.js";
import type { FrontendApi } from "../frontend/index.js";
import { routeHref } from "../frontend/router.js";
import { resolveEvidencePointer } from "../provenance/index.js";
import { searchEvidencePointers } from "../retrieval/index.js";
import { toAnswerBundle } from "./answerBundle.js";

export class McpInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpInputError";
  }
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

const PREVIEW_LIMIT = 280;
const preview = (value: unknown, limit = PREVIEW_LIMIT): string => {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
};
const asRecord = (args: unknown): Record<string, unknown> => (args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {});
const requireString = (args: Record<string, unknown>, key: string): string => {
  const value = args[key];
  if (typeof value !== "string" || !value.trim()) throw new McpInputError(`"${key}" must be a non-empty string`);
  return value.trim();
};
const clampLimit = (value: unknown, fallback: number, max: number): number => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), 1), max);
};
const stringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((v) => typeof v === "string") && value.length ? value as string[] : undefined;

interface AnswerRunRow { id: string; question: string; evidence_confidence: string; not_enough_evidence: number; answer_markdown: string; created_at: string }
const answerSummary = (row: AnswerRunRow) => ({
  answer_id: row.id,
  question: preview(row.question, 200),
  created_at: row.created_at,
  evidence_confidence: row.evidence_confidence,
  not_enough_evidence: row.not_enough_evidence === 1,
  answer_preview: preview(row.answer_markdown),
  answer_uri: routeHref.answer(row.id),
});

export interface VaultToolDeps {
  db: SqliteDatabase;
  api: FrontendApi;
}

export function createVaultTools(deps: VaultToolDeps): { definitions: McpToolDefinition[]; call: (name: string, args: unknown) => Promise<unknown> } {
  const { db, api } = deps;

  const definitions: McpToolDefinition[] = [
    {
      name: "ask_vault",
      description:
        "Primary answer tool. Ask a question and get a validated, citation-grounded AnswerBundle produced by the vault's evidence-first Ask AI pipeline (retrieve → score → select → grounded LLM synthesis → citation validation). Always use this to answer the user — do NOT synthesize your own answer from search_evidence. Returns a refusal when there is not enough evidence; returns a setup-required / llm-failed state (persisting no answer) when the LLM is unconfigured or fails.",
      inputSchema: {
        type: "object",
        properties: {
          question: { type: "string", description: "The user's question." },
          transcript_filter: { type: "object", properties: { transcript_ids: { type: "array", items: { type: "string" } } } },
          max_evidence: { type: "number", description: "Optional cap on evidence items considered." },
        },
        required: ["question"],
        additionalProperties: false,
      },
      handler: async (raw) => {
        const args = asRecord(raw);
        const question = requireString(args, "question");
        const transcriptIds = stringArray(asRecord(args.transcript_filter).transcript_ids);
        const maxEvidence = args.max_evidence === undefined ? undefined : clampLimit(args.max_evidence, 8, 50);
        try {
          const answer = await api.ask(question, { transcriptIds, maxEvidence });
          return { ok: true, answer_bundle: toAnswerBundle(answer) };
        } catch (error) {
          if (error instanceof SynthesisSetupRequiredError) return { ok: false, state: "setup_required", message: error.message };
          if (error instanceof SynthesisFailedError) return { ok: false, state: "llm_failed", message: error.message };
          throw error;
        }
      },
    },
    {
      name: "get_answer",
      description: "Reconstruct a previously persisted, validated answer by id. Returns the same AnswerBundle (claims, citations, evidence links, conflicts, follow-ups).",
      inputSchema: { type: "object", properties: { answer_id: { type: "string" } }, required: ["answer_id"], additionalProperties: false },
      handler: async (raw) => {
        const view = await api.getAnswer(requireString(asRecord(raw), "answer_id"));
        if (!view) return { ok: false, state: "not_found" };
        return { ok: true, answer_bundle: toAnswerBundle(view, { brokenCitationIds: view.brokenCitationIds }) };
      },
    },
    {
      name: "list_recent_answers",
      description: "List recent persisted Ask AI answers (most recent first) as size-limited summaries. Use get_answer for the full validated bundle.",
      inputSchema: { type: "object", properties: { limit: { type: "number" } }, additionalProperties: false },
      handler: async (raw) => {
        const limit = clampLimit(asRecord(raw).limit, 20, 50);
        const rows = db.prepare("SELECT id, question, evidence_confidence, not_enough_evidence, answer_markdown, created_at FROM ask_ai_runs ORDER BY created_at DESC, id DESC LIMIT ?").all(limit) as AnswerRunRow[];
        return { answers: rows.map(answerSummary) };
      },
    },
    {
      name: "search_vault_answers",
      description: "Search PREVIOUS persisted answers/questions (not raw transcripts) for a phrase. Returns size-limited answer summaries; use get_answer for the full bundle.",
      inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"], additionalProperties: false },
      handler: async (raw) => {
        const args = asRecord(raw);
        const like = `%${requireString(args, "query")}%`;
        const limit = clampLimit(args.limit, 20, 50);
        const rows = db.prepare("SELECT id, question, evidence_confidence, not_enough_evidence, answer_markdown, created_at FROM ask_ai_runs WHERE question LIKE ? OR answer_markdown LIKE ? ORDER BY created_at DESC, id DESC LIMIT ?").all(like, like, limit) as AnswerRunRow[];
        return { answers: rows.map(answerSummary) };
      },
    },
    {
      name: "search_evidence",
      description: "INSPECTION/DEBUG ONLY — returns scored, provenance-backed evidence cards (not unscored raw chunks). For user-facing answers, use ask_vault instead; do not synthesize an answer from these cards.",
      inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"], additionalProperties: false },
      handler: async (raw) => {
        const args = asRecord(raw);
        const query = requireString(args, "query");
        const limit = clampLimit(args.limit, 10, 25);
        const candidates = await searchEvidencePointers(db, { query, mode: "hybrid", finalLimit: limit, requireEvidencePointers: true });
        const cards = candidates.map((candidate) => {
          const resolved = resolveEvidencePointer(db, candidate.targetId);
          if (!resolved.ok) {
            return { evidence_pointer_id: candidate.targetId, score: candidate.finalScore, confidence: "broken", quote_preview: preview(candidate.quote ?? candidate.textPreview), source_span_uri: null, evidence_uri: routeHref.evidence(candidate.targetId), warnings: [`broken: ${resolved.reason}`] };
          }
          const e = resolved.evidence;
          return {
            evidence_pointer_id: e.evidence_pointer_id,
            source_pointer_id: e.source_pointer_uri,
            score: candidate.finalScore,
            confidence: e.evidence_strength,
            quote_preview: preview(resolved.spanText || candidate.quote),
            source_span_uri: routeHref.transcript(e.transcript_id, e.span_id),
            evidence_uri: routeHref.evidence(e.evidence_pointer_id),
            warnings: e.evidence_strength === "weak" ? ["weak evidence — do not treat as strong truth"] : [],
          };
        });
        return { evidence: cards, note: "Inspection only. Use ask_vault for grounded, validated user-facing answers." };
      },
    },
    {
      name: "get_memory_object",
      description: "Inspect a canonical memory object with its provenance/evidence pointers, status, and trust state. Memory object text is NOT evidence on its own — rely on the linked evidence pointers.",
      inputSchema: { type: "object", properties: { memory_object_id: { type: "string" } }, required: ["memory_object_id"], additionalProperties: false },
      handler: async (raw) => {
        const id = requireString(asRecord(raw), "memory_object_id");
        const view = await api.getMemory(id);
        if (!view) return { ok: false, state: "not_found" };
        return {
          ok: true,
          memory_object: {
            memory_object_id: view.memory.id,
            type: view.memory.type,
            title: view.memory.title,
            body: preview(view.memory.body, 1000),
            status: view.memory.status,
            trust_state: view.trustState,
            confidence: view.memory.confidence,
            user_corrected: view.memory.userCorrected,
            memory_uri: routeHref.memory(view.memory.id),
            evidence: view.evidence.map((e) => ({
              evidence_pointer_id: e.id,
              confidence: e.strength,
              quote_preview: preview(e.quotePreview || e.spanText),
              source_span_uri: routeHref.transcript(e.transcriptId, e.spanId),
              evidence_uri: routeHref.evidence(e.id),
              broken: Boolean(e.brokenReason),
            })),
            note: "Memory object text is not evidence on its own; rely on the linked evidence pointers.",
          },
        };
      },
    },
    {
      name: "get_conflicts",
      description: "List active conflicts/tensions between sources, with both sides and evidence links. Optionally filter by a topic substring.",
      inputSchema: { type: "object", properties: { topic: { type: "string" }, limit: { type: "number" } }, additionalProperties: false },
      handler: async (raw) => {
        const args = asRecord(raw);
        const topic = typeof args.topic === "string" ? args.topic.trim().toLowerCase() : "";
        const limit = clampLimit(args.limit, 10, 25);
        const all = createConflictRepository(db).listActiveConflicts();
        const matched = (topic ? all.filter((c) => `${c.summary} ${c.explanation}`.toLowerCase().includes(topic)) : all).slice(0, limit);
        return {
          conflicts: matched.map((c) => ({
            conflict_id: c.id,
            kind: c.kind,
            status: c.status,
            summary: c.summary,
            explanation: preview(c.explanation, 500),
            trust_state: "conflicting",
            sides: [
              { target_type: c.leftTargetType, target_id: c.leftTargetId },
              { target_type: c.rightTargetType, target_id: c.rightTargetId },
            ],
            evidence_uris: [...new Set(c.evidenceLinks.map((link) => routeHref.evidence(link.evidencePointerId)))],
          })),
        };
      },
    },
  ];

  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  return {
    definitions,
    async call(name, args) {
      const definition = byName.get(name);
      if (!definition) throw new McpInputError(`Unknown tool: ${name}`);
      return definition.handler(asRecord(args));
    },
  };
}
