import { config } from "../../config.js";
import { recordAiUsage } from "../../lib/aiUsage.js";
import { fitDimensions, type AiCallMeta, type EmbeddingProvider } from "./types.js";

/** Exact per-modality token counts reported by the Gemini API. */
type GeminiUsage = {
  promptTokenCount?: number;
  promptTokenDetails?: { modality?: string; tokenCount?: number }[];
};

function tokensByModality(usage: GeminiUsage | undefined): { text: number; image: number; audio: number } {
  const out = { text: 0, image: 0, audio: 0 };
  for (const d of usage?.promptTokenDetails ?? []) {
    const n = d.tokenCount ?? 0;
    if (d.modality === "IMAGE") out.image += n;
    else if (d.modality === "AUDIO") out.audio += n;
    else out.text += n;
  }
  if (out.text + out.image + out.audio === 0) out.text = usage?.promptTokenCount ?? 0;
  return out;
}

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

  async embed(texts: string[], meta?: AiCallMeta): Promise<number[][]> {
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
    const data = (await res.json()) as { embeddings: { values: number[] }[]; usageMetadata?: GeminiUsage };
    recordAiUsage({
      orgId: meta?.orgId,
      provider: this.name,
      model: this.model,
      operation: "embed_text",
      purpose: meta?.purpose,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      exact: data.usageMetadata != null,
    });
    return data.embeddings.map((e) => fitDimensions(e.values, config.EMBEDDING_DIMENSIONS));
  }

  async embedMedia(data: Buffer, mimeType: string, meta?: AiCallMeta): Promise<number[] | null> {
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
    const out = (await res.json()) as { embedding: { values: number[] }; usageMetadata?: GeminiUsage };
    const tokens = tokensByModality(out.usageMetadata);
    recordAiUsage({
      orgId: meta?.orgId,
      provider: this.name,
      model: this.model,
      operation: "embed_media",
      purpose: meta?.purpose,
      inputTokens: tokens.text,
      imageTokens: tokens.image,
      audioTokens: tokens.audio,
      exact: out.usageMetadata != null,
    });
    return fitDimensions(out.embedding.values, config.EMBEDDING_DIMENSIONS);
  }
}
