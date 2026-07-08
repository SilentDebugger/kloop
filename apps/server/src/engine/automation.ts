import { and, asc, eq, isNull, lt } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { orgSettings } from "../http/context.js";
import { getLlmProvider, extractJson } from "../providers/llm/index.js";
import { searchArticles } from "../search/hybrid.js";
import { blocksForRevision } from "./articles.js";
import { precedentsFor } from "./precedents.js";
import { recordEvent } from "../lib/events.js";
import { notifyUser } from "../lib/notify.js";
import { addSystemMessage } from "../lib/thread.js";
import { bus } from "../realtime/bus.js";
import { logger } from "../lib/logger.js";

/**
 * Automation tiers (org-wide + per-tag overrides):
 *   0 — suggestions only
 *   1 — AI drafts replies, supporter reviews & sends
 *   2 — auto-answer recurring issues, escalate on "didn't help"
 *   3 — tier 2 + auto-close auto-answered requests after silence
 * The tier for a request = max restriction wins: min(orgTier, tagOverride).
 */
export function effectiveTier(org: typeof tables.orgs.$inferSelect, tags: string[]): number {
  const s = orgSettings(org);
  let tier = s.automationTier;
  for (const tag of tags) {
    const override = s.tagTierOverrides[tag];
    if (override !== undefined) tier = Math.min(tier, override);
  }
  return tier;
}

/** Current title of an article (for observability payloads). */
async function articleTitle(articleId: string): Promise<string | null> {
  const article = await db.query.articles.findFirst({ where: eq(tables.articles.id, articleId) });
  if (!article?.currentRevisionId) return null;
  const rev = await db.query.articleRevisions.findFirst({
    where: eq(tables.articleRevisions.id, article.currentRevisionId),
    columns: { title: true },
  });
  return rev?.title ?? null;
}

/** Steps text of an article's resolution blocks — for drafts and auto-answers. */
async function articleSteps(articleId: string): Promise<{ title: string; steps: string[] } | null> {
  const article = await db.query.articles.findFirst({ where: eq(tables.articles.id, articleId) });
  if (!article?.currentRevisionId) return null;
  const rev = await db.query.articleRevisions.findFirst({
    where: eq(tables.articleRevisions.id, article.currentRevisionId),
  });
  if (!rev) return null;
  const blocks = await blocksForRevision(rev.id);
  const steps = blocks
    .filter((b) => b.kind === "resolution")
    .flatMap((b) => b.contentMd.split("\n"))
    .map((s) => s.replace(/^\s*[\d.)-]+\s*/, "").trim())
    .filter(Boolean);
  return { title: rev.title, steps };
}

/**
 * Tier 2/3 auto-answer: called shortly after request creation (queued with a
 * delay so the embedding pipeline has landed). Only fires on high-confidence
 * article matches; anything else stays in the human queue. Every meaningful
 * decline records an auto_answer_skipped event so supporters can see WHY the
 * AI stayed out of a thread.
 */
