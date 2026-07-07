import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
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

/**
 * What the AI did (or is doing) with recent resolutions — the documentation
 * pipeline made visible. One row per resolution, newest first.
 */
reviewRoutes.get("/activity", async (c) => {
  const org = c.get("org");
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: tables.resolutions.id,
      requestId: tables.resolutions.requestId,
      articleId: tables.resolutions.articleId,
      docState: tables.resolutions.docState,
      docNote: tables.resolutions.docNote,
      createdAt: tables.resolutions.createdAt,
      requestRefNumber: tables.requests.refNumber,
      requestTitle: tables.requests.title,
      supporterName: tables.users.name,
    })
    .from(tables.resolutions)
    .innerJoin(tables.requests, eq(tables.requests.id, tables.resolutions.requestId))
    .innerJoin(tables.users, eq(tables.users.id, tables.resolutions.supporterId))
    .where(and(eq(tables.resolutions.orgId, org.id), gt(tables.resolutions.createdAt, since)))
    .orderBy(desc(tables.resolutions.createdAt))
    .limit(20);

  // drafted rows link to their pending review item, if it's still in the inbox
  const articleIds = rows.filter((r) => r.docState === "drafted" && r.articleId).map((r) => r.articleId as string);
  const pendingItems =
    articleIds.length > 0
      ? await db
          .select({ id: tables.reviewItems.id, articleId: tables.reviewItems.articleId })
          .from(tables.reviewItems)
          .where(
            and(
              eq(tables.reviewItems.orgId, org.id),
              eq(tables.reviewItems.status, "pending"),
              inArray(tables.reviewItems.articleId, articleIds),
            ),
          )
      : [];
  const reviewItemByArticle = new Map(pendingItems.map((i) => [i.articleId, i.id]));

  const STALL_MS = 15 * 60 * 1000;
  return c.json({
    items: rows.map((r) => ({
      id: r.id,
      requestId: r.requestId,
      requestRef: `REQ-${r.requestRefNumber}`,
      requestTitle: r.requestTitle,
      supporterName: r.supporterName,
      createdAt: r.createdAt,
      // a pipeline stuck in "working" past any plausible runtime is dead —
      // report it instead of showing an eternal spinner
      state:
        r.docState === "working" && Date.now() - r.createdAt.getTime() > STALL_MS ? "failed" : r.docState,
      note:
        r.docState === "working" && Date.now() - r.createdAt.getTime() > STALL_MS
          ? "This one never finished — the capture is saved."
          : r.docNote,
      articleId: r.articleId,
      reviewItemId: r.articleId ? (reviewItemByArticle.get(r.articleId) ?? null) : null,
    })),
  });
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

    // "keep separate" on a merge that superseded an unpublished draft review
    // ("merge into existing" flow) — put the draft back in the inbox so it
    // isn't silently lost
    const candidate = await db.query.mergeCandidates.findFirst({
      where: eq(tables.mergeCandidates.id, item.mergeCandidateId),
    });
    if (candidate) {
      const loser = await db.query.articles.findFirst({ where: eq(tables.articles.id, candidate.articleBId) });
      if (loser?.status === "draft") {
        await db
          .update(tables.reviewItems)
          .set({ status: "pending", reviewedBy: null, reviewedAt: null })
          .where(
            and(
              eq(tables.reviewItems.orgId, org.id),
              eq(tables.reviewItems.articleId, candidate.articleBId),
              eq(tables.reviewItems.kind, "draft"),
              eq(tables.reviewItems.status, "superseded"),
            ),
          );
      }
    }
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

/**
 * "This draft is really KB-xxx": instead of publishing a near-duplicate, spawn
 * a merge proposal (draft + existing article -> one doc, existing KB number
 * survives). The draft review item is superseded by the new merge review item;
 * rejecting that merge later puts the draft back in the inbox.
 */
reviewRoutes.post("/:id/merge-into", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const body = z.object({ articleId: z.string().uuid() }).parse(await c.req.json());

  const item = await db.query.reviewItems.findFirst({
    where: and(eq(tables.reviewItems.id, c.req.param("id") ?? ""), eq(tables.reviewItems.orgId, org.id)),
  });
  if (!item || item.status !== "pending") return c.json({ error: "not found or already reviewed" }, 404);
  if ((item.kind !== "draft" && item.kind !== "update") || !item.articleId) {
    return c.json({ error: "only draft/update reviews can be merged into an article" }, 400);
  }
  if (body.articleId === item.articleId) return c.json({ error: "cannot merge an article into itself" }, 400);

  const target = await db.query.articles.findFirst({
    where: and(eq(tables.articles.id, body.articleId), eq(tables.articles.orgId, org.id)),
  });
  if (!target || target.status !== "published") return c.json({ error: "target article not found or not published" }, 404);

  const { proposeManualMerge } = await import("../engine/merge.js");
  const result = await proposeManualMerge(org.id, body.articleId, item.articleId);
  if ("error" in result) return c.json({ error: result.error }, 502);

  await db
    .update(tables.reviewItems)
    .set({ status: "superseded", reviewedBy: user.id, reviewedAt: new Date() })
    .where(eq(tables.reviewItems.id, item.id));

  await recordEvent(org.id, "user", user.id, "review_merge_requested", {
    reviewItemId: item.id,
    mergeReviewItemId: result.reviewItemId,
    targetArticleId: body.articleId,
  });
  bus.publish(org.id, { type: "review_changed", supporterOnly: true, data: { reviewItemId: item.id } });
  return c.json({ ok: true, mergeReviewItemId: result.reviewItemId });
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

  // similar published articles — lets the reviewer merge instead of publishing a near-duplicate
  const { searchArticles, relevantHits } = await import("../search/hybrid.js");
  const simHits = relevantHits(
    await searchArticles(org.id, `${revision.title}\n${revision.summary}`, {
      vec: (article.embedding as number[] | null) ?? undefined,
      limit: 4,
    }),
  )
    .filter((h) => h.id !== article.id)
    .slice(0, 3);
  let similarArticles: { id: string; kb: string; title: string; summary: string; similarity: number | null }[] = [];
  if (simHits.length > 0) {
    const simRows = await db
      .select({ id: tables.articles.id, kbNumber: tables.articles.kbNumber, revId: tables.articles.currentRevisionId })
      .from(tables.articles)
      .where(inArray(tables.articles.id, simHits.map((h) => h.id)));
    const simRevs = await db
      .select({ id: tables.articleRevisions.id, title: tables.articleRevisions.title, summary: tables.articleRevisions.summary })
      .from(tables.articleRevisions)
      .where(inArray(tables.articleRevisions.id, simRows.map((r) => r.revId).filter(Boolean) as string[]));
    const simRevById = Object.fromEntries(simRevs.map((r) => [r.id, r]));
    similarArticles = simHits.flatMap((h) => {
      const row = simRows.find((r) => r.id === h.id);
      if (!row?.revId || !simRevById[row.revId]) return [];
      return [
        {
          id: row.id,
          kb: `KB-${String(row.kbNumber).padStart(3, "0")}`,
          title: simRevById[row.revId].title,
          summary: simRevById[row.revId].summary,
          similarity: h.similarity ?? null,
        },
      ];
    });
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
    similarArticles,
  });
});
