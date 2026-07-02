import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LlmAuthError, LlmCancelledError, LlmError, LlmRateLimitError, LlmResponseFormatError, LlmTimeoutError,
  LocalDeterministicLlmProvider, redactProviderConfig, redactSecret, REDACTED, runWithTimeout,
  type LlmProvider, type LlmProviderConfig,
} from "../src/llm/index.js";
import { MockLlmProvider } from "../src/llm/testing.js";

const SECRET = "sk-live-PLAINTEXT-SECRET-9876543210";

afterEach(() => {
  vi.useRealTimers();
});

describe("LLM provider abstraction", () => {
  describe("provider interface", () => {
    it("local and mock providers both satisfy the LlmProvider contract", () => {
      const providers: LlmProvider[] = [new LocalDeterministicLlmProvider(), new MockLlmProvider()];
      for (const provider of providers) {
        expect(typeof provider.id).toBe("string");
        expect(typeof provider.model).toBe("string");
        expect(typeof provider.isLocal).toBe("boolean");
        expect(typeof provider.complete).toBe("function");
      }
    });

    it("flags the local provider as offline and the default mock as non-local", () => {
      expect(new LocalDeterministicLlmProvider().isLocal).toBe(true);
      expect(new MockLlmProvider().isLocal).toBe(false);
      expect(new MockLlmProvider({}, { isLocal: true }).isLocal).toBe(true);
    });
  });

  describe("local deterministic provider", () => {
    it("is deterministic: same request yields the same completion", async () => {
      const provider = new LocalDeterministicLlmProvider();
      const first = await provider.complete({ prompt: "what was decided about SQLite?" });
      const second = await provider.complete({ prompt: "what was decided about SQLite?" });
      expect(first).toEqual(second);
      expect(first.provider).toBe("local-deterministic");
      expect(first.model).toBe("local-deterministic-v1");
      expect(first.finishReason).toBe("stop");
      expect(first.text).toContain("what was decided about SQLite?");
    });

    it("returns canonical JSON text when JSON output is requested", async () => {
      const provider = new LocalDeterministicLlmProvider();
      const result = await provider.complete({ prompt: "hello", system: "sys", responseFormat: "json" });
      expect(JSON.parse(result.text)).toEqual({ echo: "hello", system: "sys" });
    });

    it("accepts a custom model identifier", () => {
      expect(new LocalDeterministicLlmProvider("custom-v2").model).toBe("custom-v2");
    });
  });

  describe("mock provider behavior", () => {
    it("returns a scripted completion and records calls", async () => {
      const mock = new MockLlmProvider({ completion: { provider: "mock", model: "mock-model", text: "scripted", finishReason: "stop" } });
      expect((await mock.complete({ prompt: "q1" })).text).toBe("scripted");
      await mock.complete({ prompt: "q2" });
      expect(mock.calls.map((call) => call.prompt)).toEqual(["q1", "q2"]);
    });

    it("supports a function responder and reprogramming", async () => {
      const mock = new MockLlmProvider({ completion: (req) => ({ provider: "mock", model: "mock-model", text: `echo:${req.prompt}`, finishReason: "stop" }) });
      expect((await mock.complete({ prompt: "abc" })).text).toBe("echo:abc");
      mock.setBehavior({ completion: { provider: "mock", model: "mock-model", text: "later", finishReason: "stop" } });
      expect((await mock.complete({ prompt: "x" })).text).toBe("later");
    });
  });

  describe("error handling", () => {
    it("propagates a configured error preserving its subtype", async () => {
      const mock = new MockLlmProvider({ error: new LlmAuthError("bad key", { provider: "mock", model: "mock-model" }) });
      await expect(mock.complete({ prompt: "x" })).rejects.toBeInstanceOf(LlmAuthError);
    });

    it("builds a consistent error hierarchy with correct names", () => {
      for (const error of [
        new LlmTimeoutError("t"), new LlmCancelledError("c"), new LlmAuthError("a"),
        new LlmRateLimitError("r"), new LlmResponseFormatError("f"),
      ]) {
        expect(error).toBeInstanceOf(LlmError);
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe(error.constructor.name);
      }
    });

    it("carries only non-secret context and never the key", () => {
      const error = new LlmAuthError("auth failed", { provider: "mock", model: "mock-model" });
      expect(error.context).toEqual({ provider: "mock", model: "mock-model" });
      expect(JSON.stringify({ message: error.message, context: error.context, str: String(error) })).not.toContain(SECRET);
    });
  });

  describe("timeout / cancellation", () => {
    it("throws LlmTimeoutError when the operation exceeds the timeout", async () => {
      vi.useFakeTimers();
      const mock = new MockLlmProvider({ hang: true });
      const promise = runWithTimeout((signal) => mock.complete({ prompt: "slow" }, { signal }), { timeoutMs: 1000, provider: "mock", model: "mock-model" });
      const expectation = expect(promise).rejects.toBeInstanceOf(LlmTimeoutError);
      await vi.advanceTimersByTimeAsync(1000);
      await expectation;
    });

    it("throws LlmCancelledError when the external signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(runWithTimeout(() => Promise.resolve("never"), { signal: controller.signal })).rejects.toBeInstanceOf(LlmCancelledError);
    });

    it("throws LlmCancelledError when aborted mid-flight", async () => {
      const mock = new MockLlmProvider({ hang: true });
      const controller = new AbortController();
      const promise = runWithTimeout((signal) => mock.complete({ prompt: "slow" }, { signal }), { signal: controller.signal });
      const expectation = expect(promise).rejects.toBeInstanceOf(LlmCancelledError);
      controller.abort();
      await expectation;
    });

    it("resolves normally when the operation finishes before the timeout", async () => {
      const provider = new LocalDeterministicLlmProvider();
      const result = await runWithTimeout((signal) => provider.complete({ prompt: "fast" }, { signal }), { timeoutMs: 1000 });
      expect(result.text).toContain("fast");
    });
  });

  describe("redaction (never log secrets)", () => {
    const config: LlmProviderConfig = { id: "anthropic", model: "claude-x", apiKey: SECRET, baseUrl: "https://example.test", timeoutMs: 30000 };

    it("redactProviderConfig replaces the key with a boolean and drops the secret", () => {
      const redacted = redactProviderConfig(config);
      expect(redacted).toEqual({ id: "anthropic", model: "claude-x", hasApiKey: true, baseUrl: "https://example.test", timeoutMs: 30000 });
      expect(JSON.stringify(redacted)).not.toContain(SECRET);
      expect((redacted as unknown as Record<string, unknown>).apiKey).toBeUndefined();
    });

    it("reports hasApiKey false for a missing or blank key", () => {
      expect(redactProviderConfig({ id: "none", model: "m" }).hasApiKey).toBe(false);
      expect(redactProviderConfig({ id: "none", model: "m", apiKey: "   " }).hasApiKey).toBe(false);
    });

    it("redactSecret strips a known secret from arbitrary text", () => {
      const cleaned = redactSecret(`request failed with token ${SECRET} in header`, SECRET);
      expect(cleaned).not.toContain(SECRET);
      expect(cleaned).toContain(REDACTED);
      expect(redactSecret("no secret here", "")).toBe("no secret here");
    });
  });
});
