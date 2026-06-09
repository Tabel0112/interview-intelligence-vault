const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";

function extractOutputText(response) {
  if (typeof response?.output_text === "string") {
    return response.output_text;
  }
  for (const item of response?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") {
        return content.text;
      }
    }
  }
  throw new Error("OpenAI response did not contain JSON text output");
}
export function createOpenAiJsonClient({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
  endpoint = DEFAULT_OPENAI_ENDPOINT,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for real topic segmentation");
  }
  if (!model) {
    throw new Error("OPENAI_MODEL must be a non-empty string");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required for OpenAI API calls");
  }

  return {
    model,
    async generateJson({ prompt, input, schema }) {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          instructions: prompt,
          input: JSON.stringify(input),
          text: {
            format: {
              type: "json_schema",
              name: "topic_segmentation",
              strict: true,
              schema,
            },
          },
        }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const detail =
          body?.error?.message ?? `${response.status} ${response.statusText}`;
        throw new Error(`OpenAI topic segmentation request failed: ${detail}`);
      }

      const text = extractOutputText(body);
      try {
        return {
          json: JSON.parse(text),
          model: body?.model ?? model,
        };
      } catch (error) {
        throw new Error(`OpenAI returned invalid JSON: ${error.message}`);
      }
    },
  };
}
