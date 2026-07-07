import { and, eq, isNull, or } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { notifyUser } from "../lib/notify.js";
import { bus } from "../realtime/bus.js";

/**
 * Review-inbox badge push + notification. By default every supporter/admin is
 * notified (stale flags, merges — org-wide concerns); pass `onlyUserIds` to
 * target specific people (e.g. a draft goes to the supporter whose fix it is).
 */
export async function notifySupportersOfReviewItem(
  orgId: string,
  title: string,
  reviewItemId: string,
  opts?: { onlyUserIds?: string[] },
): Promise<void> {
  // the inbox badge updates for everyone either way
  bus.publish(orgId, { type: "review_changed", supporterOnly: true, data: { reviewItemId } });

  let recipients: string[];
  if (opts?.onlyUserIds) {
    recipients = [...new Set(opts.onlyUserIds)];
  } else {
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
    recipients = supporters.map((s) => s.id);
  }

  for (const userId of recipients) {
    await notifyUser({
      orgId,
      userId,
      type: "review_item",
      title,
      linkPath: `/reviews`,
    });
  }
}
