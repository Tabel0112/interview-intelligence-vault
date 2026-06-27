// Typed Ask AI synthesis failures. The live app requires a configured LLM for synthesis; these let the
// frontend distinguish "set up an LLM" from "the LLM failed" — and guarantee we never fabricate a
// deterministic/local answer in the live runtime. Messages are generic and key-free.

/** No LLM is configured but Ask AI had evidence to synthesize. The live app requires an LLM. */
export class SynthesisSetupRequiredError extends Error {
  readonly code = "synthesis_setup_required" as const;
  constructor(message = "Ask AI requires a configured LLM provider. Add a provider, model, and API key in Settings.") {
    super(message);
    this.name = "SynthesisSetupRequiredError";
  }
}

/** An LLM is configured but synthesis could not produce grounded claims (failure, timeout, or empty). */
export class SynthesisFailedError extends Error {
  readonly code = "synthesis_failed" as const;
  constructor(message = "The AI could not generate an answer right now. Please try again.") {
    super(message);
    this.name = "SynthesisFailedError";
  }
}
