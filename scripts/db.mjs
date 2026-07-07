#!/usr/bin/env node
/**
 * DB snapshot / restore for local dev and prod (Supabase), runs on the host.
 *
 *   pnpm db:backup  <prod|local|URL> [--out FILE]
 *   pnpm db:restore <prod|local|URL> <file> [--yes]
 *
 * "prod"  = DATABASE_URL from .env.sevalla
 * "local" = DATABASE_URL from .env, falling back to the compose.dev.yml default
 *
 * Scope: the app data (`public`) plus the drizzle migration journal, so a
 * restored snapshot always agrees with its journal. On Supabase everything
 * else (auth, storage, extensions, …) is platform-managed and must not be
 * touched. The pgboss job-queue schema is deliberately NOT dumped — restoring
 * prod's queue into a dev DB would make the dev server execute leftover prod
 * jobs (queued emails!). Restore drops pgboss; the server recreates it empty
 * on next boot. Uploads aren't included either (prod's live on the Sevalla disk).
 *
 * Restore runs as ONE transaction with ON_ERROR_STOP: it either fully
 * replaces the app data or rolls back leaving the target untouched.
 *
 * Requires postgres client tools on the host: brew install libpq
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const LOCAL_DEFAULT = "postgres://kloop:kloop@localhost:5433/kloop";

/**
 * Executed inside the restore transaction, before the dump's SQL. Wipes the
 * app schemas and re-creates pgvector so the dump's `public.vector` columns
 * resolve. pgboss is dropped for the reason in the header.
 */
const WIPE_SQL = `
DROP SCHEMA IF EXISTS pgboss CASCADE;
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
DROP EXTENSION IF EXISTS vector;
CREATE SCHEMA public;
CREATE EXTENSION vector WITH SCHEMA public;
`;

/**
 * Preamble statements to skip when replaying the dump:
 *  - CREATE SCHEMA public: WIPE_SQL already recreated it
 *  - SET transaction_timeout: emitted by pg_dump >= 17, unknown to the pg16
 *    dev container and fatal under ON_ERROR_STOP
 */
const SKIP_LINES = new Set(["CREATE SCHEMA public;", "SET transaction_timeout = 0;"]);

/** Minimal .env parser — KEY=VALUE lines, optional surrounding quotes. */
function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function resolveUrl(target) {
  if (target === "prod") {
    const url = readEnvFile(join(root, ".env.sevalla")).DATABASE_URL;
    if (!url) throw new Error("no DATABASE_URL in .env.sevalla");
    return url;
  }
  if (target === "local") {
    return readEnvFile(join(root, ".env")).DATABASE_URL ?? LOCAL_DEFAULT;
  }
  if (target?.includes("://")) return target;
  throw new Error(`unknown target '${target}' — use prod, local, or a postgres:// URL`);
}

/** libpq doesn't know node-postgres' sslmode=no-verify — closest match is require. */
function forLibpq(url) {
  return url.replace(/sslmode=no-verify/, "sslmode=require");
}

function describe(url) {
  const u = new URL(url);
  return `${u.hostname}:${u.port || 5432}${u.pathname}`;
}

function toolMissing(err, bin) {
  return err.code === "ENOENT"
    ? new Error(`'${bin}' not found — install postgres client tools (brew install libpq && brew link --force libpq)`)
    : err;
}

