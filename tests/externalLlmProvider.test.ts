import { afterEach, describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import {
  createHttpLlmTransport, ExternalLlmProvider, LlmAuthError, LlmCancelledError, LlmError, LlmProviderError,
  LlmRateLimitError, LlmResponseFormatError, LlmTimeoutError,
  type ExternalLlmProviderConfig, type LlmTransport, type LlmTransportRequest, type LlmTransportResponse,
} from "../src/llm/index.js";

const SECRET = "sk-llm-PLANTED-SECRET-1234567890";

function makeTransport(responder: (req: LlmTransportRequest) => LlmTransportResponse) {
  const calls: LlmTransportRequest[] = [];
  const transport: LlmTransport = async (req) => { calls.push(req); return responder(req); };
  return { transport, calls };
}

const chatResponse = (content: string, extra: Record<string, unknown> = {}): LlmTransportResponse => ({
  status: 200,
  body: { choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 }, ...extra },
});

// A transport that never resolves until its signal aborts (drives timeout/cancellation).
const hangingTransport: LlmTransport = (req) =>
  new Promise((_resolve, reject) => {
    if (req.signal?.aborted) { reject(new Error("aborted")); return; }
    req.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

const config = (transport: LlmTransport, overrides: Partial<ExternalLlmProviderConfig> = {}): ExternalLlmProviderConfig => ({
  id: "openai", model: "gpt-4o-mini", apiKey: SECRET, baseUrl: "https://api.test/v1", transport, ...overrides,
});

afterEach(() => vi.useRealTimers());

describe("ExternalLlmProvider — construction and metadata", () => {
  it("exposes only id/model/isLocal and requires a non-blank key", () => {
    const provider = new ExternalLlmProvider(config(makeTransport(() => chatResponse("hi")).transport));
    expect(provider.id).toBe("openai");
    expect(provider.model).toBe("gpt-4o-mini");
    expect(provider.isLocal).toBe(false);
    expect(() => new ExternalLlmProvider(config(makeTransport(() => chatResponse("x")).transport, { apiKey: undefined }))).toThrow(LlmAuthError);
    expect(() => new ExternalLlmProvider(config(makeTransport(() => chatResponse("x")).transport, { apiKey: "   " }))).toThrow(LlmAuthError);
  });
});

describe("ExternalLlmProvider — request/response", () => {
  it("builds an OpenAI-compatible chat request and parses the completion", async () => {
    const { transport, calls } = makeTransport(() => chatResponse("hello world"));
    const provider = new ExternalLlmProvider(config(transport));
    const result = await provider.complete({ system: "be brief", prompt: "say hi", maxOutputTokens: 32 });
    expect(result).toEqual({ provider: "openai", model: "gpt-4o-mini", text: "hello world", finishReason: "stop", usage: { inputTokens: 7, outputTokens: 3 } });
    expect(calls[0].url).toBe("https://api.test/v1/chat/completions");
    expect(calls[0].headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(calls[0].body)).toEqual({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: "be brief" }, { role: "user", content: "say hi" }],
      max_tokens: 32,
    });
  });

  it("omits the system message when not provided and requests JSON mode when asked", async () => {
    const { transport, calls } = makeTransport(() => chatResponse("{}"));
    await new ExternalLlmProvider(config(transport)).complete({ prompt: "p", responseFormat: "json" });
    const sent = JSON.parse(calls[0].body);
    expect(sent.messages).toEqual([{ role: "user", content: "p" }]);
    expect(sent.response_format).toEqual({ type: "json_object" });
  });

  it("maps finish_reason length and tolerates missing usage", async () => {
    const { transport } = makeTransport(() => ({ status: 200, body: { choices: [{ message: { content: "trimmed" }, finish_reason: "length" }] } }));
    const result = await new ExternalLlmProvider(config(transport)).complete({ prompt: "p" });
    expect(result.finishReason).toBe("length");
    expect(result.usage).toBeUndefined();
  });

  it("maps HTTP status codes to typed errors", async () => {
    for (const [status, type] of [[401, LlmAuthError], [403, LlmAuthError], [429, LlmRateLimitError], [500, LlmProviderError]] as const) {
      const provider = new ExternalLlmProvider(config(makeTransport(() => ({ status, body: {} })).transport));
      await expect(provider.complete({ prompt: "p" })).rejects.toBeInstanceOf(type);
    }
  });

  it("maps malformed responses to LlmResponseFormatError", async () => {
    const noChoices = new ExternalLlmProvider(config(makeTransport(() => ({ status: 200, body: { foo: 1 } })).transport));
    await expect(noChoices.complete({ prompt: "p" })).rejects.toBeInstanceOf(LlmResponseFormatError);
    const nonString = new ExternalLlmProvider(config(makeTransport(() => ({ status: 200, body: { choices: [{ message: { content: 42 } }] } })).transport));
    await expect(nonString.complete({ prompt: "p" })).rejects.toBeInstanceOf(LlmResponseFormatError);
  });

  it("wraps transport failures as LlmProviderError", async () => {
    const transport: LlmTransport = async () => { throw new Error("socket hang up"); };
    await expect(new ExternalLlmProvider(config(transport)).complete({ prompt: "p" })).rejects.toBeInstanceOf(LlmProviderError);
  });
});

