import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { hashToken } from "../lib/crypto.js";
import type { AppEnv } from "./context.js";

/**
 * Org resolution, in priority order:
 *  1. `x-kloop-org` header (slug) — used by mobile/multi-org clients
 *  2. host match against orgs.domain
 *  3. single-org fallback (the common self-hosted case)
 */
export async function resolveOrg(c: Context<AppEnv>): Promise<typeof tables.orgs.$inferSelect | null> {
  const slug = c.req.header("x-kloop-org");
  if (slug) {
    const org = await db.query.orgs.findFirst({ where: eq(tables.orgs.slug, slug) });
    if (org) return org;
  }
  const host = (c.req.header("host") ?? "").split(":")[0];
  if (host) {
    const org = await db.query.orgs.findFirst({ where: eq(tables.orgs.domain, host) });
    if (org) return org;
  }
  const all = await db.select().from(tables.orgs).limit(2);
  return all.length >= 1 ? all[0] : null;
}

export async function orgMiddleware(c: Context<AppEnv>, next: Next) {
  const org = await resolveOrg(c);
  if (!org) return c.json({ error: "no organization configured — run `kloop admin create`" }, 503);
  c.set("org", org);
  await next();
}

function bearerToken(c: Context): string | null {
  const header = c.req.header("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return getCookie(c, "kloop_session") ?? null;
}

export async function sessionUser(c: Context<AppEnv>): Promise<typeof tables.users.$inferSelect | null> {
  const token = bearerToken(c);
  if (!token) return null;

  // API keys authenticate as an org-level service identity (kloop_ak_ prefix).
  if (token.startsWith("kloop_ak_")) {
    const [key] = await db
      .select()
      .from(tables.apiKeys)
      .where(and(eq(tables.apiKeys.tokenHash, hashToken(token)), isNull(tables.apiKeys.revokedAt)));
    if (!key) return null;
    c.set("apiKeyId", key.id);
    db.update(tables.apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(tables.apiKeys.id, key.id))
      .execute()
      .catch(() => {});
    // API keys act as an admin service account of their org.
    const admin = await db.query.users.findFirst({
      where: and(eq(tables.users.orgId, key.orgId), eq(tables.users.role, "admin")),
    });
    return admin ?? null;
  }

  const [row] = await db
    .select({ user: tables.users })
    .from(tables.sessions)
    .innerJoin(tables.users, eq(tables.sessions.userId, tables.users.id))
    .where(and(eq(tables.sessions.tokenHash, hashToken(token)), gt(tables.sessions.expiresAt, new Date())));
  return row?.user ?? null;
}

export function requireAuth() {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = await sessionUser(c);
    if (!user || user.deactivatedAt) return c.json({ error: "unauthorized" }, 401);
    const org = c.get("org");
    if (org && user.orgId !== org.id) return c.json({ error: "unauthorized" }, 401);
    c.set("user", user);
    await next();
  };
}

const ROLE_RANK: Record<string, number> = { requester: 1, supporter: 2, admin: 3 };

export function requireRole(role: "supporter" | "admin") {
  return async (c: Context<AppEnv>, next: Next) => {
    const user = c.get("user");
    if (!user || (ROLE_RANK[user.role] ?? 0) < ROLE_RANK[role]) {
      return c.json({ error: "forbidden" }, 403);
    }
    await next();
  };
}
