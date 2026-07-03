import { Hono } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { requireAuth, requireRole } from "../http/middleware.js";
import type { AppEnv } from "../http/context.js";
import {
  addRevision,
  articleToMarkdown,
  blocksForRevision,
  createArticleWithRevision,
  provenanceForBlocks,
  publishedArticleView,
} from "../engine/articles.js";
import { recordEvent } from "../lib/events.js";
import { enqueueEmbed } from "../workers/queues.js";

export const articleRoutes = new Hono<AppEnv>();
articleRoutes.use("*", requireAuth());

const blockSchema = z.object({
  kind: z.enum(["symptoms", "environment", "resolution", "notes"]),
  contentMd: z.string().min(1).max(20_000),
  conditionText: z.string().max(500).nullable().optional(),
});

/**
 * KB browser. Requesters see published only; supporters can filter
 * (status, stale, confidence) for the KB manager view.
 */
articleRoutes.get("/", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const q = c.req.query();
  const isSupporter = user.role !== "requester";

  const conditions = [eq(tables.articles.orgId, org.id)];
  if (!isSupporter || !q.status) {
    conditions.push(eq(tables.articles.status, isSupporter ? (q.status ?? "published") : "published"));
  } else if (q.status !== "all") {
    conditions.push(eq(tables.articles.status, q.status));
  }
  if (q.stale === "true") conditions.push(eq(tables.articles.staleFlag, true));
  if (q.tag) conditions.push(sql`${q.tag} = any(${tables.articles.tags})`);

  const rows = await db
    .select()
    .from(tables.articles)
    .where(and(...conditions))
    .orderBy(desc(tables.articles.updatedAt))
    .limit(Math.min(Number(q.limit ?? 100), 200));

  const revIds = rows.map((r) => r.currentRevisionId).filter(Boolean) as string[];
  const revs =
    revIds.length > 0
      ? await db
          .select({ id: tables.articleRevisions.id, title: tables.articleRevisions.title, summary: tables.articleRevisions.summary })
          .from(tables.articleRevisions)
          .where(inArray(tables.articleRevisions.id, revIds))
      : [];
  const revById = Object.fromEntries(revs.map((r) => [r.id, r]));

  // tag facets for browsing
  const tagRows = await db.execute(sql`
    select tag, count(*)::int as n from articles, unnest(tags) tag
    where org_id = ${org.id} and status = 'published' group by tag order by n desc limit 30
  `);

  return c.json({
    articles: rows
      .filter((r) => r.currentRevisionId && revById[r.currentRevisionId])
      .map((r) => ({
        id: r.id,
        kb: `KB-${String(r.kbNumber).padStart(3, "0")}`,
        title: revById[r.currentRevisionId!].title,
        summary: revById[r.currentRevisionId!].summary,
        status: r.status,
        tags: r.tags,
        confidence: r.confidence,
        freshnessScore: r.freshnessScore,
        staleFlag: r.staleFlag,
        helpfulCount: r.helpfulCount,
        notHelpfulCount: r.notHelpfulCount,
        solveCount: r.solveCount,
        updatedAt: r.updatedAt,
      })),
    tags: tagRows.rows,
  });
});

