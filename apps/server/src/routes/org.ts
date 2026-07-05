import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { requireAuth, requireRole } from "../http/middleware.js";
import { orgSettings, type AppEnv } from "../http/context.js";
import { generateToken, hashToken, hashPassword } from "../lib/crypto.js";
import { sendMail } from "../lib/mail.js";
import { config } from "../config.js";
import { recordEvent } from "../lib/events.js";

export const orgRoutes = new Hono<AppEnv>();

orgRoutes.use("*", requireAuth());

orgRoutes.get("/", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const s = orgSettings(org);
  const base = { id: org.id, name: org.name, slug: org.slug, domain: org.domain, logoUrl: org.logoUrl, theme: org.theme };
  if (user.role !== "admin") return c.json({ org: base });
  return c.json({ org: { ...base, settings: s } });
});

orgRoutes.patch("/", requireRole("admin"), async (c) => {
  const org = c.get("org");
  const body = z
    .object({
      name: z.string().min(1).optional(),
      domain: z.string().nullable().optional(),
      logoUrl: z.string().nullable().optional(),
      theme: z.record(z.string(), z.string()).optional(),
      settings: z
        .object({
          automationTier: z.number().int().min(0).max(3).optional(),
          tagTierOverrides: z.record(z.string(), z.number().int().min(0).max(3)).optional(),
          authMethods: z
            .object({ magicLink: z.boolean(), password: z.boolean(), oidc: z.boolean() })
            .optional(),
          oidc: z
            .object({
              issuer: z.string(),
              clientId: z.string(),
              clientSecret: z.string(),
              buttonLabel: z.string().optional(),
            })
            .nullable()
            .optional(),
          emailInEnabled: z.boolean().optional(),
          reopenGraceDays: z.number().int().min(0).max(90).optional(),
          autoAnswerConfidence: z.number().min(0.5).max(1).optional(),
        })
        .optional(),
    })
    .parse(await c.req.json());

  const patch: Partial<typeof tables.orgs.$inferInsert> = {};
  if (body.name) patch.name = body.name;
  if (body.domain !== undefined) patch.domain = body.domain;
  if (body.logoUrl !== undefined) patch.logoUrl = body.logoUrl;
  if (body.theme) patch.theme = { ...(org.theme as Record<string, string>), ...body.theme };
  if (body.settings) {
    const current = orgSettings(org) as unknown as Record<string, unknown>;
    patch.settings = { ...current, ...JSON.parse(JSON.stringify(body.settings)) };
  }

  const [updated] = await db.update(tables.orgs).set(patch).where(eq(tables.orgs.id, org.id)).returning();
  await recordEvent(org.id, "user", c.get("user").id, "org_settings_updated", { fields: Object.keys(body) });
  return c.json({ org: { ...updated, settings: orgSettings(updated) } });
});

/**
 * Lightweight people directory for supporters — powers the "create a request
 * for someone" picker. Active users only, no admin-level detail.
 */
orgRoutes.get("/directory", requireRole("supporter"), async (c) => {
  const org = c.get("org");
  const users = await db
    .select({
      id: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      role: tables.users.role,
    })
    .from(tables.users)
    .where(and(eq(tables.users.orgId, org.id), isNull(tables.users.deactivatedAt)))
    .orderBy(tables.users.name);
  return c.json({ users });
});

// ---------------------------------------------------------------------------
// Users & roles (admin)
// ---------------------------------------------------------------------------

orgRoutes.get("/users", requireRole("admin"), async (c) => {
  const org = c.get("org");
  const users = await db
    .select({
      id: tables.users.id,
      email: tables.users.email,
      name: tables.users.name,
      role: tables.users.role,
      createdAt: tables.users.createdAt,
      lastSeenAt: tables.users.lastSeenAt,
      deactivatedAt: tables.users.deactivatedAt,
    })
    .from(tables.users)
    .where(eq(tables.users.orgId, org.id))
    .orderBy(desc(tables.users.createdAt));
  return c.json({ users });
});

/**
 * Create an account directly (no invite email) — for onboarding someone in
 * person or when mail isn't set up. The admin picks the initial password and
 * hands it over; the user signs in with email + that password.
 */
