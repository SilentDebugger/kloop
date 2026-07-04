import { config } from "../../config.js";
import { recordAiUsage } from "../../lib/aiUsage.js";
import type { CompleteOptions, LlmProvider } from "./types.js";

/** Fully local inference via Ollama — the data-control option. */
export class OllamaLlmProvider implements LlmProvider {
  name = "ollama";
  model = config.OLLAMA_MODEL;

  async complete(opts: CompleteOptions): Promise<string> {
    const res = await fetch(`${config.OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        system: opts.system,
        prompt: opts.prompt,
        stream: false,
        ...(opts.json ? { format: "json" } : {}),
        options: {
          temperature: opts.temperature ?? 0.2,
          num_predict: opts.maxTokens ?? 2048,
        },
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { response: string; prompt_eval_count?: number; eval_count?: number };
    // local inference — cost is always $0, tracked for volume stats only
    recordAiUsage({
      orgId: opts.orgId,
      provider: this.name,
      model: this.model,
      operation: "complete",
      purpose: opts.task,
      inputTokens: data.prompt_eval_count ?? 0,
      outputTokens: data.eval_count ?? 0,
      exact: data.prompt_eval_count != null,
    });
    return data.response;
  }

  async ocr(image: Buffer, _mimeType: string): Promise<string | null> {
    // Works when the configured model is multimodal (e.g. llava, llama3.2-vision).
    try {
      const res = await fetch(`${config.OLLAMA_BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt: "Extract ALL text visible in this image. Reply with the extracted text only.",
          images: [image.toString("base64")],
          stream: false,
        }),
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { response: string };
      return data.response;
    } catch {
      return null;
    }
  }
}
