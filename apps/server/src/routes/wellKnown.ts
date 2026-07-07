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

/** Apple Team ID + iOS bundle identifier of the kloop mobile app. */
const APPLE_APP_ID = "R3LB26HH27.ch.enginess.kloop";

/**
 * Universal Links: iOS fetches this once per app install to learn which https
 * links on this domain open the app instead of the browser. Only app-capable
 * paths are claimed — emailed magic links / invites and request/review links;
 * the rest of the web app stays in the browser.
 *
 * The domain must also be listed in the app's associatedDomains entitlement
 * (apps/mobile/app.json) and the app rebuilt for changes to take effect.
 */
wellKnownRoutes.get("/apple-app-site-association", (c) =>
  c.json({
    applinks: {
      details: [
        {
          appIDs: [APPLE_APP_ID],
          components: [
            { "/": "/auth/verify*" },
            { "/": "/auth/invite*" },
            { "/": "/requests/*" },
            { "/": "/reviews*" },
          ],
        },
      ],
    },
    // lets iOS offer saved passwords for this domain inside the app
    webcredentials: { apps: [APPLE_APP_ID] },
  }),
);

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