orgRoutes.post("/users", requireRole("admin"), async (c) => {
  const org = c.get("org");
  const admin = c.get("user");
  const body = z
    .object({
      name: z.string().min(1).max(120),
      email: z.string().email(),
      password: z.string().min(8),
      role: z.enum(["requester", "supporter", "admin"]).default("requester"),
    })
    .parse(await c.req.json());

  const email = body.email.toLowerCase();
  const existing = await db.query.users.findFirst({
    where: and(eq(tables.users.orgId, org.id), eq(tables.users.email, email)),
  });
  if (existing) return c.json({ error: "a user with this email already exists" }, 409);

  const [user] = await db
    .insert(tables.users)
    .values({ orgId: org.id, email, name: body.name, role: body.role, passwordHash: await hashPassword(body.password) })
    .returning();
  // a pending invite for the same address is now moot
  await db
    .delete(tables.invitations)
    .where(and(eq(tables.invitations.orgId, org.id), eq(tables.invitations.email, email), isNull(tables.invitations.acceptedAt)));

  await recordEvent(org.id, "user", admin.id, "user_created", { email, role: body.role });
  return c.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } }, 201);
});

orgRoutes.patch("/users/:id", requireRole("admin"), async (c) => {
  const org = c.get("org");
  const body = z
    .object({
      role: z.enum(["requester", "supporter", "admin"]).optional(),
      deactivated: z.boolean().optional(),
    })
    .parse(await c.req.json());

  const patch: Partial<typeof tables.users.$inferInsert> = {};
  if (body.role) patch.role = body.role;
  if (body.deactivated !== undefined) patch.deactivatedAt = body.deactivated ? new Date() : null;

  const [updated] = await db
    .update(tables.users)
    .set(patch)
    .where(and(eq(tables.users.id, c.req.param("id") ?? ""), eq(tables.users.orgId, org.id)))
    .returning();
  if (!updated) return c.json({ error: "not found" }, 404);
  return c.json({ user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role, deactivatedAt: updated.deactivatedAt } });
});

orgRoutes.get("/invitations", requireRole("admin"), async (c) => {
  const org = c.get("org");
  const invites = await db
    .select({
      id: tables.invitations.id,
      email: tables.invitations.email,
      role: tables.invitations.role,
      createdAt: tables.invitations.createdAt,
      expiresAt: tables.invitations.expiresAt,
      acceptedAt: tables.invitations.acceptedAt,
    })
    .from(tables.invitations)
    .where(and(eq(tables.invitations.orgId, org.id), isNull(tables.invitations.acceptedAt)))
    .orderBy(desc(tables.invitations.createdAt));
  return c.json({ invitations: invites });
});

orgRoutes.post("/invitations", requireRole("admin"), async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const body = z
    .object({ email: z.string().email(), role: z.enum(["requester", "supporter", "admin"]).default("requester") })
    .parse(await c.req.json());

  const email = body.email.toLowerCase();
  const existing = await db.query.users.findFirst({
    where: and(eq(tables.users.orgId, org.id), eq(tables.users.email, email)),
  });
  if (existing) return c.json({ error: "a user with this email already exists" }, 409);

  const token = generateToken();
  const [invite] = await db
    .insert(tables.invitations)
    .values({
      orgId: org.id,
      email,
      role: body.role,
      tokenHash: hashToken(token),
      invitedBy: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    })
    .returning();

  const url = `${config.PUBLIC_URL}/auth/invite?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: email,
    subject: `You've been invited to ${org.name}`,
    text: `${user.name} invited you to ${org.name} on kloop (role: ${body.role}).\n\nAccept: ${url}\n\nThe invitation is valid for 7 days.`,
  });
  await recordEvent(org.id, "user", user.id, "user_invited", { email, role: body.role });
  return c.json({ invitation: { id: invite.id, email, role: body.role } }, 201);
});

orgRoutes.delete("/invitations/:id", requireRole("admin"), async (c) => {
  const org = c.get("org");
  await db
    .delete(tables.invitations)
    .where(and(eq(tables.invitations.id, c.req.param("id") ?? ""), eq(tables.invitations.orgId, org.id)));
  return c.json({ ok: true });
});
