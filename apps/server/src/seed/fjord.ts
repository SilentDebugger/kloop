import { createOrg } from "../bootstrap.js";
import { db, tables } from "../db/index.js";
import { hashPassword } from "../lib/crypto.js";
import type { SeedSummary } from "./demo.js";

/**
 * Demo dataset: "Fjord Logistics IT" — the org from the design mockups.
 * Expanded by the ship phase with requests, resolutions, and articles.
 */
export async function seedFjord(): Promise<SeedSummary> {
  const org = await createOrg("Fjord Logistics IT");

  const password = "kloop-demo";
  const mk = async (email: string, name: string, role: string) =>
    (
      await db
        .insert(tables.users)
        .values({ orgId: org.id, email, name, role, passwordHash: await hashPassword(password) })
        .returning()
    )[0];

  await mk("maya@fjord.io", "Maya Chen", "supporter");
  await mk("tomas@fjord.io", "Tomas Lind", "supporter");
  await mk("admin@fjord.io", "Alex Berg", "admin");
  await mk("jonas.weber@fjord.io", "Jonas Weber", "requester");
  await mk("priya@fjord.io", "Priya Nair", "requester");

  return {
    orgName: org.name,
    counts: { users: 5 },
    logins: [
      { email: "maya@fjord.io", password },
      { email: "jonas.weber@fjord.io", password },
      { email: "admin@fjord.io", password },
    ],
  };
}
