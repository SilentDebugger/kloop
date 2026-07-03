#!/usr/bin/env node
/**
 * create-kloop — interactive setup wizard.
 *
 * Walks through: org basics → database (bundled container or external
 * Postgres, verified live incl. pgvector) → storage → AI providers (keys
 * tested with a real call) → admin account. Writes a fully commented .env,
 * then optionally boots the stack, migrates, and creates the admin.
 */
import { execSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as p from "@clack/prompts";

const cwd = process.cwd();

function bail(message) {
  p.cancel(message ?? "Setup cancelled.");
  process.exit(1);
}

function guard(value) {
  if (p.isCancel(value)) bail();
  return value;
}

async function main() {
  console.clear();
  p.intro("create-kloop — self-hosted support that documents itself");

  if (!existsSync(resolve(cwd, "docker-compose.yml"))) {
    p.log.warn("No docker-compose.yml found in this directory. Run the wizard from your kloop checkout, or copy the generated .env there afterwards.");
  }

  // ---------------------------------------------------------------- org
  const orgName = guard(
    await p.text({
      message: "Organization name",
      placeholder: "Fjord Logistics IT",
      validate: (v) => (v.trim().length < 2 ? "Give it a real name" : undefined),
    }),
  );

  const publicUrl = guard(
    await p.text({
      message: "Public URL where kloop will be reachable",
      initialValue: "http://localhost:8787",
      validate: (v) => (/^https?:\/\//.test(v) ? undefined : "Must start with http:// or https://"),
    }),
  );

  // ---------------------------------------------------------------- database
  const dbMode = guard(
    await p.select({
      message: "Database",
      options: [
        { value: "bundled", label: "Bundled Postgres container (pgvector included)", hint: "recommended" },
        { value: "external", label: "External managed Postgres (Supabase, Neon, RDS…)" },
      ],
    }),
  );

  let databaseUrl = "postgres://kloop:kloop@db:5432/kloop";
  if (dbMode === "external") {
    for (;;) {
      const url = guard(
        await p.text({
          message: "Postgres connection string",
          placeholder: "postgres://user:pass@host:5432/dbname",
          validate: (v) => (/^postgres(ql)?:\/\//.test(v) ? undefined : "Must be a postgres:// URL"),
        }),
      );
      const s = p.spinner();
      s.start("Connecting and checking for the pgvector extension…");
      const check = await checkPostgres(url);
      if (check.ok) {
        s.stop(`Connected — ${check.version}${check.vector ? " · pgvector available" : ""}`);
        if (!check.vector) {
          p.log.error("The `vector` extension is not available on this server. Supabase/Neon/RDS all support it — enable it, or pick the bundled database.");
          continue;
        }
        databaseUrl = url;
        break;
      }
      s.stop("Connection failed");
      p.log.error(check.error);
      const retry = guard(await p.confirm({ message: "Try a different connection string?" }));
      if (!retry) bail();
    }
  }

  // ---------------------------------------------------------------- storage
  const storageMode = guard(
    await p.select({
      message: "Attachment storage",
      options: [
        { value: "local", label: "Local disk (Docker volume)", hint: "recommended to start" },
        { value: "s3", label: "S3-compatible (AWS S3, MinIO, Supabase Storage)" },
      ],
    }),
  );

  const s3 = { endpoint: "", region: "us-east-1", bucket: "kloop", accessKey: "", secretKey: "" };
  if (storageMode === "s3") {
    s3.endpoint = guard(await p.text({ message: "S3 endpoint URL (empty for AWS S3)", defaultValue: "", placeholder: "https://minio.example.com" }));
    s3.region = guard(await p.text({ message: "Region", initialValue: "us-east-1" }));
    s3.bucket = guard(await p.text({ message: "Bucket", initialValue: "kloop" }));
    s3.accessKey = guard(await p.text({ message: "Access key" }));
    s3.secretKey = guard(await p.password({ message: "Secret key" }));
  }

  // ---------------------------------------------------------------- AI providers
  const llmProvider = guard(
    await p.select({
      message: "LLM provider (drafts, structuring, merge proposals)",
      options: [
        { value: "openai", label: "OpenAI", hint: "recommended" },
        { value: "anthropic", label: "Anthropic" },
        { value: "ollama", label: "Ollama (local, free)" },
        { value: "mock", label: "Mock — no keys, deterministic output", hint: "try kloop without any AI account" },
      ],
    }),
  );

  const keys = { openai: "", anthropic: "", gemini: "" };
  if (llmProvider === "openai") {
    keys.openai = await promptAndTestKey("OpenAI API key", (k) => testOpenAi(k));
  } else if (llmProvider === "anthropic") {
    keys.anthropic = await promptAndTestKey("Anthropic API key", (k) => testAnthropic(k));
  }

  const embeddingProvider = guard(
    await p.select({
      message: "Embedding provider (search, clustering, matching)",
      options: [
        { value: "gemini", label: "Google gemini-embedding-2", hint: "multimodal: text + images + audio, recommended" },
        { value: "openai", label: "OpenAI text-embedding-3-small" },
        { value: "ollama", label: "Ollama (local, free)" },
        { value: "mock", label: "Mock — no keys" },
      ],
    }),
  );
  if (embeddingProvider === "gemini") {
    keys.gemini = await promptAndTestKey("Google AI (Gemini) API key", (k) => testGemini(k));
  } else if (embeddingProvider === "openai" && !keys.openai) {
    keys.openai = await promptAndTestKey("OpenAI API key", (k) => testOpenAi(k));
  }

  const automationTier = guard(
    await p.select({
      message: "Automation tier to start with (changeable per-org in admin settings)",
      options: [
        { value: "0", label: "0 — suggestions only", hint: "safest start" },
        { value: "1", label: "1 — AI drafts replies, humans send" },
        { value: "2", label: "2 — auto-answer recurring issues" },
        { value: "3", label: "3 — auto-answer + auto-close on confirmation" },
      ],
    }),
  );

  // ---------------------------------------------------------------- admin
  const adminEmail = guard(
    await p.text({ message: "Admin email", validate: (v) => (v.includes("@") ? undefined : "Not an email") }),
  );
  const adminName = guard(await p.text({ message: "Admin name", initialValue: adminEmail.split("@")[0] ?? "" }));
  const adminPassword = guard(
    await p.password({ message: "Admin password (min 8 chars)", validate: (v) => (v.length >= 8 ? undefined : "Too short") }),
  );
  const seedDemo = guard(await p.confirm({ message: "Also load the demo dataset (Fjord Logistics IT)?", initialValue: false }));

  // ---------------------------------------------------------------- write .env
  const env = renderEnv({
    orgName,
    publicUrl,
    databaseUrl,
    externalDb: dbMode === "external",
    storageMode,
    s3,
    llmProvider,
    embeddingProvider,
    keys,
    automationTier,
    seedDemo,
  });

  const envPath = resolve(cwd, ".env");
  if (existsSync(envPath)) {
    const overwrite = guard(await p.confirm({ message: ".env already exists — overwrite?", initialValue: false }));
    if (!overwrite) bail("Keeping the existing .env.");
  }
  writeFileSync(envPath, env);
  p.log.success(`Wrote ${envPath}`);

  // ---------------------------------------------------------------- boot
  const composeArgs = dbMode === "external" ? "-f docker-compose.yml -f compose.external-db.yml" : "";
  const hasDocker = commandExists("docker");

  if (hasDocker && existsSync(resolve(cwd, "docker-compose.yml"))) {
    const boot = guard(await p.confirm({ message: "Boot the stack now with docker compose?", initialValue: true }));
    if (boot) {
      run(`docker compose ${composeArgs} up -d --build`, "Building and starting containers (first build takes a few minutes)");
      run(`docker compose ${composeArgs} exec api node dist/cli.js migrate`, "Applying database migrations");
      const created = spawnSync(
        "docker",
        [
          "compose",
          ...composeArgs.split(" ").filter(Boolean),
          "exec",
          "api",
          "node",
          "dist/cli.js",
          "admin",
          "create",
          "--org",
          orgName,
          "--email",
          adminEmail,
          "--name",
          adminName,
          "--password",
          adminPassword,
        ],
        { stdio: "inherit" },
      );
      if (created.status !== 0) p.log.warn("Admin creation failed — run it manually: docker compose exec api node dist/cli.js admin create");
      if (seedDemo) run(`docker compose ${composeArgs} exec api node dist/cli.js seed`, "Seeding demo data");
      run(`docker compose ${composeArgs} exec api node dist/cli.js doctor`, "Running health checks");
      p.outro(`kloop is up → ${publicUrl}  (sign in as ${adminEmail})`);
      return;
    }
  } else if (!hasDocker) {
    p.log.warn("Docker not found — install Docker, then run: docker compose up -d");
  }

  p.note(
    [
      `docker compose ${composeArgs} up -d`.replace(/\s+/g, " "),
      "docker compose exec api node dist/cli.js migrate",
      `docker compose exec api node dist/cli.js admin create --org "${orgName}" --email ${adminEmail}`,
      seedDemo ? "docker compose exec api node dist/cli.js seed" : null,
    ]
      .filter(Boolean)
      .join("\n"),
    "Next steps",
  );
  p.outro(`Config written. kloop will be reachable at ${publicUrl}`);
}

/* ---------------------------------------------------------------------- */

async function checkPostgres(url) {
  try {
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
    await client.connect();
    const version = (await client.query("select version()")).rows[0].version.split(" on ")[0];
    const vector = (await client.query("select 1 from pg_available_extensions where name = 'vector'")).rowCount > 0;
    await client.end();
    return { ok: true, version, vector };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err) };
  }
}

async function promptAndTestKey(label, test) {
  for (;;) {
    const key = guard(await p.password({ message: label }));
    const s = p.spinner();
    s.start("Testing the key with a real API call…");
    const result = await test(key);
    if (result.ok) {
      s.stop("Key works");
      return key;
    }
    s.stop("Key test failed");
    p.log.error(result.error);
    const retry = guard(await p.confirm({ message: "Enter a different key?" }));
    if (!retry) bail();
  }
}

async function testOpenAi(key) {
  try {
    const res = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
    return res.ok ? { ok: true } : { ok: false, error: `OpenAI answered ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err) };
  }
}

async function testAnthropic(key) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(10000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Anthropic answered ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err) };
  }
}

async function testGemini(key) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(10000),
    });
    return res.ok ? { ok: true } : { ok: false, error: `Google AI answered ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err) };
  }
}

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function run(cmd, label) {
  p.log.step(label);
  const result = spawnSync(cmd, { shell: true, stdio: "inherit" });
  if (result.status !== 0) bail(`Command failed: ${cmd}`);
}

