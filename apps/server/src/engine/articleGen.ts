import { and, eq, inArray } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { getLlmProvider, extractJson } from "../providers/llm/index.js";
import { searchArticles, searchResolutions } from "../search/hybrid.js";
import { createArticleWithRevision, type BlockInput } from "./articles.js";
import { recordEvent } from "../lib/events.js";
import { notifySupportersOfReviewItem } from "./reviewNotify.js";
import { logger } from "../lib/logger.js";

const ALREADY_DOCUMENTED_SIMILARITY = 0.86;

type DraftJson = {
  title: string;
  summary: string;
  blocks: { kind: string; contentMd: string; conditionText?: string | null }[];
  confidence?: number;
};

/**
 * Distill: after a resolution is captured (and structured), decide whether it
 * should become a new article draft, feed an existing pending draft, or be
 * ignored (already documented).
 *
 * "LLM proposes, human disposes" — drafts land in the review inbox and are
 * never auto-published.
 */
export async function considerArticleGeneration(resolutionId: string): Promise<void> {
  const resolution = await db.query.resolutions.findFirst({ where: eq(tables.resolutions.id, resolutionId) });
  if (!resolution) return;
  const request = await db.query.requests.findFirst({ where: eq(tables.requests.id, resolution.requestId) });
  if (!request) return;

  const queryText = `${request.title}\n${resolution.structuredSummary ?? resolution.rawCaptureText}`;

  // 1. already documented? (vector similarity against published articles)
  const articleHits = await searchArticles(request.orgId, queryText, { limit: 3 });
  const best = articleHits[0];
  if (best?.similarity && best.similarity >= ALREADY_DOCUMENTED_SIMILARITY) {
    // documented — link resolution to the article; freshness scan will decide
    // if the new resolution contradicts it.
    await db.update(tables.resolutions).set({ articleId: best.id }).where(eq(tables.resolutions.id, resolutionId));
    return;
  }

  // 2. gather sibling resolutions (same undocumented problem, captured before)
  const siblingHits = await searchResolutions(request.orgId, queryText, { limit: 6 });
  const siblingIds = siblingHits
    .filter((h) => h.id !== resolutionId && (h.similarity ?? 0) >= 0.75)
    .map((h) => h.id);
  const siblings =
    siblingIds.length > 0
      ? await db
          .select()
          .from(tables.resolutions)
          .where(and(inArray(tables.resolutions.id, siblingIds), eq(tables.resolutions.orgId, request.orgId)))
      : [];
  const sources = [resolution, ...siblings];

  // 3. is there already a pending draft covering this? then don't duplicate
  const pendingDrafts = await db
    .select()
    .from(tables.reviewItems)
    .where(
      and(
        eq(tables.reviewItems.orgId, request.orgId),
        eq(tables.reviewItems.kind, "draft"),
        eq(tables.reviewItems.status, "pending"),
      ),
    );
  if (pendingDrafts.length > 0) {
    const draftArticleIds = pendingDrafts.map((d) => d.articleId).filter(Boolean) as string[];
    const covered = sources.some((s) => s.articleId && draftArticleIds.includes(s.articleId));
    if (covered) return;
  }

  // 4. draft it
  const requestIds = [...new Set(sources.map((s) => s.requestId))];
  const requests = await db.select().from(tables.requests).where(inArray(tables.requests.id, requestIds));
  const supporterIds = [...new Set(sources.map((s) => s.supporterId))];
  const supporters = await db
    .select({ id: tables.users.id, name: tables.users.name })
    .from(tables.users)
    .where(inArray(tables.users.id, supporterIds));

  const llm = getLlmProvider();
  const raw = await llm.complete({
    system:
      "You distill helpdesk resolutions into knowledge-base articles. Output strict JSON: " +
      '{"title": string, "summary": string (1-2 sentences), "blocks": [{"kind": "symptoms"|"environment"|"resolution"|"notes", "contentMd": string, "conditionText": string|null}], "confidence": number 0-1}. ' +
      "symptoms: what the user sees, as markdown bullets. environment: applies-to conditions if evident, else omit the block. " +
      "resolution: numbered steps, imperative, deduplicated across sources. notes: root cause / gotchas if evident, else omit. " +
      "Write for the next person hitting this problem. Do not invent steps not present in the sources.",
    prompt: JSON.stringify({
      requests: requests.map((r) => ({ title: r.title, body: r.body.slice(0, 500) })),
      resolutions: sources.map((s) => ({
        summary: s.structuredSummary,
        raw: s.rawCaptureText.slice(0, 1000),
        kind: s.captureKind,
      })),
    }),
    json: true,
    orgId: request.orgId,
    task: "article_draft",
    data: {
      suggestedTitle: request.title,
      requestTitles: requests.map((r) => r.title),
      resolutions: sources.map((s) => ({ summary: s.structuredSummary ?? undefined, raw: s.rawCaptureText })),
    },
  });

  let draft: DraftJson;
  try {
    draft = extractJson<DraftJson>(raw);
  } catch (err) {
    logger.error("article draft JSON parse failed", { resolutionId, err: String(err) });
    return;
  }

  const validKinds = new Set(["symptoms", "environment", "resolution", "notes"]);
  const blocks: BlockInput[] = (draft.blocks ?? [])
    .filter((b) => validKinds.has(b.kind) && b.contentMd?.trim())
    .map((b) => ({
      kind: b.kind as BlockInput["kind"],
      contentMd: b.contentMd.trim(),
      conditionText: b.conditionText ?? null,
      sources: [
        ...sources.map((s) => ({ kind: "resolution" as const, id: s.id })),
        ...requests.map((r) => ({ kind: "request" as const, id: r.id })),
      ],
    }));
  if (blocks.length === 0) return;

  const confidence = Math.max(0.1, Math.min(1, draft.confidence ?? 0.4 + sources.length * 0.15));
  const { article, revision } = await createArticleWithRevision({
    orgId: request.orgId,
    title: draft.title || request.title,
    summary: draft.summary ?? "",
    blocks,
    tags: request.tags,
    createdByKind: "ai",
    status: "draft",
    confidence,
    changeNote: `drafted from ${sources.length} resolution(s)`,
  });

  // link source resolutions to the draft
  await db
    .update(tables.resolutions)
    .set({ articleId: article.id })
    .where(inArray(tables.resolutions.id, sources.map((s) => s.id)));

  const supporterNames = supporters.map((s) => s.name.split(" ")[0]).slice(0, 3).join(", ");
  const [item] = await db
    .insert(tables.reviewItems)
    .values({
      orgId: request.orgId,
      kind: "draft",
      articleId: article.id,
      revisionId: revision.id,
      confidence,
      context: `From ${sources.length} resolution${sources.length === 1 ? "" : "s"} · ${supporterNames}`,
    })
    .returning();

  await recordEvent(request.orgId, "ai", null, "article_draft_created", {
    articleId: article.id,
    reviewItemId: item.id,
    sourceResolutions: sources.length,
    confidence,
  });
  await notifySupportersOfReviewItem(request.orgId, `New article draft: ${draft.title || request.title}`, item.id);
}
