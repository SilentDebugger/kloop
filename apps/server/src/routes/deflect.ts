import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../http/middleware.js";
import type { AppEnv } from "../http/context.js";
import { deflect } from "../engine/deflection.js";
import { recordEvent } from "../lib/events.js";

export const deflectRoutes = new Hono<AppEnv>();
deflectRoutes.use("*", requireAuth());

/**
 * Live deflection while typing (client debounces). Returns matching articles
 * and recently solved requests; "deflection_shown" is the learning signal.
 */
deflectRoutes.post("/", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const body = z.object({ text: z.string().min(3).max(4000) }).parse(await c.req.json());

  const suggestions = await deflect(org.id, body.text);

  if (suggestions.length > 0) {
    await recordEvent(org.id, "user", user.id, "deflection_shown", {
      textLength: body.text.length,
      suggestionIds: suggestions.map((s) => s.id),
    });
  }
  return c.json({ suggestions });
});
