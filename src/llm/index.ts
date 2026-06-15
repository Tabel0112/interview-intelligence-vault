// LLM provider abstraction (transport layer). Not wired into Ask AI, retrieval, or embeddings.
// The mock test double (./testing.ts) is intentionally NOT exported here, so production code
// cannot import it.

export * from "./types.js";
export * from "./errors.js";
export * from "./redaction.js";
export * from "./timeout.js";
export { LocalDeterministicLlmProvider } from "./localDeterministicProvider.js";
