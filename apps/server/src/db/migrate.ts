import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./index.js";
import { logger } from "../lib/logger.js";

/** Works from src (tsx), dist (bundled), and the docker image (dist + ./drizzle). */
function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../drizzle"), // src/db -> apps/server/drizzle
    join(here, "../drizzle"), // dist -> apps/server/drizzle
    join(process.cwd(), "drizzle"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error("drizzle migrations folder not found");
}

export async function runMigrations(): Promise<void> {
  const folder = migrationsFolder();
  logger.info("running migrations", { folder });
  await migrate(db, { migrationsFolder: folder });
  logger.info("migrations up to date");
}
