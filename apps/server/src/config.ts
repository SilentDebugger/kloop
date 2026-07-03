import { z } from "zod";

/**
 * 12-factor env-driven configuration. Every knob is documented in .env.example.
 * Parsed once at boot; invalid config fails fast with a readable message.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(8787),
  PUBLIC_URL: z.string().default("http://localhost:8787"),
  APP_SECRET: z.string().min(16, "APP_SECRET must be at least 16 chars — generate with `openssl rand -hex 32`").default("dev-secret-do-not-use-in-production"),

  DATABASE_URL: z.string().default("postgres://kloop:kloop@localhost:5433/kloop"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./data/storage"),
  STORAGE_S3_ENDPOINT: z.string().optional(),
  STORAGE_S3_REGION: z.string().default("us-east-1"),
  STORAGE_S3_BUCKET: z.string().default("kloop"),
  STORAGE_S3_ACCESS_KEY: z.string().optional(),
  STORAGE_S3_SECRET_KEY: z.string().optional(),
  STORAGE_S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  LLM_PROVIDER: z.enum(["openai", "anthropic", "ollama", "mock"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-5"),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("llama3.1"),

  EMBEDDING_PROVIDER: z.enum(["gemini", "openai", "ollama", "mock"]).default("mock"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(64).max(3072).default(1536),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-2"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),

  AUTOMATION_TIER: z.coerce.number().int().min(0).max(3).default(0),

  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default("kloop <kloop@localhost>"),
  EMAIL_IN_SECRET: z.string().optional(),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SEED_DEMO: z.coerce.boolean().default(false),
});

export type Config = z.infer<typeof envSchema>;

function load(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`Invalid configuration:\n${issues}`);
    process.exit(1);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === "production" && cfg.APP_SECRET === "dev-secret-do-not-use-in-production") {
    console.error("APP_SECRET must be set in production. Generate one: openssl rand -hex 32");
    process.exit(1);
  }
  return cfg;
}

export const config = load();
