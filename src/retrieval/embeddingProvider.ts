import { createHash } from "node:crypto";

export interface EmbeddingProvider {
  name: string; model: string; dimensions: number;
  embedTexts(texts: string[]): Promise<number[][]>;
}

export class DeterministicTestEmbeddingProvider implements EmbeddingProvider {
  readonly name = "deterministic-test";
  readonly model = "token-hash-v1";
  constructor(readonly dimensions = 32) {}
  async embedTexts(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const vector = Array<number>(this.dimensions).fill(0);
      for (const token of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
        const hash = createHash("sha256").update(token).digest();
        vector[hash[0] % this.dimensions] += hash[1] % 2 ? 1 : -1;
      }
      return vector;
    });
  }
}

export class NoopEmbeddingProvider implements EmbeddingProvider {
  readonly name = "noop"; readonly model = "disabled"; readonly dimensions = 0;
  async embedTexts(texts: string[]): Promise<number[][]> { return texts.map(() => []); }
}
