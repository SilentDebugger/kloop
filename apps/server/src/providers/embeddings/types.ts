/**
 * Embedding provider abstraction (BYO-embeddings).
 * All providers return vectors normalized to EMBEDDING_DIMENSIONS (config):
 * flexible-output models are asked for that size directly; fixed-size models
 * are truncated / zero-padded and re-normalized (L2).
 */
/** Attribution for the ai_usage ledger (cost analytics). */
export interface AiCallMeta {
  orgId?: string | null;
  purpose?: string;
}

export interface EmbeddingProvider {
  /** provider id, e.g. "gemini" */
  name: string;
  /** model identifier stored alongside each vector (embedding_model column) */
  model: string;
  /** Embed a batch of texts. Order of results matches input order. */
  embed(texts: string[], meta?: AiCallMeta): Promise<number[][]>;
  /**
   * Embed media (image/audio) if natively supported (gemini-embedding-2).
   * Providers without multimodal support return null — caller falls back to
   * embedding the extracted text (OCR/transcript).
   */
  embedMedia?(data: Buffer, mimeType: string, meta?: AiCallMeta): Promise<number[] | null>;
}

/** Fit a raw model vector to the configured dimension: truncate or zero-pad, then L2-normalize. */
export function fitDimensions(vec: number[], dim: number): number[] {
  let out: number[];
  if (vec.length === dim) out = [...vec];
  else if (vec.length > dim) out = vec.slice(0, dim);
  else out = [...vec, ...new Array(dim - vec.length).fill(0)];
  const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0)) || 1;
  return out.map((x) => x / norm);
}
