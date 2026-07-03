import type { PgBoss } from "pg-boss";
import { QUEUES, type EmbedJob } from "./queues.js";
import { handleEmbedJob } from "./embed.js";

/**
 * Central worker registration: embedding pipeline, clustering, article
 * generation, merge scan, freshness, auto-answer. Scheduled (cron) jobs are
 * also declared here.
 */
export async function registerWorkers(boss: PgBoss): Promise<void> {
  await boss.work<EmbedJob>(QUEUES.embed, { batchSize: 10, pollingIntervalSeconds: 1 }, async (jobs) => {
    for (const job of jobs) await handleEmbedJob(job.data);
  });
}
