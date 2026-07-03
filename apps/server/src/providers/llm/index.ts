import { config } from "../../config.js";
import type { LlmProvider } from "./types.js";
import { MockLlmProvider } from "./mock.js";
import { OpenAiLlmProvider } from "./openai.js";
import { AnthropicLlmProvider } from "./anthropic.js";
import { OllamaLlmProvider } from "./ollama.js";

export type { LlmProvider, CompleteOptions } from "./types.js";
export { extractJson } from "./types.js";

let instance: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (instance) return instance;
  switch (config.LLM_PROVIDER) {
    case "openai":
      if (!config.OPENAI_API_KEY) throw new Error("LLM_PROVIDER=openai requires OPENAI_API_KEY");
      instance = new OpenAiLlmProvider();
      break;
    case "anthropic":
      if (!config.ANTHROPIC_API_KEY) throw new Error("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
      instance = new AnthropicLlmProvider();
      break;
    case "ollama":
      instance = new OllamaLlmProvider();
      break;
    default:
      instance = new MockLlmProvider();
  }
  return instance;
}
