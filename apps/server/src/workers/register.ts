import type { PgBoss } from "pg-boss";

/**
 * Central worker registration. Slices append here as they land:
 * embedding pipeline, clustering, article generation, merge scan, freshness,
 * auto-answer. Scheduled (cron) jobs are also declared here.
 */
export async function registerWorkers(boss: PgBoss): Promise<void> {
  void boss;
}
