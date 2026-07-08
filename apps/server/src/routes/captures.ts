import { Hono } from "hono";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { requireAuth, requireRole } from "../http/middleware.js";
import type { AppEnv } from "../http/context.js";
import { recordEvent } from "../lib/events.js";
import { enqueue, QUEUES } from "../workers/queues.js";
import { archiveCaptureDrafts } from "../engine/docGen.js";

/**
 * Knowledge captures: a supporter brain-dump that the doc-gen pipeline turns
 * into draft articles. Client flow: POST / → poll GET /:id while the worker
 * runs → POST /:id/submit sends the kept drafts into the review inbox.
 */
export const captureRoutes = new Hono<AppEnv>();
captureRoutes.use("*", requireAuth(), requireRole("supporter"));

function captureView(c: typeof tables.docCaptures.$inferSelect) {
  return {
    id: c.id,
    status: c.status,
    rawText: c.rawText,
    topics: c.topics,
    error: c.error,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

async function loadOwnCapture(orgId: string, userId: string, id: string) {
  return db.query.docCaptures.findFirst({
    where: and(eq(tables.docCaptures.id, id), eq(tables.docCaptures.orgId, orgId), eq(tables.docCaptures.createdBy, userId)),
  });
}

captureRoutes.post("/", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const body = z
    .object({
      text: z.string().max(20_000).default(""),
      attachmentIds: z.array(z.string().uuid()).max(10).default([]),
    })
    .refine((v) => v.text.trim().length > 0 || v.attachmentIds.length > 0, {
      message: "notes or attachments required",
    })
    .parse(await c.req.json());

  const [capture] = await db
    .insert(tables.docCaptures)
    .values({ orgId: org.id, createdBy: user.id, rawText: body.text.trim() })
    .returning();

  if (body.attachmentIds.length > 0) {
    await db
      .update(tables.attachments)
      .set({ ownerKind: "doc_capture", ownerId: capture.id })
      .where(
        and(
          inArray(tables.attachments.id, body.attachmentIds),
          eq(tables.attachments.orgId, org.id),
          eq(tables.attachments.ownerKind, "pending"),
        ),
      );
  }

  await enqueue(QUEUES.docGen, { captureId: capture.id });
  await recordEvent(org.id, "user", user.id, "doc_capture_created", {
    captureId: capture.id,
    attachments: body.attachmentIds.length,
  });

  return c.json({ capture: captureView(capture) }, 201);
});

/**
 * The caller's capture-in-progress (or finished-but-unacknowledged one), if
 * any. Drives the mobile resume pill / auto-reopening sheet — the server is
 * the source of truth so a reinstall or second device can't get out of sync.
 * Declared before /:id so "active" isn't swallowed by the param route.
 */
captureRoutes.get("/active", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const capture = await db.query.docCaptures.findFirst({
    where: and(
      eq(tables.docCaptures.orgId, org.id),
      eq(tables.docCaptures.createdBy, user.id),
      inArray(tables.docCaptures.status, ["queued", "reading", "drafting", "ready", "failed"]),
    ),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
  return c.json({ capture: capture ? captureView(capture) : null });
});

captureRoutes.get("/:id", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const capture = await loadOwnCapture(org.id, user.id, c.req.param("id") ?? "");
  if (!capture) return c.json({ error: "not found" }, 404);
  return c.json({ capture: captureView(capture) });
});

/** Send kept drafts to the review inbox; discarded ones are archived. */
captureRoutes.post("/:id/submit", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const capture = await loadOwnCapture(org.id, user.id, c.req.param("id") ?? "");
  if (!capture) return c.json({ error: "not found" }, 404);
  if (capture.status !== "ready") return c.json({ error: "capture is not ready to submit" }, 400);

  const body = z
    .object({ discardArticleIds: z.array(z.string().uuid()).max(20).default([]) })
    .parse(await c.req.json().catch(() => ({})));
  const discard = new Set(body.discardArticleIds);

  const topics = capture.topics;
  let submitted = 0;
  for (const topic of topics) {
    if (topic.status !== "drafted" || !topic.articleId) continue;

    if (discard.has(topic.articleId)) {
      await db
        .update(tables.articles)
        .set({ status: "tombstone", updatedAt: new Date() })
        .where(and(eq(tables.articles.id, topic.articleId), eq(tables.articles.orgId, org.id), eq(tables.articles.status, "draft")));
      topic.status = "discarded";
      continue;
    }

    const article = await db.query.articles.findFirst({
      where: and(eq(tables.articles.id, topic.articleId), eq(tables.articles.orgId, org.id)),
    });
    if (!article || article.status !== "draft" || !article.currentRevisionId) continue;

    // same shape articleGen produces — web + mobile review UIs work unchanged.
    // No push notification: the author just created these, the badge is enough.
    await db.insert(tables.reviewItems).values({
      orgId: org.id,
      kind: "draft",
      articleId: article.id,
      revisionId: article.currentRevisionId,
      confidence: article.confidence,
      context: `From ${user.name.split(" ")[0]}'s knowledge capture`,
    });
    submitted++;
  }

  const [updated] = await db
    .update(tables.docCaptures)
    .set({ status: "submitted", topics, updatedAt: new Date() })
    .where(eq(tables.docCaptures.id, capture.id))
    .returning();

  await recordEvent(org.id, "user", user.id, "doc_capture_submitted", {
    captureId: capture.id,
    submitted,
    discarded: body.discardArticleIds.length,
  });

  return c.json({ ok: true, submitted, capture: captureView(updated) });
});

captureRoutes.post("/:id/cancel", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const capture = await loadOwnCapture(org.id, user.id, c.req.param("id") ?? "");
  if (!capture) return c.json({ error: "not found" }, 404);
  if (capture.status === "submitted") return c.json({ error: "already submitted" }, 400);

  const [updated] = await db
    .update(tables.docCaptures)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(tables.docCaptures.id, capture.id))
    .returning();
  // drafts already created before the cancel are archived here; the worker
  // re-checks status between topics so nothing new appears afterwards
  await archiveCaptureDrafts(updated);

  await recordEvent(org.id, "user", user.id, "doc_capture_cancelled", { captureId: capture.id });
  return c.json({ ok: true });
});
