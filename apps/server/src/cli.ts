#!/usr/bin/env node
/**
 * kloop CLI — runs inside the container (node dist/cli.js ...) or in dev (pnpm kloop ...).
 *
 *   kloop migrate                  apply database migrations
 *   kloop admin create             interactive-ish admin + org bootstrap (flags or env)
 *   kloop seed                     load the demo dataset (Fjord Logistics IT)
 *   kloop doctor                   health check: db, pgvector, embeddings, storage, smtp
 */
import { createInterface } from "node:readline/promises";
import { pool } from "./db/index.js";

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

async function ask(question: string, fallback?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `)).trim();
  rl.close();
  return answer || fallback || "";
}

async function main() {
  const [cmd, sub, ...rest] = process.argv.slice(2);
  const flags = parseFlags([sub ?? "", ...rest]);

  switch (cmd) {
    case "migrate": {
      const { runMigrations } = await import("./db/migrate.js");
      await runMigrations();
      break;
    }

    case "admin": {
      if (sub !== "create") {
        console.error("usage: kloop admin create [--org NAME] [--email EMAIL] [--password PASS] [--name NAME]");
        process.exit(1);
      }
      const { createAdmin } = await import("./bootstrap.js");
      const orgName = flags.org || (await ask("Organization name", "My Organization"));
      const email = flags.email || (await ask("Admin email"));
      const name = flags.name || (await ask("Admin name", email.split("@")[0] ?? "Admin"));
      const password = flags.password || (await ask("Admin password (min 8 chars)"));
      const result = await createAdmin({ orgName, email, name, password });
      console.log(`\n  ✓ org "${result.org.name}" (${result.org.slug})`);
      console.log(`  ✓ admin ${result.user.email}`);
      console.log(`\n  Sign in at ${result.loginUrl}\n`);
      break;
    }

    case "seed": {
      const { seedDemo } = await import("./seed/demo.js");
      const summary = await seedDemo();
      console.log(`\n  ✓ demo org "${summary.orgName}" seeded`);
      for (const [k, v] of Object.entries(summary.counts)) console.log(`    ${k}: ${v}`);
      console.log(`\n  Sign in: ${summary.logins.map((l) => `${l.email} / ${l.password}`).join("  ·  ")}\n`);
      break;
    }

    case "doctor": {
      console.log("\nkloop doctor\n");
      const { runDoctor } = await import("./doctor.js");
      const ok = await runDoctor();
      console.log(ok ? "\n  All checks passed.\n" : "\n  Some checks FAILED — see above.\n");
      process.exit(ok ? 0 : 1);
      break;
    }

    default:
      console.log("kloop CLI\n\n  kloop migrate\n  kloop admin create\n  kloop seed\n  kloop doctor\n");
      process.exit(cmd ? 1 : 0);
  }

  await pool.end().catch(() => {});
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
