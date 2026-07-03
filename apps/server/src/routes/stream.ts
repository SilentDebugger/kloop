import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppEnv } from "../http/context.js";
import { sessionUser } from "../http/middleware.js";
import { bus, type BusEvent } from "../realtime/bus.js";

/**
 * Realtime SSE: one stream per client carries queue updates, thread messages,
 * review badge changes, and personal notifications.
 *
 * GET /api/stream            (cookie auth — web)
 * GET /api/stream?token=...  (bearer via query — EventSource can't set headers)
 */
export const streamRoutes = new Hono<AppEnv>();

streamRoutes.get("/", async (c) => {
  // allow ?token= for EventSource clients
  const tokenParam = c.req.query("token");
  if (tokenParam && !c.req.header("authorization")) {
    c.req.raw.headers.set("authorization", `Bearer ${tokenParam}`);
  }
  const user = await sessionUser(c);
  const org = c.get("org");
  if (!user || user.orgId !== org.id) return c.json({ error: "unauthorized" }, 401);

  const isSupporter = user.role !== "requester";

  return streamSSE(c, async (stream) => {
    let open = true;
    const unsubscribe = bus.subscribe(org.id, (event: BusEvent) => {
      if (!open) return;
      if (event.userId && event.userId !== user.id) return;
      if (event.supporterOnly && !isSupporter) return;
      stream
        .writeSSE({ event: event.type, data: JSON.stringify(event.data) })
        .catch(() => {
          open = false;
        });
    });

    stream.onAbort(() => {
      open = false;
      unsubscribe();
    });

    await stream.writeSSE({ event: "connected", data: JSON.stringify({ userId: user.id }) });

    // heartbeat keeps proxies from closing the stream
    while (open) {
      await stream.sleep(25_000);
      if (!open) break;
      await stream.writeSSE({ event: "ping", data: String(Date.now()) }).catch(() => {
        open = false;
      });
    }
    unsubscribe();
  });
});
