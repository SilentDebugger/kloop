import { config } from "../../config.js";
import { fitDimensions, type EmbeddingProvider } from "./types.js";

/**
 * Local embeddings via Ollama (e.g. nomic-embed-text, 768 dims fixed).
 * Vectors are truncated/padded + re-normalized to EMBEDDING_DIMENSIONS.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  name = "ollama";
  model = config.OLLAMA_EMBEDDING_MODEL;

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${config.OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts.map((t) => t.slice(0, 30_000)) }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`ollama embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { embeddings: number[][] };
    return data.embeddings.map((e) => fitDimensions(e, config.EMBEDDING_DIMENSIONS));
  }
}
