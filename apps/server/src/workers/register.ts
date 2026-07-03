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

  await boss.work<{ requestId: string }>(QUEUES.autoAnswer, { pollingIntervalSeconds: 2 }, async (jobs) => {
    const { tryAutoAnswer } = await import("../engine/automation.js");
    for (const job of jobs) await tryAutoAnswer(job.data.requestId);
  });

  // ---- scheduled scans (cron lives in Postgres via pg-boss) ----

  await boss.work(QUEUES.clusterScan, { pollingIntervalSeconds: 5 }, async () => {
    const { clusterScan } = await import("../engine/clustering.js");
    await forEachOrg((orgId) => clusterScan(orgId).then(() => {}));
  });

  await boss.work(QUEUES.mergeScan, { pollingIntervalSeconds: 10 }, async () => {
    const { scanForMergeCandidates } = await import("../engine/merge.js");
    await forEachOrg((orgId) => scanForMergeCandidates(orgId).then(() => {}));
  });

  await boss.work(QUEUES.freshnessScan, { pollingIntervalSeconds: 10 }, async () => {
    const { freshnessScan } = await import("../engine/freshness.js");
    await forEachOrg((orgId) => freshnessScan(orgId).then(() => {}));
  });

  await boss.schedule(QUEUES.clusterScan, "*/5 * * * *"); // every 5 minutes
  await boss.schedule(QUEUES.mergeScan, "20 * * * *"); // hourly
  await boss.schedule(QUEUES.freshnessScan, "40 3 * * *"); // nightly
}

async function forEachOrg(fn: (orgId: string) => Promise<void>): Promise<void> {
  const { db, tables } = await import("../db/index.js");
  const { logger } = await import("../lib/logger.js");
  const orgs = await db.select({ id: tables.orgs.id }).from(tables.orgs);
  for (const org of orgs) {
    await fn(org.id).catch((err) => logger.error("scheduled scan failed", { orgId: org.id, err: String(err) }));
  }
}
