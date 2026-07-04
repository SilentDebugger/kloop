import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { getLlmProvider, extractJson } from "../providers/llm/index.js";
import { addRevision, blocksForRevision, type BlockInput } from "./articles.js";
import { recordEvent } from "../lib/events.js";
import { notifySupportersOfReviewItem } from "./reviewNotify.js";
import { logger } from "../lib/logger.js";

const FRESHNESS_HALF_LIFE_DAYS = 180;
const STALE_THRESHOLD = 0.45;
const CONTRADICTION_SIMILARITY_CEILING = 0.55; // resolution vs doc'd steps below this = disagreement

/**
 * Freshness & contradiction scan (daily cron):
 *  1. decay freshness scores; flag stale articles for review
 *  2. detect resolutions that solved requests matched to an article but with
 *     different steps -> LLM update proposal into the review inbox
 *  3. recompute confidence from usage signals
 */
export async function freshnessScan(orgId: string): Promise<{ staleFlagged: number; updatesProposed: number }> {
  let staleFlagged = 0;

  const articles = await db
    .select()
    .from(tables.articles)
    .where(and(eq(tables.articles.orgId, orgId), eq(tables.articles.status, "published")));

  for (const article of articles) {
    const ageDays = (Date.now() - article.updatedAt.getTime()) / 86_400_000;
    const freshness = Math.exp((-Math.LN2 * ageDays) / FRESHNESS_HALF_LIFE_DAYS);

    // confidence: recency + votes + solve usage
    const votes = article.helpfulCount + article.notHelpfulCount;
    const voteScore = votes === 0 ? 0.5 : article.helpfulCount / votes;
    const usageScore = Math.min(1, article.solveCount / 10);
    const confidence = Math.max(0.05, Math.min(1, 0.4 * voteScore + 0.3 * freshness + 0.3 * usageScore));

    const shouldFlag = freshness < STALE_THRESHOLD && !article.staleFlag;
    await db
      .update(tables.articles)
      .set({
        freshnessScore: freshness,
        confidence,
        ...(shouldFlag ? { staleFlag: true, staleReason: `No confirmations in ${Math.round(ageDays)} days` } : {}),
      })
      .where(eq(tables.articles.id, article.id));

    if (shouldFlag) {
      const pending = await db.query.reviewItems.findFirst({
        where: and(
          eq(tables.reviewItems.orgId, orgId),
          eq(tables.reviewItems.articleId, article.id),
          eq(tables.reviewItems.kind, "stale"),
          eq(tables.reviewItems.status, "pending"),
        ),
      });
      if (!pending) {
        const [item] = await db
          .insert(tables.reviewItems)
          .values({
            orgId,
            kind: "stale",
            articleId: article.id,
            revisionId: article.currentRevisionId,
            confidence: freshness,
            context: `Flagged stale — last verified ${Math.round(ageDays)} days ago`,
          })
          .returning();
        await notifySupportersOfReviewItem(orgId, `Article may be stale (KB-${String(article.kbNumber).padStart(3, "0")})`, item.id);
        staleFlagged++;
      }
    }
  }

  const updatesProposed = await contradictionScan(orgId);
  return { staleFlagged, updatesProposed };
}

/**
 * Contradiction: a fresh resolution linked to an article (same problem) whose
 * steps disagree with the documented resolution -> update proposal.
 */
