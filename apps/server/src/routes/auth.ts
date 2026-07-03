import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { generateToken, hashToken, verifyPassword, hashPassword } from "../lib/crypto.js";
import { sendMail } from "../lib/mail.js";
import { config } from "../config.js";
import { orgSettings, type AppEnv } from "../http/context.js";
import { requireAuth, sessionUser } from "../http/middleware.js";
import { recordEvent } from "../lib/events.js";

const SESSION_DAYS = 30;
const MAGIC_LINK_MINUTES = 15;

export const authRoutes = new Hono<AppEnv>();

async function createSession(c: Parameters<typeof setCookie>[0], userId: string): Promise<string> {
  const token = generateToken();
  await db.insert(tables.sessions).values({
    userId,
    tokenHash: hashToken(token),
    userAgent: c.req.header("user-agent")?.slice(0, 255),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000),
  });
  setCookie(c, "kloop_session", token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.PUBLIC_URL.startsWith("https"),
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
  return token;
}

function publicUser(u: typeof tables.users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    language: u.language,
    notificationPrefs: u.notificationPrefs,
  };
}

/** Auth methods + org branding for the login screen (pre-auth). */
authRoutes.get("/methods", async (c) => {
  const org = c.get("org");
  const s = orgSettings(org);
  return c.json({
    org: { name: org.name, slug: org.slug, logoUrl: org.logoUrl, theme: org.theme },
    methods: {
      magicLink: s.authMethods.magicLink,
      password: s.authMethods.password,
      oidc: s.authMethods.oidc ? { buttonLabel: s.oidc?.buttonLabel ?? "Continue with SSO" } : false,
    },
  });
});

authRoutes.post("/login", async (c) => {
  const org = c.get("org");
  const body = z.object({ email: z.string().email(), password: z.string() }).parse(await c.req.json());
  if (!orgSettings(org).authMethods.password) return c.json({ error: "password auth disabled" }, 400);

  const user = await db.query.users.findFirst({
    where: and(eq(tables.users.orgId, org.id), eq(tables.users.email, body.email.toLowerCase()), isNull(tables.users.deactivatedAt)),
  });
  if (!user?.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
    return c.json({ error: "invalid credentials" }, 401);
  }
  const token = await createSession(c, user.id);
  await recordEvent(org.id, "user", user.id, "user_login", { method: "password" });
  return c.json({ token, user: publicUser(user) });
});

authRoutes.post("/magic-link", async (c) => {
  const org = c.get("org");
  const body = z.object({ email: z.string().email() }).parse(await c.req.json());
  if (!orgSettings(org).authMethods.magicLink) return c.json({ error: "magic link auth disabled" }, 400);

  const email = body.email.toLowerCase();
  const user = await db.query.users.findFirst({
    where: and(eq(tables.users.orgId, org.id), eq(tables.users.email, email), isNull(tables.users.deactivatedAt)),
  });

  // Always answer 200 (no account enumeration); only send if the user exists.
  if (user) {
    const token = generateToken();
    await db.insert(tables.magicLinkTokens).values({
      orgId: org.id,
      email,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + MAGIC_LINK_MINUTES * 60 * 1000),
    });
    const url = `${config.PUBLIC_URL}/auth/verify?token=${encodeURIComponent(token)}`;
    await sendMail({
      to: email,
      subject: `Sign in to ${org.name}`,
      text: `Sign in to ${org.name} on kloop:\n\n${url}\n\nThis link is valid for ${MAGIC_LINK_MINUTES} minutes. If you didn't request it, ignore this email.`,
    });
  }
  return c.json({ ok: true });
});

