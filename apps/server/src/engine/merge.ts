import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { getLlmProvider, extractJson } from "../providers/llm/index.js";
import { addRevision, blocksForRevision, type BlockInput } from "./articles.js";
import { recordEvent } from "../lib/events.js";
import { notifySupportersOfReviewItem } from "./reviewNotify.js";
import { enqueueEmbed } from "../workers/queues.js";
import { logger } from "../lib/logger.js";

/**
 * Article lifecycle §7: merge candidate detection (continuous, cheap vector
 * math), LLM merge proposals (expensive reasoning only on candidates), and
 * human-approved application with tombstones + full reversibility.
 */

const SUMMARY_PRUNE_THRESHOLD = 0.75;
const COMPOSITE_THRESHOLD = 0.62;
const REPROPOSAL_MARGIN = 0.12; // rejected pairs need this much more similarity to re-propose

export type Scores = {
  simSummary: number;
  simSymptoms: number;
  simResolution: number;
  clusterOverlap: number;
  coRetrieval: number;
  entityOverlap: number;
};

export function compositeScore(s: Scores): number {
  return (
    0.25 * s.simSummary +
    0.25 * s.simSymptoms +
    0.15 * s.simResolution +
    0.1 * s.clusterOverlap +
    0.15 * s.coRetrieval +
    0.1 * s.entityOverlap
  );
}

export function verdictOf(s: Scores): "merge" | "branch" | "crosslink" | "fork" {
  const sym = s.simSymptoms >= 0.72;
  const res = s.simResolution >= 0.72;
  if (sym && res) return "merge"; // duplicate
  if (sym && !res) return "branch"; // same problem, different fixes -> conditioned branches
  if (!sym && res) return "crosslink"; // different problems, same fix
  return "fork";
}

/** Pairwise block-kind similarity between two articles' current revisions (SQL, HNSW-assisted). */
async function blockKindSimilarity(articleA: string, articleB: string, kind: string): Promise<number> {
  const res = await db.execute(sql`
    select max(1 - (a.embedding <=> b.embedding)) as sim
    from article_blocks a
    join articles art_a on art_a.id = a.article_id and art_a.current_revision_id = a.revision_id
    join article_blocks b
      on b.article_id = ${articleB}
    join articles art_b on art_b.id = b.article_id and art_b.current_revision_id = b.revision_id
    where a.article_id = ${articleA}
      and a.kind = ${kind} and b.kind = ${kind}
      and a.embedding is not null and b.embedding is not null
  `);
  const sim = (res.rows[0] as Record<string, unknown>)?.sim;
  return sim == null ? 0 : Number(sim);
}

