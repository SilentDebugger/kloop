/**
 * Per-org OIDC / SSO. The org admin configures issuer + client credentials in
 * Org Settings; users then get a "Continue with SSO" button.
 *
 * Flow: GET /api/auth/oidc/start -> provider -> GET /api/auth/oidc/callback
 * State is kept in a short-lived signed cookie (no server session needed).
 */
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import * as oidc from "openid-client";
import { and, eq, isNull } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { generateToken, hashToken, hmacSign, safeEqualHex } from "../lib/crypto.js";
import { config } from "../config.js";
import { orgSettings, type AppEnv } from "../http/context.js";
import { recordEvent } from "../lib/events.js";

export const oidcRoutes = new Hono<AppEnv>();

async function oidcConfigFor(org: typeof tables.orgs.$inferSelect): Promise<oidc.Configuration | null> {
  const s = orgSettings(org);
  if (!s.authMethods.oidc || !s.oidc?.issuer || !s.oidc.clientId) return null;
  return oidc.discovery(new URL(s.oidc.issuer), s.oidc.clientId, s.oidc.clientSecret);
}

oidcRoutes.get("/start", async (c) => {
  const org = c.get("org");
  const cfg = await oidcConfigFor(org);
  if (!cfg) return c.json({ error: "SSO is not configured for this organization" }, 400);

  const verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  const state = oidc.randomState();

  const url = oidc.buildAuthorizationUrl(cfg, {
    redirect_uri: `${config.PUBLIC_URL}/api/auth/oidc/callback`,
    scope: "openid email profile",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });

  const payload = JSON.stringify({ verifier, state, org: org.id, exp: Date.now() + 10 * 60_000 });
  const cookieVal = `${Buffer.from(payload).toString("base64url")}.${hmacSign(payload)}`;
  setCookie(c, "kloop_oidc", cookieVal, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 600 });
  return c.redirect(url.href);
});

oidcRoutes.get("/callback", async (c) => {
  const org = c.get("org");
  const cfg = await oidcConfigFor(org);
  if (!cfg) return c.json({ error: "SSO is not configured" }, 400);

  const cookieVal = getCookie(c, "kloop_oidc");
  deleteCookie(c, "kloop_oidc", { path: "/" });
  if (!cookieVal) return c.redirect("/login?error=sso_expired");
  const [b64, sig] = cookieVal.split(".");
  const payload = Buffer.from(b64 ?? "", "base64url").toString();
  if (!sig || !safeEqualHex(hmacSign(payload), sig)) return c.redirect("/login?error=sso_state");
  const { verifier, state, org: orgId, exp } = JSON.parse(payload) as Record<string, string> & { exp: number };
  if (orgId !== org.id || exp < Date.now()) return c.redirect("/login?error=sso_expired");

  try {
    const tokens = await oidc.authorizationCodeGrant(cfg, new URL(c.req.url), {
      pkceCodeVerifier: verifier,
      expectedState: state,
    });
    const claims = tokens.claims();
    const email = String(claims?.email ?? "").toLowerCase();
    if (!email) return c.redirect("/login?error=sso_no_email");

    let user = await db.query.users.findFirst({
      where: and(eq(tables.users.orgId, org.id), eq(tables.users.email, email), isNull(tables.users.deactivatedAt)),
    });
    if (!user) {
      // JIT-provision as requester; admins can elevate later.
      [user] = await db
        .insert(tables.users)
        .values({ orgId: org.id, email, name: String(claims?.name ?? email.split("@")[0]), role: "requester" })
        .returning();
    }

    const token = generateToken();
    await db.insert(tables.sessions).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    });
    setCookie(c, "kloop_session", token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: config.PUBLIC_URL.startsWith("https"),
      path: "/",
      maxAge: 30 * 24 * 3600,
    });
    await recordEvent(org.id, "user", user.id, "user_login", { method: "oidc" });
    return c.redirect("/");
  } catch {
    return c.redirect("/login?error=sso_failed");
  }
});
