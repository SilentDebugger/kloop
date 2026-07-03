import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { requireAuth, requireRole } from "../http/middleware.js";
import type { AppEnv } from "../http/context.js";
import { addRevision, blocksForRevision } from "../engine/articles.js";
import { recordEvent } from "../lib/events.js";
import { bus } from "../realtime/bus.js";
import { enqueueEmbed } from "../workers/queues.js";

export const reviewRoutes = new Hono<AppEnv>();
reviewRoutes.use("*", requireAuth(), requireRole("supporter"));

const editSchema = z
  .object({
    title: z.string().min(1).max(300),
    summary: z.string().max(1000).default(""),
    blocks: z
      .array(
        z.object({
          kind: z.enum(["symptoms", "environment", "resolution", "notes"]),
          contentMd: z.string().min(1).max(20_000),
          conditionText: z.string().max(500).nullable().optional(),
        }),
      )
      .min(1),
  })
  .optional();

/** Badge counts for the tab bar. */
reviewRoutes.get("/counts", async (c) => {
  const org = c.get("org");
  const rows = await db
    .select({ kind: tables.reviewItems.kind })
    .from(tables.reviewItems)
    .where(and(eq(tables.reviewItems.orgId, org.id), eq(tables.reviewItems.status, "pending")));
  const counts = { draft: 0, update: 0, merge: 0, stale: 0, total: rows.length };
  for (const r of rows) counts[r.kind as keyof typeof counts]++;
  return c.json({ counts });
});

/** Review inbox: drafts / updates / merges (+ stale flags), hydrated. */
reviewRoutes.get("/", async (c) => {
  const org = c.get("org");
  const kind = c.req.query("kind");

  const conditions = [eq(tables.reviewItems.orgId, org.id), eq(tables.reviewItems.status, "pending")];
  if (kind) conditions.push(eq(tables.reviewItems.kind, kind));

  const items = await db
    .select()
    .from(tables.reviewItems)
    .where(and(...conditions))
    .orderBy(desc(tables.reviewItems.createdAt))
    .limit(100);

  // hydrate revision titles + merge candidates
  const revIds = items.map((i) => i.revisionId).filter(Boolean) as string[];
  const revs =
    revIds.length > 0
      ? await db
          .select({ id: tables.articleRevisions.id, title: tables.articleRevisions.title, summary: tables.articleRevisions.summary })
          .from(tables.articleRevisions)
          .where(inArray(tables.articleRevisions.id, revIds))
      : [];
  const revById = Object.fromEntries(revs.map((r) => [r.id, r]));

  const articleIds = items.map((i) => i.articleId).filter(Boolean) as string[];
  const articles =
    articleIds.length > 0
      ? await db
          .select({ id: tables.articles.id, kbNumber: tables.articles.kbNumber, staleReason: tables.articles.staleReason })
          .from(tables.articles)
          .where(inArray(tables.articles.id, articleIds))
      : [];
  const articleById = Object.fromEntries(articles.map((a) => [a.id, a]));

  return c.json({
    items: items.map((i) => ({
      id: i.id,
      kind: i.kind,
      articleId: i.articleId,
      revisionId: i.revisionId,
      mergeCandidateId: i.mergeCandidateId,
      confidence: i.confidence,
      context: i.context,
      createdAt: i.createdAt,
      title: i.revisionId ? (revById[i.revisionId]?.title ?? null) : null,
      kb: i.articleId && articleById[i.articleId] ? `KB-${String(articleById[i.articleId].kbNumber).padStart(3, "0")}` : null,
      staleReason: i.articleId ? (articleById[i.articleId]?.staleReason ?? null) : null,
    })),
  });
});

/**
 * Approve. Optional `edits` = edit-then-approve (creates a new revision from
 * the reviewer's changes). Merge approvals are handled by the merge engine.
 */
