import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { createApp } from "./http/app.js";
import { runMigrations } from "./db/migrate.js";

async function main() {
  // Migrations run automatically on boot (backward-compatible one version back).
  await runMigrations();

  if (config.SEED_DEMO) {
    const { seedDemoIfEmpty } = await import("./seed/demo.js");
    await seedDemoIfEmpty();
  }

  const app = createApp();
  const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    logger.info(`kloop api listening`, { port: info.port, publicUrl: config.PUBLIC_URL });
  });

  // Background workers (embedding, clustering, article gen, merge scan, ...)
  const { startWorkers, stopWorkers } = await import("./workers/index.js");
  await startWorkers();

  const shutdown = async (signal: string) => {
    logger.info(`shutting down (${signal})`);
    server.close();
    await stopWorkers().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error("fatal boot error", { err: String(err), stack: err instanceof Error ? err.stack : undefined });
  process.exit(1);
});