/** Full article view (blocks). Tombstones 301-redirect to their survivor. */
articleRoutes.get("/:id", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const view = await publishedArticleView(org.id, c.req.param("id") ?? "");
  if (!view) return c.json({ error: "not found" }, 404);
  if ("redirectTo" in view) return c.json({ redirectTo: view.redirectTo });

  if (user.role === "requester" && view.article.status !== "published") {
    return c.json({ error: "not found" }, 404);
  }

  // view count + learning signal (fire and forget)
  db.update(tables.articles)
    .set({ viewCount: sql`${tables.articles.viewCount} + 1` })
    .where(eq(tables.articles.id, view.article.id))
    .execute()
    .catch(() => {});

  // supporters see provenance
  let provenance: { blockId: string; sourceKind: string; sourceId: string; ref: string | null }[] = [];
  if (user.role !== "requester") {
    const provRows = await provenanceForBlocks(view.blocks.map((b) => b.id));
    const reqIds = provRows.filter((p) => p.sourceKind === "request").map((p) => p.sourceId);
    const resRows =
      provRows.filter((p) => p.sourceKind === "resolution").length > 0
        ? await db
            .select({ id: tables.resolutions.id, requestId: tables.resolutions.requestId })
            .from(tables.resolutions)
            .where(inArray(tables.resolutions.id, provRows.filter((p) => p.sourceKind === "resolution").map((p) => p.sourceId)))
        : [];
    const allReqIds = [...new Set([...reqIds, ...resRows.map((r) => r.requestId)])];
    const reqs =
      allReqIds.length > 0
        ? await db
            .select({ id: tables.requests.id, refNumber: tables.requests.refNumber })
            .from(tables.requests)
            .where(inArray(tables.requests.id, allReqIds))
        : [];
    const refById = Object.fromEntries(reqs.map((r) => [r.id, `REQ-${r.refNumber}`]));
    const resToReq = Object.fromEntries(resRows.map((r) => [r.id, r.requestId]));
    provenance = provRows.map((p) => ({
      blockId: p.articleBlockId,
      sourceKind: p.sourceKind,
      sourceId: p.sourceId,
      ref:
        p.sourceKind === "request"
          ? (refById[p.sourceId] ?? null)
          : (refById[resToReq[p.sourceId] ?? ""] ?? null),
    }));
  }

  return c.json({ ...view, provenance });
});

/** Markdown export — docs are plain markdown, git-syncable, no lock-in. */
articleRoutes.get("/:id/markdown", async (c) => {
  const org = c.get("org");
  const view = await publishedArticleView(org.id, c.req.param("id") ?? "");
  if (!view || "redirectTo" in view) return c.json({ error: "not found" }, 404);
  const md = articleToMarkdown(view.article.title, view.article.summary, view.article.kb, view.blocks);
  return c.text(md, 200, { "content-type": "text/markdown; charset=utf-8" });
});

/** Requester feedback: helpful / not helpful. */
articleRoutes.post("/:id/feedback", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const body = z.object({ helpful: z.boolean() }).parse(await c.req.json());
  const id = c.req.param("id") ?? "";

  const [updated] = await db
    .update(tables.articles)
    .set(
      body.helpful
        ? { helpfulCount: sql`${tables.articles.helpfulCount} + 1` }
        : { notHelpfulCount: sql`${tables.articles.notHelpfulCount} + 1` },
    )
    .where(and(eq(tables.articles.id, id), eq(tables.articles.orgId, org.id)))
    .returning();
  if (!updated) return c.json({ error: "not found" }, 404);

  await recordEvent(org.id, "user", user.id, "article_feedback", { articleId: id, helpful: body.helpful });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Authoring (supporter): manual create, edit (new revision), archive
// ---------------------------------------------------------------------------

articleRoutes.post("/", requireRole("supporter"), async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const body = z
    .object({
      title: z.string().min(1).max(300),
      summary: z.string().max(1000).default(""),
      tags: z.array(z.string()).max(10).default([]),
      blocks: z.array(blockSchema).min(1),
      publish: z.boolean().default(false),
    })
    .parse(await c.req.json());

  const { article, revision } = await createArticleWithRevision({
    orgId: org.id,
    title: body.title,
    summary: body.summary,
    blocks: body.blocks,
    tags: body.tags,
    createdByKind: "user",
    createdById: user.id,
    status: body.publish ? "published" : "draft",
    confidence: 0.8,
  });

  await recordEvent(org.id, "user", user.id, body.publish ? "article_published" : "article_created", {
    articleId: article.id,
  });
  return c.json({ article: { id: article.id, kb: `KB-${String(article.kbNumber).padStart(3, "0")}`, revisionId: revision.id } }, 201);
});

