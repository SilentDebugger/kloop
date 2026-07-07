/**
 * `kloop doctor` — the same health check the setup wizard runs.
 * Verifies: DB reachable, pgvector available, embeddings working,
 * storage writable, SMTP reachable.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "./db/index.js";
import { config } from "./config.js";

type CheckResult = { name: string; ok: boolean; detail: string };

async function check(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  try {
    const detail = await fn();
    return { name, ok: true, detail };
  } catch (err) {
    return { name, ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export async function runDoctor(): Promise<boolean> {
  const results: CheckResult[] = [];

  results.push(
    await check("database", async () => {
      const r = await db.execute(sql`select version()`);
      const v = String((r.rows[0] as Record<string, unknown>).version ?? "");
      return v.split(" ").slice(0, 2).join(" ");
    }),
  );

  results.push(
    await check("pgvector", async () => {
      const r = await db.execute(
        sql`select extversion from pg_extension where extname = 'vector'`,
      );
      if (r.rows.length === 0) {
        // available but not yet enabled? migrations enable it
        const avail = await db.execute(
          sql`select default_version from pg_available_extensions where name = 'vector'`,
        );
        if (avail.rows.length === 0) throw new Error("pgvector is not installed on this Postgres server");
        return `available (v${(avail.rows[0] as Record<string, unknown>).default_version}) — run \`kloop migrate\` to enable`;
      }
      return `enabled (v${(r.rows[0] as Record<string, unknown>).extversion})`;
    }),
  );

  results.push(
    await check("migrations", async () => {
      const r = await db.execute(
        sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
      );
      return `${(r.rows[0] as Record<string, unknown>).n} applied`;
    }),
  );

  results.push(
    await check(`embeddings (${config.EMBEDDING_PROVIDER})`, async () => {
      const { getEmbeddingProvider } = await import("./providers/embeddings/index.js");
      const provider = getEmbeddingProvider();
      const [vec] = await provider.embed(["kloop doctor healthcheck"], { purpose: "healthcheck" });
      return `${provider.model} -> ${vec.length} dims`;
    }),
  );

  results.push(
    await check(`llm (${config.LLM_PROVIDER})`, async () => {
      const { getLlmProvider } = await import("./providers/llm/index.js");
      const provider = getLlmProvider();
      const out = await provider.complete({
        system: "Reply with exactly: ok",
        prompt: "healthcheck",
        maxTokens: 8,
      });
      return `${provider.model} replied (${out.trim().slice(0, 20)})`;
    }),
  );

  results.push(
    await check(`storage (${config.STORAGE_DRIVER})`, async () => {
      const { getStorage } = await import("./providers/storage/index.js");
      const storage = getStorage();
      const key = `healthcheck/${Date.now()}.txt`;
      await storage.put(key, Buffer.from("ok"), "text/plain");
      const buf = await storage.get(key);
      await storage.delete(key);
      if (buf.toString() !== "ok") throw new Error("read-back mismatch");
      return "write/read/delete ok";
    }),
  );

  results.push(
    await check("mail", async () => {
      if (config.RESEND_API_KEY) {
        // key validation without sending: Resend rejects bad keys with 401
        const res = await fetch("https://api.resend.com/domains", {
          headers: { authorization: `Bearer ${config.RESEND_API_KEY}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`resend api key rejected (${res.status})`);
        return "resend api reachable, key valid";
      }
      const { getMailer } = await import("./lib/mail.js");
      await getMailer().verify();
      return `${config.SMTP_HOST}:${config.SMTP_PORT} reachable`;
    }),
  );

  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.name.padEnd(24)} ${r.detail}`);
  }
  await pool.end().catch(() => {});
  return allOk;
}
