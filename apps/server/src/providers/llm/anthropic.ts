import { config } from "../../config.js";
import type { CompleteOptions, LlmProvider } from "./types.js";

export class AnthropicLlmProvider implements LlmProvider {
  name = "anthropic";
  model = config.ANTHROPIC_MODEL;

  private async messages(content: unknown, opts: { system?: string; maxTokens?: number; temperature?: number }): Promise<string> {
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
    const data = (await res.json()) as { content: { type: string; text?: string }[] };
    return data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const prompt = opts.json
      ? `${opts.prompt}\n\nRespond with valid JSON only — no prose, no code fences.`
      : opts.prompt;
    return this.messages(prompt, opts);
  }

  async ocr(image: Buffer, mimeType: string): Promise<string | null> {
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
    );
  }

  // Anthropic has no transcription API — audio falls back to another provider or is skipped.
}
