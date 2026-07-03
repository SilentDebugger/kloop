import { eq, inArray, desc, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { searchArticles, searchSolvedRequests } from "../search/hybrid.js";

export type Precedents = {
  similarSolved: {
    id: string;
    ref: string;
    title: string;
    solvedAt: Date | null;
    resolution: { id: string; summary: string; supporterName: string | null; articleId: string | null } | null;
  }[];
  matchedArticles: { id: string; kb: string; title: string; summary: string }[];
};

/**
 * Supporter precedents: "3 similar past requests, here's what worked" —
 * computed from the request's own embedding, shown before the ticket is opened.
 */
export async function precedentsFor(request: typeof tables.requests.$inferSelect): Promise<Precedents> {
  const queryText = `${request.title}\n${request.body}`;
  const vec = (request.embedding as number[] | null) ?? undefined;

  const [solvedHits, articleHits] = await Promise.all([
    searchSolvedRequests(request.orgId, queryText, { vec, limit: 3, excludeId: request.id }),
    searchArticles(request.orgId, queryText, { vec, limit: 2 }),
  ]);

  const solvedRows =
    solvedHits.length > 0
      ? await db.select().from(tables.requests).where(inArray(tables.requests.id, solvedHits.map((h) => h.id)))
      : [];

  const resolutions =
    solvedRows.length > 0
      ? await db
          .select()
          .from(tables.resolutions)
          .where(inArray(tables.resolutions.requestId, solvedRows.map((r) => r.id)))
          .orderBy(desc(tables.resolutions.createdAt))
      : [];

  const supporterIds = [...new Set(resolutions.map((r) => r.supporterId))];
  const supporters =
    supporterIds.length > 0
      ? await db
          .select({ id: tables.users.id, name: tables.users.name })
          .from(tables.users)
          .where(inArray(tables.users.id, supporterIds))
      : [];
  const supporterById = Object.fromEntries(supporters.map((s) => [s.id, s.name]));

  const articleRows =
    articleHits.length > 0
      ? await db
          .select({
            id: tables.articles.id,
            kbNumber: tables.articles.kbNumber,
            revId: tables.articles.currentRevisionId,
          })
          .from(tables.articles)
          .where(and(inArray(tables.articles.id, articleHits.map((h) => h.id)), eq(tables.articles.status, "published")))
      : [];
  const revs =
    articleRows.length > 0
      ? await db
          .select({ id: tables.articleRevisions.id, title: tables.articleRevisions.title, summary: tables.articleRevisions.summary })
          .from(tables.articleRevisions)
          .where(inArray(tables.articleRevisions.id, articleRows.map((a) => a.revId).filter(Boolean) as string[]))
      : [];
  const revById = Object.fromEntries(revs.map((r) => [r.id, r]));

  return {
    similarSolved: solvedHits
      .map((hit) => {
        const row = solvedRows.find((r) => r.id === hit.id);
        if (!row) return null;
        const res = resolutions.find((r) => r.requestId === row.id) ?? null;
        return {
          id: row.id,
          ref: `REQ-${row.refNumber}`,
          title: row.title,
          solvedAt: row.solvedAt,
          resolution: res
            ? {
                id: res.id,
                summary: res.structuredSummary ?? res.rawCaptureText.slice(0, 240),
                supporterName: supporterById[res.supporterId] ?? null,
                articleId: res.articleId,
              }
            : null,
        };
      })
      .filter(Boolean) as Precedents["similarSolved"],
    matchedArticles: articleRows
      .filter((a) => a.revId && revById[a.revId])
      .map((a) => ({
        id: a.id,
        kb: `KB-${String(a.kbNumber).padStart(3, "0")}`,
        title: revById[a.revId!].title,
        summary: revById[a.revId!].summary,
      })),
  };
}
