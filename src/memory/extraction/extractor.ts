import { ValidationError } from "../../db/errors.js";
import { buildMemoryExtractionPrompt } from "./prompt.js";
import type { ExtractedMemoryCandidate, ExtractionWindow, MemoryExtractor } from "./types.js";

export interface MemoryExtractionClient {
  generateJson(prompt: string): Promise<unknown>;
}

export class PromptBasedMemoryExtractor implements MemoryExtractor {
  readonly kind = "llm" as const;
  constructor(private readonly client: MemoryExtractionClient, readonly model: string | null = null) {}
  async extract(window: ExtractionWindow): Promise<ExtractedMemoryCandidate[]> {
    const result = await this.client.generateJson(buildMemoryExtractionPrompt(window));
    if (!result || typeof result !== "object" || !Array.isArray((result as { objects?: unknown }).objects)) {
      throw new ValidationError("Extractor returned invalid structured output");
    }
    return (result as { objects: ExtractedMemoryCandidate[] }).objects;
  }
}

export class DeterministicRuleExtractor implements MemoryExtractor {
  readonly kind = "deterministic" as const;
  readonly model = null;
  async extract(window: ExtractionWindow): Promise<ExtractedMemoryCandidate[]> {
    const objects: ExtractedMemoryCandidate[] = [];
    for (const span of window.spans) {
      const text = span.text.trim();
      const lower = text.toLowerCase();
      const body = text.replace(/^[^:]{1,100}:\s*/, "");
      const add = (type: ExtractedMemoryCandidate["type"], title: string, confidence: number) =>
        objects.push({ type, title, body, evidenceSpanIds: [span.spanId], confidence, reason: "Deterministic rule match" });
      if (/\b(decided|decision|will use|must use|source of truth)\b/i.test(text)) add("decision", body.slice(0, 100), 0.95);
      if (/\b(todo|action item|need to|should implement|must add)\b/i.test(text)) add("action_item", body.slice(0, 100), 0.85);
      if (/\?/.test(text)) add("question", body.slice(0, 100), 0.85);
      if (/\b(but|however|concern|object|blocker|doubt)\b/i.test(text)) add("objection", body.slice(0, 100), 0.8);
      if (/\b(should|recommend|idea|could use|suggest)\b/i.test(text) && !lower.includes("should implement")) add("advice_idea", body.slice(0, 100), 0.75);
      if (/\b(topic:)\b/i.test(text)) add("topic", body.replace(/^topic:\s*/i, "").slice(0, 100), 0.8);
      if (/\bquote:\s*/i.test(text)) {
        const quote = text.replace(/^.*?\bquote:\s*/i, "");
        objects.push({ type: "quote", title: quote.slice(0, 100), body: quote, evidenceSpanIds: [span.spanId], confidence: 0.9, reason: "Explicit quote marker" });
      }
    }
    return objects;
  }
}
