import { sql } from "drizzle-orm";
import { db } from "../db/index.js";

/** Atomic per-org counters for human-friendly refs (REQ-1284, KB-041). */
export async function nextCounter(orgId: string, name: "request" | "article"): Promise<number> {
  const res = await db.execute(sql`
    insert into counters (org_id, name, value)
    values (${orgId}, ${name}, 1)
    on conflict (org_id, name) do update set value = counters.value + 1
    returning value
  `);
  return Number((res.rows[0] as Record<string, unknown>).value);
}