function renderEnv(o) {
  const secret = randomBytes(32).toString("hex");
  return `# kloop configuration — generated by create-kloop
# Every variable is documented in .env.example.

# --- core ---------------------------------------------------------------
NODE_ENV=production
PORT=8787
PUBLIC_URL=${o.publicUrl}
APP_SECRET=${secret}

# --- database -----------------------------------------------------------
${o.externalDb ? "# external managed Postgres (start with: docker compose -f docker-compose.yml -f compose.external-db.yml up -d)" : "# bundled pgvector container from docker-compose.yml"}
DATABASE_URL=${o.databaseUrl}

# --- storage ------------------------------------------------------------
STORAGE_DRIVER=${o.storageMode}
STORAGE_LOCAL_PATH=/data/storage
${o.storageMode === "s3"
    ? `STORAGE_S3_ENDPOINT=${o.s3.endpoint}
STORAGE_S3_REGION=${o.s3.region}
STORAGE_S3_BUCKET=${o.s3.bucket}
STORAGE_S3_ACCESS_KEY=${o.s3.accessKey}
STORAGE_S3_SECRET_KEY=${o.s3.secretKey}`
    : `# STORAGE_S3_ENDPOINT=
# STORAGE_S3_REGION=us-east-1
# STORAGE_S3_BUCKET=kloop
# STORAGE_S3_ACCESS_KEY=
# STORAGE_S3_SECRET_KEY=`}

# --- AI providers -------------------------------------------------------
LLM_PROVIDER=${o.llmProvider}
EMBEDDING_PROVIDER=${o.embeddingProvider}
EMBEDDING_DIMENSIONS=1536
${o.keys.openai ? `OPENAI_API_KEY=${o.keys.openai}` : "# OPENAI_API_KEY="}
${o.keys.anthropic ? `ANTHROPIC_API_KEY=${o.keys.anthropic}` : "# ANTHROPIC_API_KEY="}
${o.keys.gemini ? `GEMINI_API_KEY=${o.keys.gemini}` : "# GEMINI_API_KEY="}

# --- automation ---------------------------------------------------------
# 0 suggestions only · 1 AI drafts · 2 auto-answer · 3 auto-answer + auto-close
AUTOMATION_TIER=${o.automationTier}

# --- email (magic links + notifications) --------------------------------
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
MAIL_FROM="${o.orgName} support <support@localhost>"

# --- misc ---------------------------------------------------------------
LOG_LEVEL=info
SEED_DEMO=${o.seedDemo ? "true" : "false"}
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