async function contradictionScan(orgId: string): Promise<number> {
  const recent = await db
    .select()
    .from(tables.resolutions)
    .where(
      and(
        eq(tables.resolutions.orgId, orgId),
        isNotNull(tables.resolutions.articleId),
        eq(tables.resolutions.embeddingStatus, "ok"),
        gt(tables.resolutions.createdAt, sql`now() - interval '2 days'`),
      ),
    )
    .limit(50);

  let proposed = 0;
  for (const resolution of recent) {
    const articleId = resolution.articleId!;
    const article = await db.query.articles.findFirst({
      where: and(eq(tables.articles.id, articleId), eq(tables.articles.status, "published")),
    });
    if (!article?.currentRevisionId) continue;

    // similarity between this resolution and the article's documented steps
    const res = await db.execute(sql`
      select max(1 - (ab.embedding <=> ${`[${(resolution.embedding as number[]).join(",")}]`}::vector)) as sim
      from article_blocks ab
      where ab.article_id = ${articleId} and ab.revision_id = ${article.currentRevisionId}
        and ab.kind = 'resolution' and ab.embedding is not null
    `);
    const sim = Number((res.rows[0] as Record<string, unknown>)?.sim ?? 1);
    if (sim >= CONTRADICTION_SIMILARITY_CEILING) continue; // agrees well enough

    // don't stack proposals
    const pending = await db.query.reviewItems.findFirst({
      where: and(
        eq(tables.reviewItems.orgId, orgId),
        eq(tables.reviewItems.articleId, articleId),
        eq(tables.reviewItems.kind, "update"),
        eq(tables.reviewItems.status, "pending"),
      ),
    });
    if (pending) continue;

    const currentRev = await db.query.articleRevisions.findFirst({
      where: eq(tables.articleRevisions.id, article.currentRevisionId),
    });
    if (!currentRev) continue;
    const blocks = await blocksForRevision(currentRev.id);

    type UpdateJson = {
      blocks: { kind: string; contentMd: string; conditionText?: string | null }[];
      rationale: string;
      confidence: number;
    };
    let update: UpdateJson;
    try {
      const raw = await getLlmProvider().complete({
        system:
          "A recent helpdesk resolution disagrees with a knowledge-base article's documented steps. Propose an updated article. Output strict JSON: " +
          '{"blocks": [{"kind": "symptoms"|"environment"|"resolution"|"notes", "contentMd": string, "conditionText": string|null}], "rationale": string, "confidence": number 0-1}. ' +
          "Prefer updating steps over deleting; if both fixes may be valid, keep both as conditioned branches. Never invent steps.",
        prompt: JSON.stringify({
          article: { title: currentRev.title, blocks: blocks.map((b) => ({ kind: b.kind, contentMd: b.contentMd })) },
          newResolution: resolution.structuredSummary ?? resolution.rawCaptureText.slice(0, 1500),
        }),
        json: true,
        orgId: article.orgId,
        task: "update_proposal",
        data: {
          blocks: blocks.map((b) => ({ kind: b.kind, contentMd: b.contentMd })),
          resolutionSummary: resolution.structuredSummary ?? resolution.rawCaptureText.slice(0, 300),
        },
      });
      update = extractJson<UpdateJson>(raw);
    } catch (err) {
      logger.warn("update proposal failed", { articleId, err: String(err) });
      continue;
    }

    const validKinds = new Set(["symptoms", "environment", "resolution", "notes"]);
    const newBlocks: BlockInput[] = (update.blocks ?? [])
      .filter((b) => validKinds.has(b.kind) && b.contentMd?.trim())
      .map((b) => ({
        kind: b.kind as BlockInput["kind"],
        contentMd: b.contentMd,
        conditionText: b.conditionText ?? null,
        sources: [{ kind: "resolution", id: resolution.id }],
      }));
    if (newBlocks.length === 0) continue;

    const revision = await addRevision({
      orgId,
      articleId,
      title: currentRev.title,
      summary: currentRev.summary,
      blocks: newBlocks,
      createdByKind: "ai",
      parentRevisionId: currentRev.id,
      changeNote: update.rationale?.slice(0, 300) ?? "update proposed from recent resolution",
      setCurrent: false, // waits for review
    });

    const [item] = await db
      .insert(tables.reviewItems)
      .values({
        orgId,
        kind: "update",
        articleId,
        revisionId: revision.id,
        confidence: update.confidence ?? 0.5,
        context: `Recent resolution disagrees · ${update.rationale?.slice(0, 80) ?? ""}`,
      })
      .returning();

    await recordEvent(orgId, "ai", null, "article_update_proposed", {
      articleId,
      resolutionId: resolution.id,
      reviewItemId: item.id,
      similarity: sim,
    });
    await notifySupportersOfReviewItem(orgId, `Update proposal: ${currentRev.title.slice(0, 60)}`, item.id);
    proposed++;
  }
  return proposed;
}
