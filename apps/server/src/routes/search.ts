import { Hono } from "hono";
import { inArray, eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { requireAuth } from "../http/middleware.js";
import type { AppEnv } from "../http/context.js";
import { multimodalQuery, relevantHits, searchArticles, searchAllRequests, searchResolutions, searchMessages } from "../search/hybrid.js";
import { recordEvent } from "../lib/events.js";

export const searchRoutes = new Hono<AppEnv>();
searchRoutes.use("*", requireAuth());

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Global hybrid search: articles + requests + chat messages (+ resolutions for
 * supporters). The query can be text, uploaded photos/voice notes (`att`
 * param), or both — media joins via OCR/transcript text and multimodal
 * vectors. Requesters only see published articles and their own requests.
 */
searchRoutes.get("/", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const q = (c.req.query("q") ?? "").trim();
  const attachmentIds = (c.req.query("att") ?? "")
    .split(",")
    .filter((id) => UUID_RE.test(id))
    .slice(0, 10);

  const empty = { articles: [], requests: [], messages: [], resolutions: [], pendingAttachments: 0 };
  if (!q && attachmentIds.length === 0) return c.json(empty);

  const isSupporter = user.role !== "requester";
  const { queryText, vec, pendingAttachments } = await multimodalQuery(org.id, q, {
    attachmentIds,
    userId: user.id,
  });
  if (!queryText && !vec) return c.json({ ...empty, pendingAttachments });

  // relevantHits drops vector-only strays (KNN always returns *something*) so
  // sections stay clean; keyword matches always survive
  const [articleHits, requestHits, messageHits, resolutionHits] = await Promise.all([
    searchArticles(org.id, queryText, { vec, limit: 8 }).then(relevantHits),
    searchAllRequests(org.id, queryText, { vec, limit: 8 }).then(relevantHits),
    searchMessages(org.id, queryText, { vec, limit: 8 }).then(relevantHits),
    isSupporter ? searchResolutions(org.id, queryText, { vec, limit: 5 }).then(relevantHits) : Promise.resolve([]),
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

  // hydrate chat messages with their requests; requesters only see plain
  // messages on their own threads (no internal notes, no other people's chats)
  let messageRows: { id: string; requestId: string; kind: string; body: string; createdAt: Date }[] = [];
  let messageReqById: Record<string, { refNumber: number; title: string }> = {};
  let mediaLabelByMsg: Record<string, string> = {};
  if (messageHits.length > 0) {
    const rows = await db
      .select({
        id: tables.messages.id,
        requestId: tables.messages.requestId,
        kind: tables.messages.kind,
        body: tables.messages.body,
        createdAt: tables.messages.createdAt,
      })
      .from(tables.messages)
      .where(inArray(tables.messages.id, messageHits.map((h) => h.id)));
    const reqs =
      rows.length > 0
        ? await db
            .select({ id: tables.requests.id, refNumber: tables.requests.refNumber, title: tables.requests.title, authorId: tables.requests.authorId })
            .from(tables.requests)
            .where(inArray(tables.requests.id, [...new Set(rows.map((r) => r.requestId))]))
        : [];
    const reqById = Object.fromEntries(reqs.map((r) => [r.id, r]));
    messageRows = rows.filter((m) => {
      const req = reqById[m.requestId];
      if (!req) return false;
      return isSupporter || (m.kind === "message" && req.authorId === user.id);
    });
    messageReqById = Object.fromEntries(reqs.map((r) => [r.id, { refNumber: r.refNumber, title: r.title }]));

    // media-only messages have no body — label them by what they carry
    const bodyless = messageRows.filter((m) => !m.body.trim()).map((m) => m.id);
    if (bodyless.length > 0) {
      const media = await db
        .select({ ownerId: tables.attachments.ownerId, kind: tables.attachments.kind })
        .from(tables.attachments)
        .where(and(eq(tables.attachments.ownerKind, "message"), inArray(tables.attachments.ownerId, bodyless)));
      for (const a of media) {
        const label = a.kind === "image" ? "Photo" : a.kind === "audio" ? "Voice note" : "Attachment";
        mediaLabelByMsg[a.ownerId] = mediaLabelByMsg[a.ownerId] ? `${mediaLabelByMsg[a.ownerId]} + ${label}` : label;
      }
    }
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
      query: queryText.slice(0, 200),
      articleIds: articleHits.slice(0, 5).map((h) => h.id),
    });
  }

  const orderOf = (hits: { id: string }[]) => Object.fromEntries(hits.map((h, i) => [h.id, i]));
  const ao = orderOf(articleHits);
  const ro = orderOf(requestHits);
  const mo = orderOf(messageHits);

  return c.json({
    articles: articleRows
      .sort((a, b) => bo(ao, a.id) - bo(ao, b.id))
      .map((a) => ({
        id: a.id,
        kb: `KB-${String(a.kbNumber).padStart(3, "0")}`,
        title: a.revId ? (revById[a.revId]?.title ?? "") : "",
        summary: a.revId ? (revById[a.revId]?.summary ?? "") : "",
        helpfulCount: a.helpfulCount,
        notHelpfulCount: a.notHelpfulCount,
      })),
    requests: requestRows
      .sort((a, b) => bo(ro, a.id) - bo(ro, b.id))
      .map((r) => ({
        id: r.id,
        ref: `REQ-${r.refNumber}`,
        title: r.title,
        status: r.status,
        solvedAt: r.solvedAt,
        createdAt: r.createdAt,
      })),
    messages: messageRows
      .sort((a, b) => bo(mo, a.id) - bo(mo, b.id))
      .map((m) => ({
        id: m.id,
        requestId: m.requestId,
        ref: `REQ-${messageReqById[m.requestId]?.refNumber ?? "?"}`,
        requestTitle: messageReqById[m.requestId]?.title ?? "",
        internal: m.kind === "internal_note",
        snippet: m.body.trim() ? m.body.slice(0, 180) : (mediaLabelByMsg[m.id] ?? "Attachment"),
        createdAt: m.createdAt,
      })),
    resolutions: resolutionRows.map((r) => ({
      id: r.id,
      requestId: r.requestId,
      summary: r.structuredSummary ?? r.rawCaptureText.slice(0, 200),
      createdAt: r.createdAt,
    })),
    pendingAttachments,
  });
});

function bo(order: Record<string, number>, id: string): number {
  return order[id] ?? 99;
}