export async function tryAutoAnswer(requestId: string): Promise<boolean> {
  const request = await db.query.requests.findFirst({ where: eq(tables.requests.id, requestId) });
  // no author = guest request logged by a supporter — nobody to auto-answer
  if (!request || !request.authorId || request.status !== "open" || request.claimedBy || request.autoAnswered) return false;
  const authorId = request.authorId;

  const org = await db.query.orgs.findFirst({ where: eq(tables.orgs.id, request.orgId) });
  if (!org) return false;

  const skip = (reason: string, extra: Record<string, unknown> = {}) =>
    recordEvent(request.orgId, "ai", null, "auto_answer_skipped", { requestId: request.id, reason, ...extra }).then(() => false);

  const s = orgSettings(org);
  const tier = effectiveTier(org, request.tags);
  if (tier < 2) {
    // only interesting when auto-answer is on org-wide but a tag override held it back
    if (s.automationTier >= 2) return skip("tag_tier_override", { tier, orgTier: s.automationTier, tags: request.tags });
    return false;
  }

  const hits = await searchArticles(request.orgId, `${request.title}\n${request.body}`, {
    vec: (request.embedding as number[] | null) ?? undefined,
    limit: 1,
  });
  const best = hits[0];
  if (!best) return skip("no_article_match", { threshold: s.autoAnswerConfidence });
  if (!best.similarity || best.similarity < s.autoAnswerConfidence) {
    return skip("below_confidence", {
      similarity: best.similarity ?? 0,
      threshold: s.autoAnswerConfidence,
      articleId: best.id,
      articleTitle: await articleTitle(best.id),
    });
  }

  const art = await articleSteps(best.id);
  if (!art || art.steps.length === 0) {
    return skip("article_has_no_steps", { articleId: best.id, articleTitle: await articleTitle(best.id), similarity: best.similarity });
  }

  let body: string;
  try {
    const raw = await getLlmProvider().complete({
      system:
        'Write a short, friendly auto-answer for a helpdesk request using ONLY the documented steps provided. End by asking the user to confirm whether it solved the problem. Output strict JSON: {"body": string}.',
      prompt: JSON.stringify({ request: { title: request.title, body: request.body.slice(0, 500) }, article: art }),
      json: true,
      orgId: request.orgId,
      task: "auto_answer",
      data: { articleTitle: art.title, articleSteps: art.steps },
    });
    body = extractJson<{ body: string }>(raw).body;
  } catch (err) {
    logger.warn("auto-answer generation failed", { requestId, err: String(err) });
    return skip("generation_failed", { articleId: best.id, articleTitle: art.title, similarity: best.similarity });
  }
  if (!body?.trim()) return skip("generation_failed", { articleId: best.id, articleTitle: art.title, similarity: best.similarity });

  const [message] = await db
    .insert(tables.messages)
    .values({
      orgId: request.orgId,
      requestId: request.id,
      authorId: null,
      kind: "auto_answer",
      body,
      articleId: best.id,
    })
    .returning();

  await db
    .update(tables.requests)
    .set({
      status: "handled",
      autoAnswered: true,
      confirmationState: "pending",
      unreadForRequester: true,
      unreadForSupporter: false,
      lastActivityAt: new Date(),
    })
    .where(eq(tables.requests.id, request.id));

  // make the AI takeover explicit in the thread — requesters shouldn't have
  // to infer from the bubble's meta line that no human has seen this yet
  await addSystemMessage(
    request.orgId,
    request.id,
    "kloop answered this automatically. If it doesn't fix it, the support team takes over.",
  );

  await recordEvent(request.orgId, "ai", null, "auto_answer_sent", {
    requestId: request.id,
    articleId: best.id,
    similarity: best.similarity,
    tier,
  });
  await notifyUser({
    orgId: request.orgId,
    userId: authorId,
    type: "reply",
    title: `Suggested fix for: ${request.title.slice(0, 60)}`,
    body: body.slice(0, 140),
    linkPath: `/requests/${request.id}`,
  });
  bus.publish(request.orgId, {
    type: "message_created",
    data: {
      requestId: request.id,
      message: { id: message.id, kind: "auto_answer", body, author: null, createdAt: message.createdAt },
    },
  });
  // queues re-render the moment AI takes a request over
  bus.publish(request.orgId, { type: "request_updated", data: { id: request.id, autoAnswered: true } });
  return true;
}

/**
 * Tier 3 sweep (hourly): auto-answered requests where the requester never
 * replied. After the reopen-grace window of silence the answer is assumed to
 * have worked and the request auto-closes. Silence is a weak signal, so the
 * linked resolution is NOT marked trusted, and the requester can still reopen.
 */
