import { Hono } from "hono";
import { inArray, eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { requireAuth } from "../http/middleware.js";
import type { AppEnv } from "../http/context.js";
import { embedQuery, searchArticles, searchAllRequests, searchResolutions } from "../search/hybrid.js";
import { recordEvent } from "../lib/events.js";

export const searchRoutes = new Hono<AppEnv>();
searchRoutes.use("*", requireAuth());

/**
 * Global hybrid search: articles + requests (+ resolutions for supporters).
 * Requesters only see published articles and their own requests.
 */
searchRoutes.get("/", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ articles: [], requests: [], resolutions: [] });

  const isSupporter = user.role !== "requester";
  const vec = await embedQuery(q);

  const [articleHits, requestHits, resolutionHits] = await Promise.all([
    searchArticles(org.id, q, { vec, limit: 8 }),
    searchAllRequests(org.id, q, { vec, limit: 8 }),
    isSupporter ? searchResolutions(org.id, q, { vec, limit: 5 }) : Promise.resolve([]),
  ]);

  // hydrate articles
  const articleRows =
    articleHits.length > 0
      ? await db
          .select({
            id: tables.articles.id,
            kbNumber: tables.articles.kbNumber,
            status: tables.articles.status,
            helpfulCount: tables.articles.helpfulCount,
            notHelpfulCount: tables.articles.notHelpfulCount,
            revId: tables.articles.currentRevisionId,
          })
          .from(tables.articles)
          .where(inArray(tables.articles.id, articleHits.map((h) => h.id)))
      : [];
  const revs =
    articleRows.length > 0
      ? await db
          .select({ id: tables.articleRevisions.id, title: tables.articleRevisions.title, summary: tables.articleRevisions.summary })
          .from(tables.articleRevisions)
          .where(inArray(tables.articleRevisions.id, articleRows.map((a) => a.revId).filter(Boolean) as string[]))
      : [];
  const revById = Object.fromEntries(revs.map((r) => [r.id, r]));

  // hydrate requests (requesters: own only)
  let requestRows: (typeof tables.requests.$inferSelect)[] = [];
  if (requestHits.length > 0) {
    requestRows = await db
      .select()
      .from(tables.requests)
      .where(
        and(
          inArray(tables.requests.id, requestHits.map((h) => h.id)),
          ...(isSupporter ? [] : [eq(tables.requests.authorId, user.id)]),
        ),
      );
  }

  // hydrate resolutions with their requests (supporter mid-call lookup)
  const resolutionRows =
    resolutionHits.length > 0
      ? await db
          .select({
            id: tables.resolutions.id,
            requestId: tables.resolutions.requestId,
            structuredSummary: tables.resolutions.structuredSummary,
            rawCaptureText: tables.resolutions.rawCaptureText,
            createdAt: tables.resolutions.createdAt,
          })
          .from(tables.resolutions)
          .where(inArray(tables.resolutions.id, resolutionHits.map((h) => h.id)))
      : [];

  // co-retrieval logging: pairs of articles appearing in the same top-k is the
  // strongest practical duplicate signal for the merge scanner
  if (articleHits.length >= 2) {
    await recordEvent(org.id, "user", user.id, "search_results", {
      query: q.slice(0, 200),
      articleIds: articleHits.slice(0, 5).map((h) => h.id),
    });
  }

  const orderOf = (hits: { id: string }[]) => Object.fromEntries(hits.map((h, i) => [h.id, i]));
  const ao = orderOf(articleHits);
  const ro = orderOf(requestHits);

  return c.json({
    articles: articleRows
      .sort((a, b) => (ao[a.id] ?? 99) - (bo(ao, b.id)))
      .map((a) => ({
        id: a.id,
        kb: `KB-${String(a.kbNumber).padStart(3, "0")}`,
        title: a.revId ? (revById[a.revId]?.title ?? "") : "",
        summary: a.revId ? (revById[a.revId]?.summary ?? "") : "",
        helpfulCount: a.helpfulCount,
        notHelpfulCount: a.notHelpfulCount,
      })),
    requests: requestRows
      .sort((a, b) => (ro[a.id] ?? 99) - (bo(ro, b.id)))
      .map((r) => ({
        id: r.id,
        ref: `REQ-${r.refNumber}`,
        title: r.title,
        status: r.status,
        solvedAt: r.solvedAt,
        createdAt: r.createdAt,
      })),
    resolutions: resolutionRows.map((r) => ({
      id: r.id,
      requestId: r.requestId,
      summary: r.structuredSummary ?? r.rawCaptureText.slice(0, 200),
      createdAt: r.createdAt,
    })),
  });
});

function bo(order: Record<string, number>, id: string): number {
  return order[id] ?? 99;
}
