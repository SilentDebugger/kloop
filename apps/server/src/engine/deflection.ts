import { inArray } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { embedQuery, searchArticles, searchSolvedRequests } from "../search/hybrid.js";

export type DeflectionSuggestion =
  | {
      kind: "article";
      id: string;
      kb: string;
      title: string;
      summary: string;
      helpfulPercent: number | null;
      score: number;
    }
  | {
      kind: "solved_request";
      id: string;
      ref: string;
      title: string;
      solvedAt: Date | null;
      resolutionMinutes: number | null;
      score: number;
    };

/**
 * Live deflection: as the requester types, suggest published articles and
 * recently solved requests. "If a doc answers it, the request never becomes work."
 */
export async function deflect(orgId: string, text: string, limit = 4): Promise<DeflectionSuggestion[]> {
  const vec = await embedQuery(text);
  const [articleHits, solvedHits] = await Promise.all([
    searchArticles(orgId, text, { vec, limit }),
    searchSolvedRequests(orgId, text, { vec, limit: 2 }),
  ]);

  const suggestions: DeflectionSuggestion[] = [];

  if (articleHits.length > 0) {
    const rows = await db
      .select({
        id: tables.articles.id,
        kbNumber: tables.articles.kbNumber,
        helpful: tables.articles.helpfulCount,
        notHelpful: tables.articles.notHelpfulCount,
        revId: tables.articles.currentRevisionId,
      })
      .from(tables.articles)
      .where(inArray(tables.articles.id, articleHits.map((h) => h.id)));
    const revIds = rows.map((r) => r.revId).filter(Boolean) as string[];
    const revs =
      revIds.length > 0
        ? await db
            .select({ id: tables.articleRevisions.id, title: tables.articleRevisions.title, summary: tables.articleRevisions.summary })
            .from(tables.articleRevisions)
            .where(inArray(tables.articleRevisions.id, revIds))
        : [];
    const revById = Object.fromEntries(revs.map((r) => [r.id, r]));
    for (const hit of articleHits) {
      const row = rows.find((r) => r.id === hit.id);
      if (!row?.revId || !revById[row.revId]) continue;
      const votes = row.helpful + row.notHelpful;
      suggestions.push({
        kind: "article",
        id: row.id,
        kb: `KB-${String(row.kbNumber).padStart(3, "0")}`,
        title: revById[row.revId].title,
        summary: revById[row.revId].summary,
        helpfulPercent: votes >= 3 ? Math.round((row.helpful / votes) * 100) : null,
        score: hit.score,
      });
    }
  }

  if (solvedHits.length > 0) {
    const rows = await db
      .select()
      .from(tables.requests)
      .where(inArray(tables.requests.id, solvedHits.map((h) => h.id)));
    for (const hit of solvedHits) {
      const row = rows.find((r) => r.id === hit.id);
      if (!row) continue;
      const minutes =
        row.solvedAt && row.createdAt
          ? Math.max(1, Math.round((row.solvedAt.getTime() - row.createdAt.getTime()) / 60_000))
          : null;
      suggestions.push({
        kind: "solved_request",
        id: row.id,
        ref: `REQ-${row.refNumber}`,
        title: row.title,
        solvedAt: row.solvedAt,
        resolutionMinutes: minutes,
        score: hit.score,
      });
    }
  }

  return suggestions.sort((a, b) => b.score - a.score).slice(0, limit + 1);
}