articleRoutes.put("/:id", requireRole("supporter"), async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const id = c.req.param("id") ?? "";
  const body = z
    .object({
      title: z.string().min(1).max(300),
      summary: z.string().max(1000).default(""),
      tags: z.array(z.string()).max(10).optional(),
      blocks: z.array(blockSchema).min(1),
      changeNote: z.string().max(500).optional(),
      publish: z.boolean().default(true),
    })
    .parse(await c.req.json());

  const article = await db.query.articles.findFirst({
    where: and(eq(tables.articles.id, id), eq(tables.articles.orgId, org.id)),
  });
  if (!article) return c.json({ error: "not found" }, 404);
  if (article.status === "tombstone") return c.json({ error: "article is archived" }, 400);

  const revision = await addRevision({
    orgId: org.id,
    articleId: article.id,
    title: body.title,
    summary: body.summary,
    blocks: body.blocks,
    createdByKind: "user",
    createdById: user.id,
    approvedBy: user.id,
    parentRevisionId: article.currentRevisionId ?? undefined,
    changeNote: body.changeNote ?? "manual edit",
    setCurrent: true,
  });

  const patch: Partial<typeof tables.articles.$inferInsert> = {
    updatedAt: new Date(),
    staleFlag: false,
    staleReason: null,
    freshnessScore: 1,
  };
  if (body.tags) patch.tags = body.tags;
  if (body.publish && article.status === "draft") patch.status = "published";
  await db.update(tables.articles).set(patch).where(eq(tables.articles.id, article.id));

  await recordEvent(org.id, "user", user.id, "article_updated", { articleId: article.id, revisionId: revision.id });
  return c.json({ ok: true, revisionId: revision.id });
});

/** Archive = tombstone. Optionally redirect to a replacement article. */
articleRoutes.post("/:id/archive", requireRole("supporter"), async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const id = c.req.param("id") ?? "";
  const body = z.object({ redirectToArticleId: z.string().uuid().nullable().default(null) }).parse(
    await c.req.json().catch(() => ({})),
  );

  const [updated] = await db
    .update(tables.articles)
    .set({ status: "tombstone", redirectToArticleId: body.redirectToArticleId, updatedAt: new Date() })
    .where(and(eq(tables.articles.id, id), eq(tables.articles.orgId, org.id)))
    .returning();
  if (!updated) return c.json({ error: "not found" }, 404);

  await recordEvent(org.id, "user", user.id, "article_archived", { articleId: id });
  return c.json({ ok: true });
});

/** Revision history (supporter) — immutable, auditable, reversible. */
articleRoutes.get("/:id/revisions", requireRole("supporter"), async (c) => {
  const org = c.get("org");
  const id = c.req.param("id") ?? "";
  const revisions = await db
    .select()
    .from(tables.articleRevisions)
    .where(and(eq(tables.articleRevisions.articleId, id), eq(tables.articleRevisions.orgId, org.id)))
    .orderBy(desc(tables.articleRevisions.createdAt));
  return c.json({
    revisions: revisions.map((r) => ({
      id: r.id,
      title: r.title,
      createdByKind: r.createdByKind,
      changeNote: r.changeNote,
      createdAt: r.createdAt,
    })),
  });
});

/** Blocks of any revision (for draft review & diffing). */
articleRoutes.get("/:id/revisions/:revisionId/blocks", requireRole("supporter"), async (c) => {
  const org = c.get("org");
  const revision = await db.query.articleRevisions.findFirst({
    where: and(
      eq(tables.articleRevisions.id, c.req.param("revisionId") ?? ""),
      eq(tables.articleRevisions.orgId, org.id),
    ),
  });
  if (!revision || revision.articleId !== c.req.param("id")) return c.json({ error: "not found" }, 404);
  const blocks = await blocksForRevision(revision.id);
  return c.json({
    revision: { id: revision.id, title: revision.title, summary: revision.summary, changeNote: revision.changeNote },
    blocks: blocks.map((b) => ({ id: b.id, kind: b.kind, position: b.position, conditionText: b.conditionText, contentMd: b.contentMd })),
  });
});
