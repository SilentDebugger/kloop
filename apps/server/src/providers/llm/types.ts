/**
 * LLM provider abstraction (BYO-LLM): OpenAI, Anthropic, local Ollama, or a
 * deterministic mock. Used for: article drafting, merge proposals, reply
 * drafts, resolution structuring, OCR (vision), labels.
 */
export interface CompleteOptions {
  system?: string;
  prompt: string;
  /** request strict JSON output (providers use native JSON modes when available) */
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** org the call is billed to — recorded in the ai_usage ledger */
  orgId?: string | null;
  /**
   * Structured task hint. Real providers ignore it (the prompt carries the
   * instructions); the mock provider switches on it to produce deterministic,
   * genuinely useful output without any API key.
   */
  task?:
    | "article_draft"
    | "structure_capture"
    | "reply_draft"
    | "merge_proposal"
    | "update_proposal"
    | "cluster_label"
    | "auto_answer";
  data?: Record<string, unknown>;
}

/** Attribution for the ai_usage ledger (cost analytics). */
export interface AiCallMeta {
  orgId?: string | null;
  purpose?: string;
}

export interface LlmProvider {
  name: string;
  model: string;
  complete(opts: CompleteOptions): Promise<string>;
  /** Extract text from an image (OCR) if the model supports vision; null otherwise. */
  ocr?(image: Buffer, mimeType: string, meta?: AiCallMeta): Promise<string | null>;
  /** Transcribe audio if supported; null otherwise. */
  transcribe?(audio: Buffer, mimeType: string, filename: string, meta?: AiCallMeta): Promise<string | null>;
}

/** Robust JSON extraction: models occasionally wrap JSON in prose/fences. */
export function extractJson<T>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1].trim()) as T;
    const start = trimmed.search(/[[{]/);
    if (start >= 0) {
      const open = trimmed[start];
      const close = open === "{" ? "}" : "]";
      const end = trimmed.lastIndexOf(close);
      if (end > start) return JSON.parse(trimmed.slice(start, end + 1)) as T;
    }
    throw new Error(`LLM did not return valid JSON: ${trimmed.slice(0, 120)}...`);
  }
}
