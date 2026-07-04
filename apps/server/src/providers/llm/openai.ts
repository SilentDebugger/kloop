import { config } from "../../config.js";
import { recordAiUsage } from "../../lib/aiUsage.js";
import type { AiCallMeta, CompleteOptions, LlmProvider } from "./types.js";

type ChatUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

export class OpenAiLlmProvider implements LlmProvider {
  name = "openai";
  model = config.OPENAI_MODEL;

  private async chat(
    messages: unknown[],
    opts: { json?: boolean; maxTokens?: number; temperature?: number },
    usage: { operation: "complete" | "ocr"; purpose?: string; orgId?: string | null },
  ): Promise<string> {
    const res = await fetch(`${config.OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: opts.maxTokens ?? 2048,
        temperature: opts.temperature ?? 0.2,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { choices: { message: { content: string } }[]; usage?: ChatUsage };
    recordAiUsage({
      orgId: usage.orgId,
      provider: this.name,
      model: this.model,
      operation: usage.operation,
      purpose: usage.purpose,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      exact: data.usage != null,
    });
    return data.choices[0]?.message?.content ?? "";
  }

  async complete(opts: CompleteOptions): Promise<string> {
    const messages = [
      ...(opts.system ? [{ role: "system", content: opts.system }] : []),
      { role: "user", content: opts.prompt },
    ];
    return this.chat(messages, opts, { operation: "complete", purpose: opts.task, orgId: opts.orgId });
  }

  async ocr(image: Buffer, mimeType: string, meta?: AiCallMeta): Promise<string | null> {
    const messages = [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract ALL text visible in this image (error messages, codes, labels, UI text). Reply with the extracted text only. If there is no text, describe the image in one factual sentence.",
          },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${image.toString("base64")}` } },
        ],
      },
    ];
    return this.chat(messages, { maxTokens: 1024, temperature: 0 }, { operation: "ocr", purpose: meta?.purpose, orgId: meta?.orgId });
  }

  async transcribe(audio: Buffer, mimeType: string, filename: string, meta?: AiCallMeta): Promise<string | null> {
    const form = new FormData();
    form.append("model", "whisper-1");
    form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
    // verbose_json includes the audio duration — whisper bills per minute
    form.append("response_format", "verbose_json");
    const res = await fetch(`${config.OPENAI_BASE_URL}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.OPENAI_API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`openai transcription ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { text: string; duration?: number };
    recordAiUsage({
      orgId: meta?.orgId,
      provider: this.name,
      model: "whisper-1",
      operation: "transcribe",
      purpose: meta?.purpose,
      mediaSeconds: data.duration ?? 0,
      exact: data.duration != null,
    });
    return data.text;
  }
}
