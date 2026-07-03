import { db, tables } from "../db/index.js";
import { logger } from "./logger.js";

/**
 * Append-only audit log + learning-signal store. Also the source for
 * outbound webhooks (delivered async by the webhook worker).
 */
export async function recordEvent(
  orgId: string,
  actorKind: "user" | "system" | "ai",
  actorId: string | null,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(tables.events).values({ orgId, actorKind, actorId, type, payload });
    const { enqueueWebhookDelivery } = await import("../workers/webhooks.js");
    await enqueueWebhookDelivery(orgId, type, payload);
  } catch (err) {
    logger.error("recordEvent failed", { type, err: String(err) });
  }
}