/** Jaccard overlap of the request clusters feeding both articles (via provenance). */
async function clusterOverlap(orgId: string, articleA: string, articleB: string): Promise<number> {
  const clustersOf = async (articleId: string): Promise<Set<string>> => {
    const res = await db.execute(sql`
      select distinct r.cluster_id
      from provenance p
      join article_blocks ab on ab.id = p.article_block_id
      left join resolutions res on p.source_kind = 'resolution' and res.id = p.source_id
      left join requests r on r.id = coalesce(res.request_id, case when p.source_kind = 'request' then p.source_id end)
      where ab.article_id = ${articleId} and r.cluster_id is not null and r.org_id = ${orgId}
    `);
    return new Set(res.rows.map((r) => String((r as Record<string, unknown>).cluster_id)));
  };
  const [a, b] = await Promise.all([clustersOf(articleA), clustersOf(articleB)]);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

/** Co-retrieval: how often both appear in the same top-k search results (logged usage). */
async function coRetrieval(orgId: string, articleA: string, articleB: string): Promise<number> {
  const res = await db.execute(sql`
    select
      count(*) filter (where payload->'articleIds' @> ${JSON.stringify([articleA, articleB])}::jsonb) as together,
      count(*) filter (where payload->'articleIds' @> ${JSON.stringify([articleA])}::jsonb
                    or payload->'articleIds' @> ${JSON.stringify([articleB])}::jsonb) as either
    from events
    where org_id = ${orgId} and type = 'search_results' and created_at > now() - interval '90 days'
  `);
  const row = res.rows[0] as Record<string, unknown>;
  const together = Number(row?.together ?? 0);
  const either = Number(row?.either ?? 0);
  return either === 0 ? 0 : together / either;
}

export function tagOverlap(tagsA: string[], tagsB: string[]): number {
  if (tagsA.length === 0 || tagsB.length === 0) return 0;
  const a = new Set(tagsA);
  const intersection = tagsB.filter((t) => a.has(t)).length;
  const union = new Set([...tagsA, ...tagsB]).size;
  return intersection / union;
}

/**
 * Continuous scan (cron): ANN-pruned article pairs -> composite scores ->
 * merge candidates -> LLM proposals -> review inbox.
 */
export async function scanForMergeCandidates(orgId: string): Promise<number> {
  // ANN prune: published article pairs whose summary vectors are close
  const pairs = await db.execute(sql`
    select a.id as a_id, b.id as b_id, 1 - (a.embedding <=> b.embedding) as sim
    from articles a
    join articles b on a.id < b.id and a.org_id = b.org_id
    where a.org_id = ${orgId}
      and a.status = 'published' and b.status = 'published'
      and a.embedding is not null and b.embedding is not null
      and 1 - (a.embedding <=> b.embedding) >= ${SUMMARY_PRUNE_THRESHOLD}
    limit 50
  `);

  let created = 0;
  for (const row of pairs.rows as Record<string, unknown>[]) {
    const aId = String(row.a_id);
    const bId = String(row.b_id);
    const simSummary = Number(row.sim);

    const existing = await db.query.mergeCandidates.findFirst({
      where: or(
        and(eq(tables.mergeCandidates.articleAId, aId), eq(tables.mergeCandidates.articleBId, bId)),
        and(eq(tables.mergeCandidates.articleAId, bId), eq(tables.mergeCandidates.articleBId, aId)),
      ),
    });
    if (existing) {
      // negative constraint: only re-propose if similarity rose significantly
      if (existing.status === "rejected" || existing.status === "suppressed") {
        const prev = (existing.scores as Scores | null)?.simSummary ?? 1;
        if (simSummary < prev + REPROPOSAL_MARGIN) continue;
      } else {
        continue; // proposed/approved already
      }
    }

    const [a, b] = await Promise.all([
      db.query.articles.findFirst({ where: eq(tables.articles.id, aId) }),
      db.query.articles.findFirst({ where: eq(tables.articles.id, bId) }),
    ]);
    if (!a || !b) continue;

    const [simSymptoms, simResolution, clusters, coRet] = await Promise.all([
      blockKindSimilarity(aId, bId, "symptoms"),
      blockKindSimilarity(aId, bId, "resolution"),
      clusterOverlap(orgId, aId, bId),
      coRetrieval(orgId, aId, bId),
    ]);
    const scores: Scores = {
      simSummary,
      simSymptoms,
      simResolution,
      clusterOverlap: clusters,
      coRetrieval: coRet,
      entityOverlap: tagOverlap(a.tags, b.tags),
    };
    const composite = compositeScore(scores);
    if (composite < COMPOSITE_THRESHOLD) continue;

    const verdict = verdictOf(scores);
    const values = {
      orgId,
      articleAId: aId,
      articleBId: bId,
      scores: scores as unknown as Record<string, number>,
      compositeScore: composite,
      status: "proposed" as const,
      verdict,
    };
    let candidateId: string;
    if (existing) {
      await db.update(tables.mergeCandidates).set(values).where(eq(tables.mergeCandidates.id, existing.id));
      candidateId = existing.id;
    } else {
      const [candidate] = await db.insert(tables.mergeCandidates).values(values).returning();
      candidateId = candidate.id;
    }

    // crosslink verdicts don't rewrite knowledge — surface as suppressed info, no LLM cost
    if (verdict === "crosslink") {
      await db
        .update(tables.mergeCandidates)
        .set({ status: "suppressed" })
        .where(eq(tables.mergeCandidates.id, candidateId));
      continue;
    }

    await proposeMerge(candidateId);
    created++;
  }
  return created;
}

type ProposalJson = {
  mergedTitle: string;
  mergedSummary: string;
  blocks: { kind: string; conditionText?: string | null; contentMd: string; origin?: string }[];
  diff: { op: string; blockKind: string; text: string; from?: string }[];
  rationale: string;
  confidence: number;
};

/** LLM proposes; the proposal (blocks + human-readable diff + rationale) lands in review. */
export async function proposeMerge(candidateId: string): Promise<void> {
  const candidate = await db.query.mergeCandidates.findFirst({
    where: eq(tables.mergeCandidates.id, candidateId),
  });
  if (!candidate) return;

  const load = async (articleId: string) => {
    const article = await db.query.articles.findFirst({ where: eq(tables.articles.id, articleId) });
    if (!article?.currentRevisionId) return null;
    const rev = await db.query.articleRevisions.findFirst({
      where: eq(tables.articleRevisions.id, article.currentRevisionId),
    });
    if (!rev) return null;
    const blocks = await blocksForRevision(rev.id);
    return { article, rev, blocks };
  };
  const [a, b] = await Promise.all([load(candidate.articleAId), load(candidate.articleBId)]);
  if (!a || !b) return;

  const asJson = (x: NonNullable<Awaited<ReturnType<typeof load>>>) => ({
    title: x.rev.title,
    summary: x.rev.summary,
    blocks: x.blocks.map((blk) => ({ kind: blk.kind, contentMd: blk.contentMd, conditionText: blk.conditionText })),
  });

  let proposal: ProposalJson;
  try {
    const raw = await getLlmProvider().complete({
      system:
        "You merge two overlapping knowledge-base articles into one. Output strict JSON: " +
        '{"mergedTitle": string, "mergedSummary": string, "blocks": [{"kind": "symptoms"|"environment"|"resolution"|"notes", "conditionText": string|null, "contentMd": string, "origin": "a"|"b"|"merged"}], ' +
        '"diff": [{"op": "kept"|"combined"|"conditioned"|"dropped", "blockKind": string, "text": string, "from": "a"|"b"|"both"}], ' +
        '"rationale": string (1-2 sentences, e.g. "both describe VPN timeout; B adds the macOS step; symptoms merged, resolutions branched on OS"), "confidence": number 0-1}. ' +
        `The detected verdict is "${candidate.verdict}": for "merge" combine everything; for "branch" merge symptoms but keep both resolutions as branches with conditionText describing when each applies; for "fork" produce a parent overview with scoped sections. Never invent steps.`,
      prompt: JSON.stringify({ articleA: asJson(a), articleB: asJson(b) }),
      json: true,
      task: "merge_proposal",
      data: { a: asJson(a), b: asJson(b) },
    });
    proposal = extractJson<ProposalJson>(raw);
  } catch (err) {
    logger.error("merge proposal failed", { candidateId, err: String(err) });
    return;
  }

  await db
    .update(tables.mergeCandidates)
    .set({ proposal: proposal as unknown as Record<string, unknown> })
    .where(eq(tables.mergeCandidates.id, candidateId));

  const [item] = await db
    .insert(tables.reviewItems)
    .values({
      orgId: candidate.orgId,
      kind: "merge",
      articleId: candidate.articleAId,
      mergeCandidateId: candidateId,
      confidence: proposal.confidence ?? 0.6,
      context: `${a.rev.title.slice(0, 40)} + ${b.rev.title.slice(0, 40)}`,
    })
    .returning();

  await recordEvent(candidate.orgId, "ai", null, "merge_proposed", {
    mergeCandidateId: candidateId,
    verdict: candidate.verdict,
    compositeScore: candidate.compositeScore,
  });
  await notifySupportersOfReviewItem(candidate.orgId, `Merge proposal: ${a.rev.title.slice(0, 60)}`, item.id);
}

/** 3-pane review payload: Article A | Article B | proposed merge (diff + rationale). */
export async function mergeReviewPayload(orgId: string, mergeCandidateId: string) {
  const candidate = await db.query.mergeCandidates.findFirst({
    where: and(eq(tables.mergeCandidates.id, mergeCandidateId), eq(tables.mergeCandidates.orgId, orgId)),
  });
  if (!candidate) return null;

  const load = async (articleId: string) => {
    const article = await db.query.articles.findFirst({ where: eq(tables.articles.id, articleId) });
    if (!article?.currentRevisionId) return null;
    const rev = await db.query.articleRevisions.findFirst({
      where: eq(tables.articleRevisions.id, article.currentRevisionId),
    });
    const blocks = rev ? await blocksForRevision(rev.id) : [];
    return {
      id: article.id,
      kb: `KB-${String(article.kbNumber).padStart(3, "0")}`,
      title: rev?.title ?? "",
      summary: rev?.summary ?? "",
      blocks: blocks.map((blk) => ({ id: blk.id, kind: blk.kind, conditionText: blk.conditionText, contentMd: blk.contentMd })),
    };
  };
  const [articleA, articleB] = await Promise.all([load(candidate.articleAId), load(candidate.articleBId)]);

  return {
    mergeCandidate: {
      id: candidate.id,
      verdict: candidate.verdict,
      scores: candidate.scores,
      compositeScore: candidate.compositeScore,
      proposal: candidate.proposal,
    },
    articleA,
    articleB,
  };
}

/**
 * Apply an approved merge: survivor gets the merged revision; loser becomes a
 * tombstone redirecting forever; provenance is the union; embeddings recomputed.
 * Reversible: revisions are immutable and the loser's blocks stay in history.
 */
export async function approveMerge(
  item: typeof tables.reviewItems.$inferSelect,
  userId: string,
  edits?: { title: string; summary: string; blocks: { kind: string; contentMd: string; conditionText?: string | null }[] },
): Promise<{ ok: true; survivorId: string; tombstoneId: string }> {
  if (!item.mergeCandidateId) throw new Error("review item has no merge candidate");
  const candidate = await db.query.mergeCandidates.findFirst({
    where: eq(tables.mergeCandidates.id, item.mergeCandidateId),
  });
  if (!candidate) throw new Error("merge candidate not found");
  const proposal = candidate.proposal as ProposalJson | null;
  if (!proposal && !edits) throw new Error("no proposal to apply");

  const survivorId = candidate.articleAId;
  const tombstoneId = candidate.articleBId;

  const source = edits ?? proposal!;
  const validKinds = new Set(["symptoms", "environment", "resolution", "notes"]);
  const finalBlocks = (source.blocks ?? []).filter((b) => validKinds.has(b.kind) && b.contentMd?.trim());

  // provenance union of both articles' current blocks
  const currentBlocks = await db
    .select({ id: tables.articleBlocks.id })
    .from(tables.articleBlocks)
    .innerJoin(tables.articles, eq(tables.articles.currentRevisionId, tables.articleBlocks.revisionId))
    .where(inArray(tables.articleBlocks.articleId, [survivorId, tombstoneId]));
  const provRows =
    currentBlocks.length > 0
      ? await db
          .select()
          .from(tables.provenance)
          .where(inArray(tables.provenance.articleBlockId, currentBlocks.map((b) => b.id)))
      : [];
  const unionSources = [...new Map(provRows.map((p) => [`${p.sourceKind}:${p.sourceId}`, p])).values()].map((p) => ({
    kind: p.sourceKind as "request" | "resolution",
    id: p.sourceId,
  }));

  const survivor = await db.query.articles.findFirst({ where: eq(tables.articles.id, survivorId) });
  const loser = await db.query.articles.findFirst({ where: eq(tables.articles.id, tombstoneId) });
  if (!survivor || !loser) throw new Error("articles missing");

  const revision = await addRevision({
    orgId: candidate.orgId,
    articleId: survivorId,
    title: "mergedTitle" in source ? (source as ProposalJson).mergedTitle : (edits?.title ?? ""),
    summary: "mergedSummary" in source ? (source as ProposalJson).mergedSummary : (edits?.summary ?? ""),
    blocks: finalBlocks.map(
      (b): BlockInput => ({
        kind: b.kind as BlockInput["kind"],
        contentMd: b.contentMd,
        conditionText: b.conditionText ?? null,
        sources: unionSources,
      }),
    ),
    createdByKind: edits ? "user" : "ai",
    createdById: edits ? userId : undefined,
    approvedBy: userId,
    parentRevisionId: survivor.currentRevisionId ?? undefined,
    changeNote: `merged with KB-${String(loser.kbNumber).padStart(3, "0")}`,
    setCurrent: true,
  });

  // fold the loser's usage stats into the survivor, then tombstone it
  await db
    .update(tables.articles)
    .set({
      status: "published",
      helpfulCount: survivor.helpfulCount + loser.helpfulCount,
      notHelpfulCount: survivor.notHelpfulCount + loser.notHelpfulCount,
      solveCount: survivor.solveCount + loser.solveCount,
      tags: [...new Set([...survivor.tags, ...loser.tags])],
      updatedAt: new Date(),
      embeddingStatus: "pending",
    })
    .where(eq(tables.articles.id, survivorId));
  await enqueueEmbed("article", survivorId);

  await db
    .update(tables.articles)
    .set({ status: "tombstone", redirectToArticleId: survivorId, updatedAt: new Date() })
    .where(eq(tables.articles.id, tombstoneId));

  // anything pointing at the loser follows the redirect at read time; new links go to the survivor
  await db
    .update(tables.resolutions)
    .set({ articleId: survivorId })
    .where(and(eq(tables.resolutions.articleId, tombstoneId), eq(tables.resolutions.orgId, candidate.orgId)));
  await db
    .update(tables.clusters)
    .set({ articleId: survivorId })
    .where(and(eq(tables.clusters.articleId, tombstoneId), eq(tables.clusters.orgId, candidate.orgId)));

  await db
    .update(tables.mergeCandidates)
    .set({ status: "approved", reviewedBy: userId, reviewedAt: new Date(), proposalRevisionId: revision.id })
    .where(eq(tables.mergeCandidates.id, candidate.id));
  await db
    .update(tables.reviewItems)
    .set({ status: "approved", reviewedBy: userId, reviewedAt: new Date() })
    .where(eq(tables.reviewItems.id, item.id));

  // any other pending candidates involving the tombstone are moot
  await db
    .update(tables.mergeCandidates)
    .set({ status: "suppressed" })
    .where(
      and(
        eq(tables.mergeCandidates.orgId, candidate.orgId),
        eq(tables.mergeCandidates.status, "proposed"),
        ne(tables.mergeCandidates.id, candidate.id),
        or(eq(tables.mergeCandidates.articleAId, tombstoneId), eq(tables.mergeCandidates.articleBId, tombstoneId)),
      ),
    );

  await recordEvent(candidate.orgId, "user", userId, "merge_approved", {
    mergeCandidateId: candidate.id,
    survivorId,
    tombstoneId,
    edited: Boolean(edits),
  });
  return { ok: true, survivorId, tombstoneId };
}