export async function autoCloseScan(orgId: string): Promise<number> {
  const org = await db.query.orgs.findFirst({ where: eq(tables.orgs.id, orgId) });
  if (!org) return 0;
  const s = orgSettings(org);
  // tag overrides can only lower the tier, so org tier < 3 means nothing qualifies
  if (s.automationTier < 3) return 0;

  const cutoff = new Date(Date.now() - s.reopenGraceDays * 24 * 3600 * 1000);
  const stale = await db
    .select()
    .from(tables.requests)
    .where(
      and(
        eq(tables.requests.orgId, orgId),
        eq(tables.requests.status, "handled"),
        eq(tables.requests.autoAnswered, true),
        eq(tables.requests.confirmationState, "pending"),
        isNull(tables.requests.claimedBy),
        lt(tables.requests.lastActivityAt, cutoff),
      ),
    );

  let closed = 0;
  for (const request of stale) {
    if (effectiveTier(org, request.tags) < 3) continue;

    await db
      .update(tables.requests)
      .set({ status: "solved", solvedAt: new Date(), confirmationState: "none", lastActivityAt: new Date() })
      .where(eq(tables.requests.id, request.id));

    const [message] = await db
      .insert(tables.messages)
      .values({
        orgId,
        requestId: request.id,
        kind: "system",
        body: `Closed automatically after ${s.reopenGraceDays} days without a reply. Reopen it if the problem persists.`,
      })
      .returning();
    bus.publish(orgId, {
      type: "message_created",
      data: { requestId: request.id, message: { id: message.id, kind: "system", body: message.body, author: null, createdAt: message.createdAt } },
    });

    await recordEvent(orgId, "ai", null, "auto_closed", {
      requestId: request.id,
      graceDays: s.reopenGraceDays,
      tier: 3,
    });
    if (request.authorId) {
      await notifyUser({
        orgId,
        userId: request.authorId,
        type: "status_change",
        title: `Closed: ${request.title.slice(0, 60)}`,
        body: "We didn't hear back after the suggested fix — reopen the request if you still need help.",
        linkPath: `/requests/${request.id}`,
      });
    }
    bus.publish(orgId, { type: "request_updated", data: { id: request.id, status: "solved" } });
    closed++;
  }
  if (closed > 0) logger.info("auto-close sweep", { orgId, closed });
  return closed;
}

/**
 * Tier 1+: AI-drafted reply for the workbench. Grounded in the best article
 * match and this org's precedents — never invented from thin air.
 */
export async function draftReply(request: typeof tables.requests.$inferSelect): Promise<{
  body: string;
  groundedIn: { articleId: string | null; articleTitle: string | null };
} | null> {
  const org = await db.query.orgs.findFirst({ where: eq(tables.orgs.id, request.orgId) });
  if (!org) return null;
  if (effectiveTier(org, request.tags) < 1) return null;

  const author = request.authorId
    ? await db.query.users.findFirst({ where: eq(tables.users.id, request.authorId) })
    : undefined;
  const precedents = await precedentsFor(request);

  // The conversation so far, so redrafts pick up where the thread actually is.
  const history = await db.query.messages.findMany({
    where: eq(tables.messages.requestId, request.id),
    orderBy: [asc(tables.messages.createdAt)],
  });
  const conversation = history.slice(-12).map((m) => ({
    from:
      m.kind === "auto_answer" ? "ai" : m.kind === "system" ? "system" : m.authorId === request.authorId ? "requester" : "supporter",
    ...(m.kind === "internal_note" ? { internalNote: true } : {}),
    text: m.body.trim().slice(0, 500) || "[attachment]",
  }));

  const bestArticle = precedents.matchedArticles[0] ?? null;
  const art = bestArticle ? await articleSteps(bestArticle.id) : null;
  const precedentSummary = precedents.similarSolved[0]?.resolution?.summary ?? null;

  try {
    const raw = await getLlmProvider().complete({
      system:
        "Draft the NEXT reply from the support agent, continuing the conversation provided. Use ONLY the provided article steps and precedent for technical instructions; if neither exists, write a brief acknowledgement asking a clarifying question. " +
        "Don't repeat steps the conversation shows were already tried. Internal notes are supporter-only context the requester never saw. Friendly, concise, no signature. " +
        'Output strict JSON: {"body": string}.',
      prompt: JSON.stringify({
        request: { title: request.title, body: request.body.slice(0, 800) },
        requesterName: author?.name ?? "there",
        conversation,
        article: art,
        precedent: precedentSummary,
      }),
      json: true,
      orgId: request.orgId,
      task: "reply_draft",
      data: {
        requesterName: author?.name ?? "there",
        conversation,
        articleTitle: art?.title ?? null,
        articleSteps: art?.steps ?? [],
        precedentSummary,
      },
    });
    const { body } = extractJson<{ body: string }>(raw);
    if (!body?.trim()) return null;
    return {
      body,
      groundedIn: { articleId: bestArticle?.id ?? null, articleTitle: art?.title ?? null },
    };
  } catch (err) {
    logger.warn("reply draft failed", { requestId: request.id, err: String(err) });
    return null;
  }
}
