import { db, tables } from "../db/index.js";
import { logger } from "../lib/logger.js";

export type SeedSummary = {
  orgName: string;
  counts: Record<string, number>;
  logins: { email: string; password: string }[];
};

/** Fleshed out in the ship phase — full "Fjord Logistics IT" dataset matching the mockups. */
export async function seedDemo(): Promise<SeedSummary> {
  const { seedFjord } = await import("./fjord.js");
  return seedFjord();
}

export async function seedDemoIfEmpty(): Promise<void> {
  const orgs = await db.select().from(tables.orgs).limit(1);
  if (orgs.length > 0) return;
  logger.info("empty database + SEED_DEMO=true — seeding demo data");
  await seedDemo();
}
