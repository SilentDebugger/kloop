import { eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { sendMail } from "./mail.js";
import { bus } from "../realtime/bus.js";
import { config } from "../config.js";
import { logger } from "./logger.js";

const PREF_BY_TYPE: Record<string, string> = {
  reply: "replies",
  status_change: "statusChanges",
  review_item: "reviewItems",
  gap_alert: "reviewItems",
};

/**
 * One entry point for user notifications: in-app row + SSE push + (per user
 * preference) email + Expo push. Never throws.
 */
export async function notifyUser(input: {
  orgId: string;
  userId: string;
  type: "reply" | "status_change" | "review_item" | "gap_alert" | "system";
  title: string;
  body?: string;
  linkPath?: string;
}): Promise<void> {
  try {
    const [row] = await db
      .insert(tables.notifications)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? "",
        linkPath: input.linkPath,
      })
      .returning();

    bus.publish(input.orgId, {
      type: "notification",
      userId: input.userId,
      data: { id: row.id, type: input.type, title: input.title, body: input.body ?? "", linkPath: input.linkPath ?? null },
    });

    const user = await db.query.users.findFirst({ where: eq(tables.users.id, input.userId) });
    if (!user) return;
    const prefs = (user.notificationPrefs ?? {}) as Record<string, boolean>;
    const prefKey = PREF_BY_TYPE[input.type];
    const wants = prefKey ? prefs[prefKey] !== false : true;
    if (!wants) return;

    await sendMail({
      to: user.email,
      subject: input.title,
      text: `${input.body ?? input.title}\n\n${input.linkPath ? `Open: ${config.PUBLIC_URL}${input.linkPath}` : ""}`,
    });

    const pushTokens = await db.select().from(tables.pushTokens).where(eq(tables.pushTokens.userId, input.userId));
    if (pushTokens.length > 0) await sendExpoPush(pushTokens.map((t) => t.token), input);
  } catch (err) {
    logger.error("notifyUser failed", { err: String(err) });
  }
}

async function sendExpoPush(
  tokens: string[],
  input: { title: string; body?: string; linkPath?: string },
): Promise<void> {
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        tokens.map((to) => ({
          to,
          title: input.title,
          body: input.body ?? "",
          data: { linkPath: input.linkPath ?? null },
        })),
      ),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.warn("expo push failed", { err: String(err) });
  }
}
