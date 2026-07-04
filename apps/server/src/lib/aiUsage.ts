import { db, tables } from "../db/index.js";
import { logger } from "./logger.js";

/**
 * AI usage ledger: every provider API call records the token counts the
 * provider itself reported, priced at the rates below. Costs are computed and
 * stored at call time (so later price changes don't rewrite history); the raw
 * counts stay in the row for auditing/recomputation.
 *
 * Rates are USD per 1M tokens unless noted. Verified against the official
 * pricing pages (developers.openai.com/api/docs/pricing,
 * ai.google.dev/gemini-api/docs/pricing) — update when providers change them.
 */
export interface ModelRates {
  /** per 1M input (prompt) tokens */
  inputPerM?: number;
  /** per 1M cached input tokens (prompt-cache hits, billed at a discount) */
  cachedInputPerM?: number;
  /** per 1M output (completion) tokens */
  outputPerM?: number;
  /** per 1M image tokens (multimodal embeddings) */
  imagePerM?: number;
  /** per 1M audio tokens (multimodal embeddings) */
  audioPerM?: number;
  /** per minute of audio (whisper-style transcription) */
  perMinute?: number;
}

const RATES: Record<string, ModelRates> = {
  // -- OpenAI chat -----------------------------------------------------------
  "gpt-4o-mini": { inputPerM: 0.15, cachedInputPerM: 0.075, outputPerM: 0.6 },
  "gpt-4o": { inputPerM: 2.5, cachedInputPerM: 1.25, outputPerM: 10 },
  "gpt-4.1-mini": { inputPerM: 0.4, cachedInputPerM: 0.1, outputPerM: 1.6 },
  "gpt-4.1": { inputPerM: 2, cachedInputPerM: 0.5, outputPerM: 8 },
  // -- OpenAI audio ----------------------------------------------------------
  "whisper-1": { perMinute: 0.006 },
  // -- OpenAI embeddings -----------------------------------------------------
  "text-embedding-3-small": { inputPerM: 0.02 },
  "text-embedding-3-large": { inputPerM: 0.13 },
  // -- Gemini embeddings -----------------------------------------------------
  "gemini-embedding-2": { inputPerM: 0.2, imagePerM: 0.45, audioPerM: 6.5 },
  "gemini-embedding-001": { inputPerM: 0.15 },
  // -- Anthropic -------------------------------------------------------------
  "claude-sonnet-4-5": { inputPerM: 3, cachedInputPerM: 0.3, outputPerM: 15 },
  "claude-haiku-4-5": { inputPerM: 1, cachedInputPerM: 0.1, outputPerM: 5 },
};

/** Local/free providers — always $0, tracked for volume stats only. */
const FREE_PROVIDERS = new Set(["ollama", "mock"]);

export function ratesFor(provider: string, model: string): ModelRates | null {
  if (FREE_PROVIDERS.has(provider)) return {};
  // exact match first, then prefix (dated snapshots like gpt-4o-mini-2024-07-18)
  if (RATES[model]) return RATES[model];
  const prefix = Object.keys(RATES)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return prefix ? RATES[prefix] : null;
}

export interface AiUsageEntry {
  orgId?: string | null;
  provider: string;
  model: string;
  operation: "complete" | "ocr" | "transcribe" | "embed_text" | "embed_media";
  purpose?: string | null;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  imageTokens?: number;
  audioTokens?: number;
  mediaSeconds?: number;
  /** false when the provider reported no usage and the counts are estimates */
  exact?: boolean;
}

export function computeCostUsd(e: AiUsageEntry): number {
  const r = ratesFor(e.provider, e.model);
  if (!r) return 0;
  const cached = e.cachedTokens ?? 0;
  const uncachedInput = Math.max(0, (e.inputTokens ?? 0) - cached);
  let cost = 0;
  cost += (uncachedInput / 1e6) * (r.inputPerM ?? 0);
  cost += (cached / 1e6) * (r.cachedInputPerM ?? r.inputPerM ?? 0);
  cost += ((e.outputTokens ?? 0) / 1e6) * (r.outputPerM ?? 0);
  cost += ((e.imageTokens ?? 0) / 1e6) * (r.imagePerM ?? 0);
  cost += ((e.audioTokens ?? 0) / 1e6) * (r.audioPerM ?? 0);
  cost += ((e.mediaSeconds ?? 0) / 60) * (r.perMinute ?? 0);
  return cost;
}

/**
 * Fire-and-forget: usage accounting must never break or slow the AI call
 * itself. Awaiting is optional; failures are logged and swallowed.
 */
export function recordAiUsage(e: AiUsageEntry): void {
  const costUsd = computeCostUsd(e);
  void db
    .insert(tables.aiUsage)
    .values({
      orgId: e.orgId ?? null,
      provider: e.provider,
      model: e.model,
      operation: e.operation,
      purpose: e.purpose ?? null,
      inputTokens: e.inputTokens ?? 0,
      cachedTokens: e.cachedTokens ?? 0,
      outputTokens: e.outputTokens ?? 0,
      imageTokens: e.imageTokens ?? 0,
      audioTokens: e.audioTokens ?? 0,
      mediaSeconds: e.mediaSeconds ?? 0,
      costUsd,
      exact: e.exact ?? true,
    })
    .catch((err) => logger.warn("ai usage recording failed", { err: String(err) }));
}