function run(bin, args) {
  return new Promise((res, rej) => {
    const child = spawn(bin, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", (err) => rej(toolMissing(err, bin)));
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${bin} exited with code ${code}`))));
  });
}

/** Which dumpable schemas exist on the source (drizzle is absent on fresh DBs). */
function dumpSchemas(url) {
  return new Promise((res, rej) => {
    const child = spawn(
      "psql",
      [url, "-Atc", "select nspname from pg_namespace where nspname in ('public','drizzle') order by nspname"],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", (err) => rej(toolMissing(err, "psql")));
    child.on("exit", (code) =>
      code === 0 ? res(out.split("\n").filter(Boolean)) : rej(new Error(`psql exited with code ${code}`)),
    );
  });
}

async function backup(target, flags) {
  const url = forLibpq(resolveUrl(target));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(root, "backups");
  mkdirSync(dir, { recursive: true });
  const label = target.includes("://") ? "db" : target;
  const out = resolve(flags.out ?? join(dir, `kloop-${label}-${stamp}.dump`));

  const schemas = await dumpSchemas(url);
  console.log(`\n  dumping ${describe(url)} (schemas: ${schemas.join(", ")})…`);
  await run("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    ...schemas.map((s) => `--schema=${s}`),
    `--file=${out}`,
    url,
  ]);
  console.log(`\n  ✓ backup written to ${out}\n`);
}

/**
 * pg_restore -f - (dump → SQL) piped into psql. WIPE_SQL goes in first; the
 * whole stream runs in a single transaction, so a failure rolls everything
 * back. Statement filtering only applies before the first COPY block — after
 * that, lines are table data and must pass through verbatim.
 */
function replayDump(dumpFile, url) {
  return new Promise((resolveP, rejectP) => {
    // --no-owner/--no-privileges must be applied here: for custom-format
    // archives pg_dump stores ownership regardless of its own flags
    const dump = spawn("pg_restore", ["--no-owner", "--no-privileges", "-f", "-", dumpFile], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const psql = spawn(
      "psql",
      ["--quiet", "--single-transaction", "-v", "ON_ERROR_STOP=1", `--dbname=${url}`],
      { stdio: ["pipe", "inherit", "inherit"] },
    );

    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      dump.kill();
      psql.kill();
      rejectP(err);
    };

    dump.on("error", (err) => fail(toolMissing(err, "pg_restore")));
    psql.on("error", (err) => fail(toolMissing(err, "psql")));
    // when psql aborts (ON_ERROR_STOP) our writes hit a closed pipe — the
    // exit-code handler below reports the real error
    psql.stdin.on("error", () => {});

    psql.stdin.write(WIPE_SQL);

    let preamble = true;
    let waitingForDrain = false;
    const rl = createInterface({ input: dump.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (preamble) {
        if (line.startsWith("COPY ")) preamble = false;
        else if (SKIP_LINES.has(line)) return;
      }
      // rl.pause() still flushes already-buffered lines, so guard against
      // stacking one drain listener per buffered line
      if (!psql.stdin.write(line + "\n") && !waitingForDrain) {
        waitingForDrain = true;
        rl.pause();
        psql.stdin.once("drain", () => {
          waitingForDrain = false;
          rl.resume();
        });
      }
    });
    rl.on("close", () => psql.stdin.end());

    let pending = 2;
    const done = () => {
      if (--pending === 0 && !settled) {
        settled = true;
        resolveP();
      }
    };
    dump.on("exit", (code) => (code === 0 ? done() : fail(new Error(`pg_restore exited with code ${code}`))));
    psql.on("exit", (code) =>
      code === 0 ? done() : fail(new Error(`psql exited with code ${code} — transaction rolled back, target unchanged`)),
    );
  });
}

async function restore(target, file, flags) {
  const url = forLibpq(resolveUrl(target));
  const dump = resolve(file);
  if (!existsSync(dump)) throw new Error(`backup file not found: ${dump}`);

  if (flags.yes !== "true") {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((res) =>
      rl.question(`This REPLACES all app data on ${describe(url)}. Type 'yes' to continue: `, res),
    );
    rl.close();
    if (answer.trim() !== "yes") {
      console.log("  aborted.");
      return;
    }
  }

  console.log(`\n  restoring ${dump}\n  into ${describe(url)}…`);
  await replayDump(dump, url);
  console.log("\n  ✓ restore complete — restart the server (pgboss queue is recreated empty on boot).\n");
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = "true";
    } else positional.push(args[i]);
  }
  return { flags, positional };
}

const [cmd, ...rest] = process.argv.slice(2);
const { flags, positional } = parseFlags(rest);

try {
  if (cmd === "backup" && positional[0]) {
    await backup(positional[0], flags);
  } else if (cmd === "restore" && positional[0] && positional[1]) {
    await restore(positional[0], positional[1], flags);
  } else {
    console.log(
      "usage:\n  pnpm db:backup  <prod|local|URL> [--out FILE]\n  pnpm db:restore <prod|local|URL> <file> [--yes]",
    );
    process.exit(cmd ? 1 : 0);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
