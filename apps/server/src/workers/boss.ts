import { PgBoss } from "pg-boss";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";

/**
 * One pg-boss instance for the whole server. Queues:
 *   embed            — embedding pipeline (batch, <5s target)
 *   structure        — resolution capture -> structured summary
 *   article-gen      — cluster -> article draft
 *   cluster-scan     — incremental clustering + gap detection
 *   merge-scan       — article similarity graph -> merge candidates
 *   freshness-scan   — staleness & contradiction detection
 *   auto-answer      — tier 2/3 automation
 */
let boss: PgBoss | null = null;

export function getBoss(): PgBoss {
  if (!boss) {
    boss = new PgBoss({ connectionString: config.DATABASE_URL, schema: "pgboss" });
    boss.on("error", (err: unknown) => logger.error("pg-boss error", { err: String(err) }));
  }
  return boss;
}

export async function bossStart(): Promise<void> {
  const b = getBoss();
  await b.start();
  const { QUEUES } = await import("./queues.js");
  for (const queue of Object.values(QUEUES)) {
    await b.createQueue(queue).catch(() => {}); // idempotent
  }
  const { registerWorkers } = await import("./register.js");
  await registerWorkers(b);
}

export async function bossStop(): Promise<void> {
  if (boss) await boss.stop({ graceful: true, timeout: 5000 });
}
