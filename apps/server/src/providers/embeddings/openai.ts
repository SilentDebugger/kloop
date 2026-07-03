import { config } from "../../config.js";
import { fitDimensions, type EmbeddingProvider } from "./types.js";

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  name = "openai";
  model = config.OPENAI_EMBEDDING_MODEL;

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${config.OPENAI_BASE_URL}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts.map((t) => t.slice(0, 30_000)),
        // text-embedding-3-* support flexible dimensions natively
        dimensions: config.EMBEDDING_DIMENSIONS,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`openai embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return data.data
      .sort((a, b) => a.index - b.index)
      .map((d) => fitDimensions(d.embedding, config.EMBEDDING_DIMENSIONS));
  }
}
