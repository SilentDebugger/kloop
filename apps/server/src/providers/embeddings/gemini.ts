import { config } from "../../config.js";
import { fitDimensions, type EmbeddingProvider } from "./types.js";

/**
 * Google gemini-embedding-2 — the default. Natively multimodal: text, images,
 * and audio map into one embedding space, so a photo of an error screen can be
 * matched against text articles directly. Supports flexible output dimensions
 * (128-3072, MRL-trained) so we request EMBEDDING_DIMENSIONS exactly.
 */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  name = "gemini";
  model = config.GEMINI_EMBEDDING_MODEL;

  private endpoint(method: string): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:${method}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(this.endpoint("batchEmbedContents"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.GEMINI_API_KEY ?? "" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${this.model}`,
          content: { parts: [{ text: text.slice(0, 30_000) }] },
          outputDimensionality: config.EMBEDDING_DIMENSIONS,
        })),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`gemini embeddings ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { embeddings: { values: number[] }[] };
    return data.embeddings.map((e) => fitDimensions(e.values, config.EMBEDDING_DIMENSIONS));
  }

  async embedMedia(data: Buffer, mimeType: string): Promise<number[] | null> {
    const res = await fetch(this.endpoint("embedContent"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.GEMINI_API_KEY ?? "" },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ inlineData: { mimeType, data: data.toString("base64") } }] },
        outputDimensionality: config.EMBEDDING_DIMENSIONS,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null; // unsupported media type -> caller falls back to extracted text
    const out = (await res.json()) as { embedding: { values: number[] } };
    return fitDimensions(out.embedding.values, config.EMBEDDING_DIMENSIONS);
  }
}
