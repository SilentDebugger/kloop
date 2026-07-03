import { config } from "../../config.js";
import type { EmbeddingProvider } from "./types.js";
import { MockEmbeddingProvider } from "./mock.js";
import { GeminiEmbeddingProvider } from "./gemini.js";
import { OpenAiEmbeddingProvider } from "./openai.js";
import { OllamaEmbeddingProvider } from "./ollama.js";

export type { EmbeddingProvider } from "./types.js";
export { fitDimensions } from "./types.js";

let instance: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (instance) return instance;
  switch (config.EMBEDDING_PROVIDER) {
    case "gemini":
      if (!config.GEMINI_API_KEY) throw new Error("EMBEDDING_PROVIDER=gemini requires GEMINI_API_KEY");
      instance = new GeminiEmbeddingProvider();
      break;
    case "openai":
      if (!config.OPENAI_API_KEY) throw new Error("EMBEDDING_PROVIDER=openai requires OPENAI_API_KEY");
      instance = new OpenAiEmbeddingProvider();
      break;
    case "ollama":
      instance = new OllamaEmbeddingProvider();
      break;
    default:
      instance = new MockEmbeddingProvider();
  }
  return instance;
}
