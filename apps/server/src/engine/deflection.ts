import { inArray } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { multimodalQuery, relevantHits, searchArticles } from "../search/hybrid.js";

export type DeflectionSuggestion = {
  kind: "article";
  id: string;
  kb: string;
  title: string;
  summary: string;
  helpfulPercent: number | null;
  score: number;
};

export type DeflectionResult = {
  suggestions: DeflectionSuggestion[];
  /** attachments whose OCR/transcription/embedding hasn't landed yet — the client re-asks while > 0 */
  pendingAttachments: number;
};

/**
 * Live deflection: as the requester types, suggest published articles the
 * requester can open right away. "If a doc answers it, the request never
 * becomes work." Only articles are suggested — other people's solved requests
 * aren't viewable by the requester, so they'd be dead ends in the UI.
 *
 * Photos and voice notes join the query via multimodalQuery — a photo of an
 * error screen deflects on its own.
 */
export async function deflect(
  orgId: string,
  text: string,
  opts: { attachmentIds?: string[]; userId?: string; limit?: number } = {},
): Promise<DeflectionResult> {
  const limit = opts.limit ?? 4;
  const { queryText, vec, pendingAttachments } = await multimodalQuery(orgId, text, {
    attachmentIds: opts.attachmentIds,
    userId: opts.userId,
    purpose: "deflection",
  });
  if (!queryText && !vec) return { suggestions: [], pendingAttachments };

  const articleHits = await searchArticles(orgId, queryText, { vec, limit }).then(relevantHits);

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

  return { suggestions: suggestions.sort((a, b) => b.score - a.score).slice(0, limit), pendingAttachments };
}
