import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import type { AppEnv } from "./context.js";
import { orgMiddleware } from "./middleware.js";
import { logger } from "../lib/logger.js";
import { wellKnownRoutes } from "../routes/wellKnown.js";
import { authRoutes } from "../routes/auth.js";
import { oidcRoutes } from "../routes/oidc.js";
import { orgRoutes } from "../routes/org.js";
import { requestRoutes } from "../routes/requests.js";
import { attachmentRoutes } from "../routes/attachments.js";
import { notificationRoutes } from "../routes/notifications.js";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof ZodError) {
      return c.json({ error: "validation failed", issues: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    }
    if (err instanceof HTTPException) return err.getResponse();
    logger.error("unhandled error", { path: c.req.path, err: String(err), stack: err instanceof Error ? err.stack : undefined });
    return c.json({ error: "internal error" }, 500);
  });

  // Mobile apps and API consumers call cross-origin; auth is bearer-token based.
  app.use(
    "/api/*",
    cors({
      origin: (origin) => origin,
      credentials: true,
      allowHeaders: ["content-type", "authorization", "x-kloop-org"],
    }),
  );

  app.get("/api/health", (c) => c.json({ ok: true, name: "kloop", time: new Date().toISOString() }));

  app.route("/.well-known", wellKnownRoutes);

  const api = new Hono<AppEnv>();
  api.use("*", orgMiddleware);
  api.route("/auth/oidc", oidcRoutes);
  api.route("/auth", authRoutes);
  api.route("/org", orgRoutes);

  registerLazyRoutes(api);
  app.route("/api", api);

  mountStatic(app);
  return app;
}

/**
 * Routes added by later feature slices register here; keeping one list makes
 * the surface easy to audit.
 */
function registerLazyRoutes(api: Hono<AppEnv>) {
  api.route("/requests", requestRoutes);
  api.route("/attachments", attachmentRoutes);
  api.route("/notifications", notificationRoutes);
}

/** Serve the built web app (prod/docker). In dev, Vite serves the frontend. */
function mountStatic(app: Hono<AppEnv>) {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, "../../static"), join(here, "../static"), join(process.cwd(), "static")];
  const staticDir = candidates.find((c) => existsSync(join(c, "index.html")));
  if (!staticDir) return;

  app.use("/*", serveStatic({ root: staticDir.startsWith(process.cwd()) ? staticDir.slice(process.cwd().length + 1) : staticDir }));
  // SPA fallback
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) return c.json({ error: "not found" }, 404);
    const html = await readFile(join(staticDir, "index.html"), "utf8");
    return c.html(html);
  });
}
