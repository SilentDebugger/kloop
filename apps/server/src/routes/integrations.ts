import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { requireAuth, requireRole } from "../http/middleware.js";
import type { AppEnv } from "../http/context.js";
import { generateToken, hashToken } from "../lib/crypto.js";
import { recordEvent } from "../lib/events.js";
import { config } from "../config.js";

/** Admin: API keys + outbound webhooks (Channels & Integrations screen). */
export const integrationRoutes = new Hono<AppEnv>();
integrationRoutes.use("*", requireAuth(), requireRole("admin"));

// ---------------------------------------------------------------------------
// API keys — full REST access, `Authorization: Bearer kloop_ak_...`
// ---------------------------------------------------------------------------

integrationRoutes.get("/api-keys", async (c) => {
  const org = c.get("org");
  const keys = await db
    .select({
      id: tables.apiKeys.id,
      name: tables.apiKeys.name,
      tokenPrefix: tables.apiKeys.tokenPrefix,
      lastUsedAt: tables.apiKeys.lastUsedAt,
      createdAt: tables.apiKeys.createdAt,
    })
    .from(tables.apiKeys)
    .where(and(eq(tables.apiKeys.orgId, org.id), isNull(tables.apiKeys.revokedAt)))
    .orderBy(desc(tables.apiKeys.createdAt));
  return c.json({ apiKeys: keys });
});

integrationRoutes.post("/api-keys", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const body = z.object({ name: z.string().min(1).max(100) }).parse(await c.req.json());

  const token = generateToken("kloop_ak_");
  const [key] = await db
    .insert(tables.apiKeys)
    .values({
      orgId: org.id,
      name: body.name,
      tokenHash: hashToken(token),
      tokenPrefix: token.slice(0, 14),
      createdBy: user.id,
    })
    .returning();

  await recordEvent(org.id, "user", user.id, "api_key_created", { apiKeyId: key.id, name: body.name });
  // token is shown exactly once
  return c.json({ apiKey: { id: key.id, name: key.name, token } }, 201);
});

integrationRoutes.delete("/api-keys/:id", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  await db
    .update(tables.apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(tables.apiKeys.id, c.req.param("id") ?? ""), eq(tables.apiKeys.orgId, org.id)));
  await recordEvent(org.id, "user", user.id, "api_key_revoked", { apiKeyId: c.req.param("id") });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Outbound webhooks — HMAC-signed event delivery
// ---------------------------------------------------------------------------

integrationRoutes.get("/webhooks", async (c) => {
  const org = c.get("org");
  const hooks = await db
    .select({
      id: tables.webhooks.id,
      url: tables.webhooks.url,
      events: tables.webhooks.events,
      active: tables.webhooks.active,
      lastStatus: tables.webhooks.lastStatus,
      lastDeliveryAt: tables.webhooks.lastDeliveryAt,
      createdAt: tables.webhooks.createdAt,
    })
    .from(tables.webhooks)
    .where(eq(tables.webhooks.orgId, org.id))
    .orderBy(desc(tables.webhooks.createdAt));
  return c.json({ webhooks: hooks });
});

integrationRoutes.post("/webhooks", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const body = z
    .object({
      url: z.string().url(),
      events: z.array(z.string()).default([]),
    })
    .parse(await c.req.json());

  const secret = generateToken("whsec_");
  const [hook] = await db
    .insert(tables.webhooks)
    .values({ orgId: org.id, url: body.url, secret, events: body.events })
    .returning();

  await recordEvent(org.id, "user", user.id, "webhook_created", { webhookId: hook.id, url: body.url });
  // secret shown once; used to verify x-kloop-signature
  return c.json({ webhook: { id: hook.id, url: hook.url, events: hook.events, secret } }, 201);
});

integrationRoutes.patch("/webhooks/:id", async (c) => {
  const org = c.get("org");
  const body = z
    .object({ active: z.boolean().optional(), events: z.array(z.string()).optional(), url: z.string().url().optional() })
    .parse(await c.req.json());
  const [updated] = await db
    .update(tables.webhooks)
    .set(body)
    .where(and(eq(tables.webhooks.id, c.req.param("id") ?? ""), eq(tables.webhooks.orgId, org.id)))
    .returning();
  if (!updated) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

integrationRoutes.delete("/webhooks/:id", async (c) => {
  const org = c.get("org");
  await db
    .delete(tables.webhooks)
    .where(and(eq(tables.webhooks.id, c.req.param("id") ?? ""), eq(tables.webhooks.orgId, org.id)));
  return c.json({ ok: true });
});

/** Channel info for the admin screen (email-in address / status). */
integrationRoutes.get("/channels", async (c) => {
  const org = c.get("org");
  return c.json({
    emailIn: {
      configured: Boolean(config.EMAIL_IN_SECRET),
      endpoint: `${config.PUBLIC_URL}/api/intake/email?secret=***`,
      enabled: Boolean((org.settings as Record<string, unknown>).emailInEnabled),
    },
    api: { baseUrl: `${config.PUBLIC_URL}/api`, discoveryUrl: `${config.PUBLIC_URL}/.well-known/kloop.json` },
  });
});
