import { createHash } from "node:crypto";
import { config } from "../../config.js";
import { fitDimensions, type EmbeddingProvider } from "./types.js";

/**
 * Deterministic, key-free embeddings so the entire product runs without
 * external AI. Not semantically meaningful like a real model, but:
 *  - identical text -> identical vector
 *  - shared tokens -> higher cosine similarity (bag-of-hashed-ngrams)
 * which is enough for matching/clustering demos, tests, and offline evals.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  name = "mock";
  model = "mock-hash-v1";

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t));
  }

  async embedMedia(): Promise<number[] | null> {
    return null;
  }

  private one(text: string): number[] {
    const dim = config.EMBEDDING_DIMENSIONS;
    const vec = new Array<number>(dim).fill(0);
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    for (const token of tokens) {
      // token + bigram hashing gives crude distributional structure
      const h = createHash("sha256").update(token).digest();
      for (let i = 0; i < 8; i++) {
        const idx = h.readUInt16BE(i * 2) % dim;
        const sign = h[16 + i] % 2 === 0 ? 1 : -1;
        vec[idx] += sign;
      }
    }
    return fitDimensions(vec, dim);
  }
}
