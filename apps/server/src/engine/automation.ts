import { eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { orgSettings } from "../http/context.js";
import { getLlmProvider, extractJson } from "../providers/llm/index.js";
import { searchArticles } from "../search/hybrid.js";
import { blocksForRevision } from "./articles.js";
import { precedentsFor } from "./precedents.js";
import { recordEvent } from "../lib/events.js";
import { notifyUser } from "../lib/notify.js";
import { bus } from "../realtime/bus.js";
import { logger } from "../lib/logger.js";

/**
 * Automation tiers (org-wide + per-tag overrides):
 *   0 — suggestions only
 *   1 — AI drafts replies, supporter reviews & sends
 *   2 — auto-answer recurring issues, escalate on "didn't help"
 *   3 — auto-answer + auto-close on user confirmation
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
 * article matches; anything else stays in the human queue.
 */
export async function tryAutoAnswer(requestId: string): Promise<boolean> {
  const request = await db.query.requests.findFirst({ where: eq(tables.requests.id, requestId) });
  // no author = guest request logged by a supporter — nobody to auto-answer
  if (!request || !request.authorId || request.status !== "open" || request.claimedBy || request.autoAnswered) return false;
  const authorId = request.authorId;

  const org = await db.query.orgs.findFirst({ where: eq(tables.orgs.id, request.orgId) });
  if (!org) return false;
  const tier = effectiveTier(org, request.tags);
  if (tier < 2) return false;

  const s = orgSettings(org);
  const hits = await searchArticles(request.orgId, `${request.title}\n${request.body}`, {
    vec: (request.embedding as number[] | null) ?? undefined,
    limit: 1,
  });
  const best = hits[0];
  if (!best?.similarity || best.similarity < s.autoAnswerConfidence) return false;

  const art = await articleSteps(best.id);
  if (!art || art.steps.length === 0) return false;

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
    return false;
  }
  if (!body?.trim()) return false;

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
  return true;
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

  const bestArticle = precedents.matchedArticles[0] ?? null;
  const art = bestArticle ? await articleSteps(bestArticle.id) : null;
  const precedentSummary = precedents.similarSolved[0]?.resolution?.summary ?? null;

  try {
    const raw = await getLlmProvider().complete({
      system:
        "Draft a reply from a support agent. Use ONLY the provided article steps and precedent; if neither exists, write a brief acknowledgement asking a clarifying question. Friendly, concise, no signature. " +
        'Output strict JSON: {"body": string}.',
      prompt: JSON.stringify({
        request: { title: request.title, body: request.body.slice(0, 800) },
        requesterName: author?.name ?? "there",
        article: art,
        precedent: precedentSummary,
      }),
      json: true,
      orgId: request.orgId,
      task: "reply_draft",
      data: {
        requesterName: author?.name ?? "there",
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
