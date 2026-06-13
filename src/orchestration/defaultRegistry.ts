import { AgentRegistry } from "./agentRegistry.js";
import { answerSynthesisAgent } from "./agents/answerSynthesisAgent.js";
import { chunkingSpanAgent } from "./agents/chunkingSpanAgent.js";
import { cleanupReprocessingAgent } from "./agents/cleanupReprocessingAgent.js";
import { contradictionDetectionAgent } from "./agents/contradictionDetectionAgent.js";
import { evidenceValidationAgent } from "./agents/evidenceValidationAgent.js";
import { createExtractionAgent } from "./agents/extractionAgent.js";
import { ingestionAgent } from "./agents/ingestionAgent.js";
import { retrievalRankingAgent } from "./agents/retrievalRankingAgent.js";
import type { MemoryExtractor } from "../memory/extraction/index.js";

export function createDefaultAgentRegistry(options: { extractor?: MemoryExtractor } = {}): AgentRegistry {
  const registry = new AgentRegistry();
  registry.register(ingestionAgent);
  registry.register(chunkingSpanAgent);
  registry.register(createExtractionAgent(options.extractor));
  registry.register(evidenceValidationAgent);
  registry.register(retrievalRankingAgent);
  registry.register(contradictionDetectionAgent);
  registry.register(answerSynthesisAgent);
  registry.register(cleanupReprocessingAgent);
  return registry;
}