authRoutes.post("/verify", async (c) => {
  const org = c.get("org");
  const body = z.object({ token: z.string() }).parse(await c.req.json());

  const row = await db.query.magicLinkTokens.findFirst({
    where: and(eq(tables.magicLinkTokens.tokenHash, hashToken(body.token)), eq(tables.magicLinkTokens.orgId, org.id)),
  });
  if (!row || row.usedAt || row.expiresAt < new Date()) {
    return c.json({ error: "invalid or expired link" }, 401);
  }
  await db.update(tables.magicLinkTokens).set({ usedAt: new Date() }).where(eq(tables.magicLinkTokens.id, row.id));

  const user = await db.query.users.findFirst({
    where: and(eq(tables.users.orgId, org.id), eq(tables.users.email, row.email), isNull(tables.users.deactivatedAt)),
  });
  if (!user) return c.json({ error: "account not found" }, 401);

  const token = await createSession(c, user.id);
  await recordEvent(org.id, "user", user.id, "user_login", { method: "magic_link" });
  return c.json({ token, user: publicUser(user) });
});

/** Accept an invitation: sets name + password, activates the account. */
authRoutes.post("/accept-invite", async (c) => {
  const org = c.get("org");
  const body = z
    .object({ token: z.string(), name: z.string().min(1), password: z.string().min(8) })
    .parse(await c.req.json());

  const invite = await db.query.invitations.findFirst({
    where: and(eq(tables.invitations.tokenHash, hashToken(body.token)), eq(tables.invitations.orgId, org.id)),
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return c.json({ error: "invalid or expired invitation" }, 401);
  }

  const existing = await db.query.users.findFirst({
    where: and(eq(tables.users.orgId, org.id), eq(tables.users.email, invite.email)),
  });
  if (existing) return c.json({ error: "account already exists — sign in instead" }, 409);

  const [user] = await db
    .insert(tables.users)
    .values({
      orgId: org.id,
      email: invite.email,
      name: body.name,
      role: invite.role,
      passwordHash: await hashPassword(body.password),
    })
    .returning();
  await db.update(tables.invitations).set({ acceptedAt: new Date() }).where(eq(tables.invitations.id, invite.id));

  const token = await createSession(c, user.id);
  await recordEvent(org.id, "user", user.id, "invite_accepted", { role: user.role });
  return c.json({ token, user: publicUser(user) });
});

authRoutes.get("/me", async (c) => {
  const user = await sessionUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const org = c.get("org");
  if (user.orgId !== org.id) return c.json({ error: "unauthorized" }, 401);
  db.update(tables.users).set({ lastSeenAt: new Date() }).where(eq(tables.users.id, user.id)).execute().catch(() => {});
  return c.json({ user: publicUser(user) });
});

authRoutes.post("/logout", requireAuth(), async (c) => {
  const header = c.req.header("authorization");
  const raw = header?.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : (c.req.raw.headers.get("cookie")?.match(/kloop_session=([^;]+)/)?.[1] ?? "");
  if (raw) await db.delete(tables.sessions).where(eq(tables.sessions.tokenHash, hashToken(raw)));
  deleteCookie(c, "kloop_session", { path: "/" });
  return c.json({ ok: true });
});

authRoutes.patch("/profile", requireAuth(), async (c) => {
  const user = c.get("user");
  const body = z
    .object({
      name: z.string().min(1).optional(),
      language: z.string().min(2).max(8).optional(),
      notificationPrefs: z.record(z.string(), z.boolean()).optional(),
      password: z.string().min(8).optional(),
    })
    .parse(await c.req.json());

  const patch: Partial<typeof tables.users.$inferInsert> = {};
  if (body.name) patch.name = body.name;
  if (body.language) patch.language = body.language;
  if (body.notificationPrefs) {
    patch.notificationPrefs = { ...(user.notificationPrefs as Record<string, boolean>), ...body.notificationPrefs };
  }
  if (body.password) patch.passwordHash = await hashPassword(body.password);

  const [updated] = await db.update(tables.users).set(patch).where(eq(tables.users.id, user.id)).returning();
  return c.json({ user: publicUser(updated) });
});

/** Register a push token (mobile). */
authRoutes.post("/push-token", requireAuth(), async (c) => {
  const user = c.get("user");
  const body = z.object({ token: z.string(), platform: z.string().default("expo") }).parse(await c.req.json());
  await db
    .insert(tables.pushTokens)
    .values({ userId: user.id, token: body.token, platform: body.platform })
    .onConflictDoNothing();
  return c.json({ ok: true });
});
