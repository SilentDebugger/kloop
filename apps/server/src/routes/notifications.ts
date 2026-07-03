import { Hono } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { requireAuth } from "../http/middleware.js";
import type { AppEnv } from "../http/context.js";

export const notificationRoutes = new Hono<AppEnv>();
notificationRoutes.use("*", requireAuth());

notificationRoutes.get("/", async (c) => {
  const user = c.get("user");
  const rows = await db
    .select()
    .from(tables.notifications)
    .where(eq(tables.notifications.userId, user.id))
    .orderBy(desc(tables.notifications.createdAt))
    .limit(100);
  const unread = rows.filter((n) => !n.readAt).length;
  return c.json({
    unread,
    notifications: rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      linkPath: n.linkPath,
      readAt: n.readAt,
      createdAt: n.createdAt,
    })),
  });
});

notificationRoutes.post("/:id/read", async (c) => {
  const user = c.get("user");
  await db
    .update(tables.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(tables.notifications.id, c.req.param("id") ?? ""), eq(tables.notifications.userId, user.id)));
  return c.json({ ok: true });
});

notificationRoutes.post("/read-all", async (c) => {
  const user = c.get("user");
  await db
    .update(tables.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(tables.notifications.userId, user.id), isNull(tables.notifications.readAt)));
  return c.json({ ok: true });
});
