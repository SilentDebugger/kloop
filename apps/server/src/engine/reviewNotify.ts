import { and, eq, isNull, or } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { notifyUser } from "../lib/notify.js";
import { bus } from "../realtime/bus.js";

/** Review-inbox badge push + optional notification for supporters/admins. */
export async function notifySupportersOfReviewItem(orgId: string, title: string, reviewItemId: string): Promise<void> {
  bus.publish(orgId, { type: "review_changed", supporterOnly: true, data: { reviewItemId } });

  const supporters = await db
    .select({ id: tables.users.id })
    .from(tables.users)
    .where(
      and(
        eq(tables.users.orgId, orgId),
        isNull(tables.users.deactivatedAt),
        or(eq(tables.users.role, "supporter"), eq(tables.users.role, "admin")),
      ),
    );
  for (const s of supporters) {
    await notifyUser({
      orgId,
      userId: s.id,
      type: "review_item",
      title,
      linkPath: `/reviews`,
    });
  }
}
