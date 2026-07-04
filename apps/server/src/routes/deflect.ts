import { Hono } from "hono";
import { z } from "zod";
import { requireAuth } from "../http/middleware.js";
import type { AppEnv } from "../http/context.js";
import { deflect } from "../engine/deflection.js";
import { recordEvent } from "../lib/events.js";

export const deflectRoutes = new Hono<AppEnv>();
deflectRoutes.use("*", requireAuth());

/**
 * Live deflection while typing (client debounces). Returns matching published
 * articles; "deflection_shown" is the learning signal. Uploaded-but-unsent
 * attachments join the query (OCR/transcript text + multimodal embeddings).
 */
deflectRoutes.post("/", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const body = z
    .object({
      text: z.string().max(4000).default(""),
      attachmentIds: z.array(z.string().uuid()).max(10).default([]),
    })
    .refine((v) => v.text.trim().length >= 3 || v.attachmentIds.length > 0, {
      message: "text (min 3 chars) or attachments required",
    })
    .parse(await c.req.json());

  const { suggestions, pendingAttachments } = await deflect(org.id, body.text, {
    attachmentIds: body.attachmentIds,
    userId: user.id,
  });

  if (suggestions.length > 0) {
    await recordEvent(org.id, "user", user.id, "deflection_shown", {
      textLength: body.text.length,
      attachmentCount: body.attachmentIds.length,
      suggestionIds: suggestions.map((s) => s.id),
    });
  }
  return c.json({ suggestions, pendingAttachments });
});