describe("ExternalLlmProvider — timeout and cancellation", () => {
  it("throws LlmTimeoutError when the request exceeds timeoutMs", async () => {
    vi.useFakeTimers();
    const provider = new ExternalLlmProvider(config(hangingTransport, { timeoutMs: 1000 }));
    const promise = provider.complete({ prompt: "slow" });
    const expectation = expect(promise).rejects.toBeInstanceOf(LlmTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await expectation;
  });

  it("throws LlmCancelledError for a pre-aborted or mid-flight signal", async () => {
    const aborted = new AbortController();
    aborted.abort();
    await expect(new ExternalLlmProvider(config(hangingTransport)).complete({ prompt: "p" }, { signal: aborted.signal }))
      .rejects.toBeInstanceOf(LlmCancelledError);

    const controller = new AbortController();
    const promise = new ExternalLlmProvider(config(hangingTransport)).complete({ prompt: "p" }, { signal: controller.signal });
    const expectation = expect(promise).rejects.toBeInstanceOf(LlmCancelledError);
    controller.abort();
    await expectation;
  });

  it("honors a per-call timeoutMs override", async () => {
    vi.useFakeTimers();
    const provider = new ExternalLlmProvider(config(hangingTransport));
    const promise = provider.complete({ prompt: "slow" }, { timeoutMs: 500 });
    const expectation = expect(promise).rejects.toBeInstanceOf(LlmTimeoutError);
    await vi.advanceTimersByTimeAsync(500);
    await expectation;
  });
});

describe("ExternalLlmProvider — key safety", () => {
  it("never includes the API key in errors, while still sending it in the header", async () => {
    const { transport, calls } = makeTransport(() => ({ status: 401, body: { error: { message: "invalid key" } } }));
    let thrown: unknown;
    try { await new ExternalLlmProvider(config(transport)).complete({ prompt: "p" }); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(LlmAuthError);
    const dump = JSON.stringify({ message: (thrown as Error).message, context: (thrown as LlmError).context, str: String(thrown) });
    expect(dump).not.toContain(SECRET);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("redacts the key if an upstream transport error echoes it", async () => {
    const transport: LlmTransport = async () => { throw new Error(`network failed with token ${SECRET} in header`); };
    let thrown: unknown;
    try { await new ExternalLlmProvider(config(transport)).complete({ prompt: "p" }); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(LlmProviderError);
    expect((thrown as Error).message).not.toContain(SECRET);
    expect((thrown as Error).message).toContain("[redacted]");
  });
});

describe("ExternalLlmProvider — serialization/inspection cannot expose the key", () => {
  const provider = () => new ExternalLlmProvider(config(makeTransport(() => chatResponse("x")).transport, { timeoutMs: 30000 }));

  it("JSON.stringify exposes only id/model/isLocal", () => {
    const p = provider();
    expect(JSON.stringify(p)).not.toContain(SECRET);
    expect(JSON.parse(JSON.stringify(p))).toEqual({ id: "openai", model: "gpt-4o-mini", isLocal: false });
  });

  it("spread, key enumeration, and util.inspect never include the key", () => {
    const p = provider();
    expect({ ...p }).toEqual({ id: "openai", model: "gpt-4o-mini", isLocal: false });
    expect(Object.keys(p)).toEqual(["id", "model", "isLocal"]);
    expect(Object.getOwnPropertyNames(p)).toEqual(["id", "model", "isLocal"]);
    expect(Reflect.ownKeys(p)).toEqual(["id", "model", "isLocal"]);
    expect(inspect(p, { showHidden: true, depth: null })).not.toContain(SECRET);
    expect(String(p)).not.toContain(SECRET);
  });
});

describe("createHttpLlmTransport (injected fetch, no real network)", () => {
  it("forwards the request and parses the JSON body", async () => {
    const fakeFetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
      expect(url).toBe("https://api.test/v1/chat/completions");
      expect(init?.headers?.Authorization).toBe(`Bearer ${SECRET}`);
      return { status: 200, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;
    const transport = createHttpLlmTransport(fakeFetch);
    const out = await transport({
      url: "https://api.test/v1/chat/completions", method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` }, body: "{}",
    });
    expect(out).toEqual({ status: 200, body: { ok: true } });
  });
});
