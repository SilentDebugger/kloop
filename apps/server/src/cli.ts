#!/usr/bin/env node
/**
 * kloop CLI — runs inside the container (node dist/cli.js ...) or in dev (pnpm kloop ...).
 *
 *   kloop migrate                  apply database migrations
 *   kloop admin create             interactive-ish admin + org bootstrap (flags or env)
 *   kloop seed                     load the demo dataset (Fjord Logistics IT)
 *   kloop doctor                   health check: db, pgvector, embeddings, storage, smtp
 *   kloop backup [--out FILE]      pg_dump + local uploads into one .tar.gz archive
 *   kloop restore <file>           restore a backup archive (DROPS current data)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

/** Spawn a binary, inherit output, reject on non-zero exit. */
function run(bin: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(bin, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", (err) =>
      rej(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT"
        ? new Error(`'${bin}' not found — install the postgres client tools (in Docker they ship with the image)`)
        : err),
    );
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${bin} exited with code ${code}`))));
  });
}

/**
 * Backup = pg_dump (custom format) + the local uploads dir, tarred into one
 * archive. With the s3 storage driver only the database is included — object
 * storage has its own replication/backup story.
 */
async function backup(outFile?: string): Promise<string> {
  const { config } = await import("./config.js");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const out = resolve(outFile ?? `kloop-backup-${stamp}.tar.gz`);
  const work = await mkdtemp(join(tmpdir(), "kloop-backup-"));
  try {
    console.log("  dumping database…");
    await run("pg_dump", ["--format=custom", "--no-owner", `--file=${join(work, "db.dump")}`, config.DATABASE_URL]);

    const contents = ["db.dump"];
    if (config.STORAGE_DRIVER === "local") {
      const storagePath = resolve(config.STORAGE_LOCAL_PATH);
      if (existsSync(storagePath)) {
        console.log("  copying uploads…");
        await cp(storagePath, join(work, "storage"), { recursive: true });
        contents.push("storage");
      }
    } else {
      console.log("  storage driver is s3 — skipping uploads (back up the bucket separately)");
    }

    console.log("  writing archive…");
    await run("tar", ["-czf", out, "-C", work, ...contents]);
    return out;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Restore a backup archive: pg_restore --clean plus the uploads dir. */
async function restore(file: string): Promise<void> {
  const { config } = await import("./config.js");
  const archive = resolve(file);
  if (!existsSync(archive)) throw new Error(`backup file not found: ${archive}`);

  const work = await mkdtemp(join(tmpdir(), "kloop-restore-"));
  try {
    await run("tar", ["-xzf", archive, "-C", work]);
    const dump = join(work, "db.dump");
    if (!existsSync(dump)) throw new Error("archive has no db.dump — not a kloop backup?");

    console.log("  restoring database (drops existing objects)…");
    await run("pg_restore", ["--clean", "--if-exists", "--no-owner", `--dbname=${config.DATABASE_URL}`, dump]);

    const storageSrc = join(work, "storage");
    if (existsSync(storageSrc) && config.STORAGE_DRIVER === "local") {
      console.log("  restoring uploads…");
      await cp(storageSrc, resolve(config.STORAGE_LOCAL_PATH), { recursive: true, force: true });
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
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

    case "backup": {
      console.log("\nkloop backup\n");
      const out = await backup(flags.out);
      console.log(`\n  ✓ backup written to ${out}\n`);
      break;
    }

    case "restore": {
      if (!sub || sub.startsWith("--")) {
        console.error("usage: kloop restore <backup-file.tar.gz>");
        process.exit(1);
      }
      console.log(`\nkloop restore ${sub}\n`);
      const confirm = flags.yes === "true" ? "yes" : await ask("This REPLACES the current database and uploads. Type 'yes' to continue");
      if (confirm !== "yes") {
        console.log("  aborted.");
        break;
      }
      await restore(sub);
      console.log("\n  ✓ restore complete — restart the server so caches reset.\n");
      break;
    }

    default:
      console.log(
        "kloop CLI\n\n  kloop migrate\n  kloop admin create\n  kloop seed\n  kloop doctor\n  kloop backup [--out FILE]\n  kloop restore <file> [--yes]\n",
      );
      process.exit(cmd ? 1 : 0);
  }

  await pool.end().catch(() => {});
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