reviewRoutes.post("/:id/approve", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const body = z.object({ edits: editSchema }).parse(await c.req.json().catch(() => ({})));

  const item = await db.query.reviewItems.findFirst({
    where: and(eq(tables.reviewItems.id, c.req.param("id") ?? ""), eq(tables.reviewItems.orgId, org.id)),
  });
  if (!item || item.status !== "pending") return c.json({ error: "not found or already reviewed" }, 404);

  if (item.kind === "merge") {
    const { approveMerge } = await import("../engine/merge.js");
    const result = await approveMerge(item, user.id, body.edits);
    bus.publish(org.id, { type: "review_changed", supporterOnly: true, data: { reviewItemId: item.id } });
    return c.json(result);
  }

  if (!item.articleId || !item.revisionId) return c.json({ error: "malformed review item" }, 500);

  let liveRevisionId = item.revisionId;

  if (body.edits) {
    const revision = await addRevision({
      orgId: org.id,
      articleId: item.articleId,
      title: body.edits.title,
      summary: body.edits.summary,
      blocks: body.edits.blocks,
      createdByKind: "user",
      createdById: user.id,
      approvedBy: user.id,
      parentRevisionId: item.revisionId,
      changeNote: "edited during review",
      setCurrent: false,
    });
    liveRevisionId = revision.id;
  }

  // publish: flip current revision, mark article published & fresh
  await db
    .update(tables.articleRevisions)
    .set({ approvedBy: user.id })
    .where(eq(tables.articleRevisions.id, liveRevisionId));
  await db
    .update(tables.articles)
    .set({
      currentRevisionId: liveRevisionId,
      status: "published",
      staleFlag: false,
      staleReason: null,
      freshnessScore: 1,
      updatedAt: new Date(),
      embeddingStatus: "pending",
    })
    .where(eq(tables.articles.id, item.articleId));
  await enqueueEmbed("article", item.articleId);

  await db
    .update(tables.reviewItems)
    .set({ status: "approved", reviewedBy: user.id, reviewedAt: new Date() })
    .where(eq(tables.reviewItems.id, item.id));

  await recordEvent(org.id, "user", user.id, item.kind === "draft" ? "article_published" : "article_update_approved", {
    articleId: item.articleId,
    reviewItemId: item.id,
    edited: Boolean(body.edits),
  });
  bus.publish(org.id, { type: "review_changed", supporterOnly: true, data: { reviewItemId: item.id } });
  return c.json({ ok: true, articleId: item.articleId, revisionId: liveRevisionId });
});

reviewRoutes.post("/:id/reject", async (c) => {
  const org = c.get("org");
  const user = c.get("user");

  const item = await db.query.reviewItems.findFirst({
    where: and(eq(tables.reviewItems.id, c.req.param("id") ?? ""), eq(tables.reviewItems.orgId, org.id)),
  });
  if (!item || item.status !== "pending") return c.json({ error: "not found or already reviewed" }, 404);

  await db
    .update(tables.reviewItems)
    .set({ status: "rejected", reviewedBy: user.id, reviewedAt: new Date() })
    .where(eq(tables.reviewItems.id, item.id));

  if (item.kind === "merge" && item.mergeCandidateId) {
    // negative constraint: suppresses re-proposal unless similarity rises significantly
    await db
      .update(tables.mergeCandidates)
      .set({ status: "rejected", reviewedBy: user.id, reviewedAt: new Date() })
      .where(eq(tables.mergeCandidates.id, item.mergeCandidateId));
  }

  if (item.kind === "stale" && item.articleId) {
    // reviewer says the doc is fine — clear the flag
    await db
      .update(tables.articles)
      .set({ staleFlag: false, staleReason: null, freshnessScore: 1 })
      .where(eq(tables.articles.id, item.articleId));
  }

  await recordEvent(org.id, "user", user.id, "review_rejected", { reviewItemId: item.id, kind: item.kind });
  bus.publish(org.id, { type: "review_changed", supporterOnly: true, data: { reviewItemId: item.id } });
  return c.json({ ok: true });
});

