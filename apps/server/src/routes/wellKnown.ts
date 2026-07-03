import { Hono } from "hono";
import { orgSettings, type AppEnv } from "../http/context.js";
import { resolveOrg } from "../http/middleware.js";
import { config } from "../config.js";

/**
 * Discovery document — documentation.md §4 "server connection flow".
 * The mobile app fetches https://<domain>/.well-known/kloop.json to learn the
 * API base URL, auth methods, and branding before connecting.
 */
export const wellKnownRoutes = new Hono<AppEnv>();

wellKnownRoutes.get("/kloop.json", async (c) => {
  const org = await resolveOrg(c);
  if (!org) return c.json({ error: "no organization configured" }, 404);
  const s = orgSettings(org);
  return c.json({
    kloop: true,
    version: 1,
    apiBaseUrl: `${config.PUBLIC_URL}/api`,
    org: {
      name: org.name,
      slug: org.slug,
      logoUrl: org.logoUrl,
      theme: org.theme,
    },
    auth: {
      magicLink: s.authMethods.magicLink,
      password: s.authMethods.password,
      oidc: s.authMethods.oidc,
    },
  });
});
