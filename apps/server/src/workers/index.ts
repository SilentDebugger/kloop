import { logger } from "../lib/logger.js";

/**
 * Background workers run in-process on pg-boss (queue lives in Postgres — no
 * Redis). Registered by the ai/knowledge slices; this module owns lifecycle.
 */
let started = false;

export async function startWorkers(): Promise<void> {
  if (started) return;
  started = true;
  const { bossStart } = await import("./boss.js");
  await bossStart();
  logger.info("background workers started");
}

export async function stopWorkers(): Promise<void> {
  if (!started) return;
  started = false;
  const { bossStop } = await import("./boss.js");
  await bossStop();
}
