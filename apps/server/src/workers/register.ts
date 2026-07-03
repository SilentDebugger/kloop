import type { PgBoss } from "pg-boss";
import { QUEUES, type EmbedJob } from "./queues.js";
import { handleEmbedJob } from "./embed.js";
import { handleStructureJob, type StructureJob } from "./structure.js";

/**
 * Central worker registration: embedding pipeline, clustering, article
 * generation, merge scan, freshness, auto-answer. Scheduled (cron) jobs are
 * also declared here.
 */
export async function registerWorkers(boss: PgBoss): Promise<void> {
  await boss.work<EmbedJob>(QUEUES.embed, { batchSize: 10, pollingIntervalSeconds: 1 }, async (jobs) => {
    for (const job of jobs) await handleEmbedJob(job.data);
  });

  await boss.work<StructureJob>(QUEUES.structure, { pollingIntervalSeconds: 1 }, async (jobs) => {
    for (const job of jobs) await handleStructureJob(job.data);
  });

  await boss.work<{ resolutionId: string }>(QUEUES.articleGen, { pollingIntervalSeconds: 2 }, async (jobs) => {
    const { considerArticleGeneration } = await import("../engine/articleGen.js");
    for (const job of jobs) await considerArticleGeneration(job.data.resolutionId);
  });
}
