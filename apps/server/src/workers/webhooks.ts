import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { logger } from "../lib/logger.js";

/**
 * Outbound webhooks: every recorded event is delivered to matching endpoints.
 * Payloads are signed with the webhook secret: `x-kloop-signature: sha256=<hmac>`.
 * Delivery is fire-and-forget with one retry; failures update lastStatus.
 */
export async function enqueueWebhookDelivery(
  orgId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const hooks = await db
    .select()
    .from(tables.webhooks)
    .where(and(eq(tables.webhooks.orgId, orgId), eq(tables.webhooks.active, true)));

  const matching = hooks.filter((h) => h.events.length === 0 || h.events.includes(type));
  if (matching.length === 0) return;

  const body = JSON.stringify({ type, createdAt: new Date().toISOString(), data: payload });
  for (const hook of matching) {
    deliver(hook, body).catch((err) => logger.warn("webhook delivery failed", { url: hook.url, err: String(err) }));
  }
}

async function deliver(hook: typeof tables.webhooks.$inferSelect, body: string, attempt = 1): Promise<void> {
  const signature = createHmac("sha256", hook.secret).update(body).digest("hex");
  let status = 0;
  try {
    const res = await fetch(hook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kloop-signature": `sha256=${signature}`,
        "user-agent": "kloop-webhook/1",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
  } catch {
    status = 0;
  }
  await db
    .update(tables.webhooks)
    .set({ lastStatus: status, lastDeliveryAt: new Date() })
    .where(eq(tables.webhooks.id, hook.id));
  if ((status === 0 || status >= 500) && attempt < 2) {
    await new Promise((r) => setTimeout(r, 5000));
    return deliver(hook, body, attempt + 1);
  }
}