/** Full payload for the review screens (draft blocks / merge 3-pane). */
reviewRoutes.get("/:id", async (c) => {
  const org = c.get("org");
  const item = await db.query.reviewItems.findFirst({
    where: and(eq(tables.reviewItems.id, c.req.param("id") ?? ""), eq(tables.reviewItems.orgId, org.id)),
  });
  if (!item) return c.json({ error: "not found" }, 404);

  if (item.kind === "merge" && item.mergeCandidateId) {
    const { mergeReviewPayload } = await import("../engine/merge.js");
    const payload = await mergeReviewPayload(org.id, item.mergeCandidateId);
    if (!payload) return c.json({ error: "merge candidate missing" }, 404);
    return c.json({ item: { id: item.id, kind: item.kind, confidence: item.confidence, context: item.context }, ...payload });
  }

  if (!item.articleId || !item.revisionId) return c.json({ error: "malformed review item" }, 500);
  const article = await db.query.articles.findFirst({ where: eq(tables.articles.id, item.articleId) });
  const revision = await db.query.articleRevisions.findFirst({ where: eq(tables.articleRevisions.id, item.revisionId) });
  if (!article || !revision) return c.json({ error: "not found" }, 404);

  const blocks = await blocksForRevision(revision.id);

  // provenance refs for "SOURCES: REQ-1284 REQ-1201..."
  const prov = await db
    .select()
    .from(tables.provenance)
    .where(inArray(tables.provenance.articleBlockId, blocks.map((b) => b.id)));
  const resIds = [...new Set(prov.filter((p) => p.sourceKind === "resolution").map((p) => p.sourceId))];
  const reqIdsDirect = [...new Set(prov.filter((p) => p.sourceKind === "request").map((p) => p.sourceId))];
  const resRows =
    resIds.length > 0
      ? await db
          .select({ id: tables.resolutions.id, requestId: tables.resolutions.requestId })
          .from(tables.resolutions)
          .where(inArray(tables.resolutions.id, resIds))
      : [];
  const allReqIds = [...new Set([...reqIdsDirect, ...resRows.map((r) => r.requestId)])];
  const reqs =
    allReqIds.length > 0
      ? await db
          .select({ id: tables.requests.id, refNumber: tables.requests.refNumber })
          .from(tables.requests)
          .where(inArray(tables.requests.id, allReqIds))
      : [];

  // current published revision for update diffs
  let currentBlocks: Awaited<ReturnType<typeof blocksForRevision>> = [];
  let currentTitle: string | null = null;
  if (item.kind === "update" && article.currentRevisionId && article.currentRevisionId !== revision.id) {
    currentBlocks = await blocksForRevision(article.currentRevisionId);
    const currentRev = await db.query.articleRevisions.findFirst({
      where: eq(tables.articleRevisions.id, article.currentRevisionId),
    });
    currentTitle = currentRev?.title ?? null;
  }

  return c.json({
    item: { id: item.id, kind: item.kind, confidence: item.confidence, context: item.context, createdAt: item.createdAt },
    article: {
      id: article.id,
      kb: `KB-${String(article.kbNumber).padStart(3, "0")}`,
      status: article.status,
      staleReason: article.staleReason,
    },
    proposed: {
      revisionId: revision.id,
      title: revision.title,
      summary: revision.summary,
      changeNote: revision.changeNote,
      blocks: blocks.map((b) => ({ id: b.id, kind: b.kind, position: b.position, conditionText: b.conditionText, contentMd: b.contentMd })),
    },
    current: currentTitle
      ? {
          title: currentTitle,
          blocks: currentBlocks.map((b) => ({ id: b.id, kind: b.kind, position: b.position, conditionText: b.conditionText, contentMd: b.contentMd })),
        }
      : null,
    sources: reqs.map((r) => `REQ-${r.refNumber}`),
  });
});
