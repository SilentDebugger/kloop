import { config } from "../../config.js";
import { recordAiUsage } from "../../lib/aiUsage.js";
import type { AiCallMeta, CompleteOptions, LlmProvider } from "./types.js";

export class AnthropicLlmProvider implements LlmProvider {
  name = "anthropic";
  model = config.ANTHROPIC_MODEL;

  private async messages(
    content: unknown,
    opts: { system?: string; maxTokens?: number; temperature?: number },
    usage: { operation: "complete" | "ocr"; purpose?: string; orgId?: string | null },
  ): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.2,
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: "user", content }],
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as {
      content: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
    };
    recordAiUsage({
      orgId: usage.orgId,
      provider: this.name,
      model: this.model,
      operation: usage.operation,
      purpose: usage.purpose,
      // Anthropic reports cache reads separately from input_tokens; the ledger
      // stores input as the full prompt (cached included), so add them back.
      inputTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.cache_read_input_tokens ?? 0),
      cachedTokens: data.usage?.cache_read_input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
      exact: data.usage != null,
    });
    return data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const prompt = opts.json
      ? `${opts.prompt}\n\nRespond with valid JSON only — no prose, no code fences.`
      : opts.prompt;
    return this.messages(prompt, opts, { operation: "complete", purpose: opts.task, orgId: opts.orgId });
  }

  async ocr(image: Buffer, mimeType: string, meta?: AiCallMeta): Promise<string | null> {
    return this.messages(
      [
        {
          type: "image",
          source: { type: "base64", media_type: mimeType, data: image.toString("base64") },
        },
        {
          type: "text",
          text: "Extract ALL text visible in this image (error messages, codes, labels, UI text). Reply with the extracted text only. If there is no text, describe the image in one factual sentence.",
        },
      ],
      { maxTokens: 1024, temperature: 0 },
      { operation: "ocr", purpose: meta?.purpose, orgId: meta?.orgId },
    );
  }

  // Anthropic has no transcription API — audio falls back to another provider or is skipped.
}
