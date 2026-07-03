import { and, asc, eq, inArray } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { nextCounter } from "../lib/counters.js";
import { enqueueEmbed } from "../workers/queues.js";

export type BlockInput = {
  kind: "symptoms" | "environment" | "resolution" | "notes";
  contentMd: string;
  conditionText?: string | null;
  /** provenance sources for this block */
  sources?: { kind: "request" | "resolution"; id: string }[];
};

/**
 * Article write model. Articles are trees of typed blocks stored as rows;
 * revisions are immutable — every edit creates a new revision and republishing
 * flips current_revision_id.
 */
export async function createArticleWithRevision(input: {
  orgId: string;
  title: string;
  summary: string;
  blocks: BlockInput[];
  tags?: string[];
  createdByKind: "ai" | "user";
  createdById?: string;
  status?: "draft" | "published";
  confidence?: number;
  changeNote?: string;
}): Promise<{ article: typeof tables.articles.$inferSelect; revision: typeof tables.articleRevisions.$inferSelect }> {
  const kbNumber = await nextCounter(input.orgId, "article");
  const [article] = await db
    .insert(tables.articles)
    .values({
      orgId: input.orgId,
      kbNumber,
      status: input.status ?? "draft",
      tags: input.tags ?? [],
      confidence: input.confidence ?? 0.5,
    })
    .returning();

  const revision = await addRevision({
    orgId: input.orgId,
    articleId: article.id,
    title: input.title,
    summary: input.summary,
    blocks: input.blocks,
    createdByKind: input.createdByKind,
    createdById: input.createdById,
    changeNote: input.changeNote ?? "initial revision",
    setCurrent: true,
  });

  const [fresh] = await db.select().from(tables.articles).where(eq(tables.articles.id, article.id));
  return { article: fresh, revision };
}

export async function addRevision(input: {
  orgId: string;
  articleId: string;
  title: string;
  summary: string;
  blocks: BlockInput[];
  createdByKind: "ai" | "user";
  createdById?: string;
  approvedBy?: string;
  parentRevisionId?: string;
  changeNote?: string;
  /** immediately make this the live revision (manual edits); AI proposals wait for review */
  setCurrent?: boolean;
}): Promise<typeof tables.articleRevisions.$inferSelect> {
  const [revision] = await db
    .insert(tables.articleRevisions)
    .values({
      orgId: input.orgId,
      articleId: input.articleId,
      title: input.title,
      summary: input.summary,
      createdByKind: input.createdByKind,
      createdById: input.createdById,
      approvedBy: input.approvedBy,
      parentRevisionId: input.parentRevisionId,
      changeNote: input.changeNote,
    })
    .returning();

  const KIND_ORDER = ["symptoms", "environment", "resolution", "notes"];
  const sorted = [...input.blocks].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i];
    const [block] = await db
      .insert(tables.articleBlocks)
      .values({
        orgId: input.orgId,
        articleId: input.articleId,
        revisionId: revision.id,
        kind: b.kind,
        position: i,
        conditionText: b.conditionText ?? null,
        contentMd: b.contentMd,
      })
      .returning();
    if (b.sources && b.sources.length > 0) {
      await db.insert(tables.provenance).values(
        b.sources.map((s) => ({ articleBlockId: block.id, sourceKind: s.kind, sourceId: s.id })),
      );
    }
    await enqueueEmbed("article_block", block.id);
  }

  if (input.setCurrent) {
    await db
      .update(tables.articles)
      .set({ currentRevisionId: revision.id, updatedAt: new Date(), embeddingStatus: "pending" })
      .where(eq(tables.articles.id, input.articleId));
    await enqueueEmbed("article", input.articleId);
  }

  return revision;
}

export async function blocksForRevision(revisionId: string) {
  return db
    .select()
    .from(tables.articleBlocks)
    .where(eq(tables.articleBlocks.revisionId, revisionId))
    .orderBy(asc(tables.articleBlocks.position));
}

export async function provenanceForBlocks(blockIds: string[]) {
  if (blockIds.length === 0) return [];
  return db.select().from(tables.provenance).where(inArray(tables.provenance.articleBlockId, blockIds));
}

/** Flatten the block tree to plain Markdown — the no-lock-in export. */
export function articleToMarkdown(
  title: string,
  summary: string,
  kb: string,
  blocks: { kind: string; conditionText: string | null; contentMd: string }[],
): string {
  const sections: string[] = [`# ${title}`, ``, `> ${kb}${summary ? ` — ${summary}` : ""}`];
  const heading: Record<string, string> = {
    symptoms: "## Symptoms",
    environment: "## Applies to",
    resolution: "## Resolution",
    notes: "## Notes",
  };
  let lastKind = "";
  for (const b of blocks) {
    if (b.kind !== lastKind) {
      sections.push("", heading[b.kind] ?? `## ${b.kind}`);
      lastKind = b.kind;
    }
    if (b.conditionText) sections.push("", `**If: ${b.conditionText}**`);
    sections.push("", b.contentMd);
  }
  return sections.join("\n");
}

export async function publishedArticleView(orgId: string, articleId: string) {
  const article = await db.query.articles.findFirst({
    where: and(eq(tables.articles.id, articleId), eq(tables.articles.orgId, orgId)),
  });
  if (!article) return null;

  // tombstones redirect forever
  if (article.status === "tombstone" && article.redirectToArticleId) {
    return { redirectTo: article.redirectToArticleId };
  }
  if (!article.currentRevisionId) return null;

  const revision = await db.query.articleRevisions.findFirst({
    where: eq(tables.articleRevisions.id, article.currentRevisionId),
  });
  if (!revision) return null;
  const blocks = await blocksForRevision(revision.id);

  return {
    article: {
      id: article.id,
      kb: `KB-${String(article.kbNumber).padStart(3, "0")}`,
      status: article.status,
      tags: article.tags,
      confidence: article.confidence,
      freshnessScore: article.freshnessScore,
      staleFlag: article.staleFlag,
      staleReason: article.staleReason,
      helpfulCount: article.helpfulCount,
      notHelpfulCount: article.notHelpfulCount,
      viewCount: article.viewCount,
      solveCount: article.solveCount,
      updatedAt: article.updatedAt,
      title: revision.title,
      summary: revision.summary,
      revisionId: revision.id,
    },
    blocks: blocks.map((b) => ({
      id: b.id,
      kind: b.kind,
      position: b.position,
      conditionText: b.conditionText,
      contentMd: b.contentMd,
    })),
  };
}
