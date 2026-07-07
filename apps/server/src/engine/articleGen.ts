import { and, eq, inArray } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { getLlmProvider, extractJson } from "../providers/llm/index.js";
import { searchArticles, searchResolutions } from "../search/hybrid.js";
import { createArticleWithRevision, type BlockInput } from "./articles.js";
import { recordEvent } from "../lib/events.js";
import { threadTranscript } from "../lib/thread.js";
import { notifySupportersOfReviewItem } from "./reviewNotify.js";
import { bus } from "../realtime/bus.js";
import { logger } from "../lib/logger.js";

const ALREADY_DOCUMENTED_SIMILARITY = 0.86;

/**
 * Terminal state of the documentation pipeline for one resolution — this is
 * what the "AI activity" feed and the thread status line render. Every exit
 * path of considerArticleGeneration must land on one of these, otherwise the
 * supporter is left staring at a spinner.
 */
async function settleDocState(
  resolution: { id: string; orgId: string; requestId: string },
  state: "drafted" | "already_documented" | "covered_by_draft" | "skipped" | "failed",
  note: string | null,
): Promise<void> {
  await db.update(tables.resolutions).set({ docState: state, docNote: note }).where(eq(tables.resolutions.id, resolution.id));
  await recordEvent(resolution.orgId, "ai", null, "doc_pipeline_settled", {
    resolutionId: resolution.id,
    requestId: resolution.requestId,
    state,
    note,
  });
  bus.publish(resolution.orgId, {
    type: "ai_activity",
    supporterOnly: true,
    data: { resolutionId: resolution.id, requestId: resolution.requestId, state },
  });
}

/** "KB-041 · VPN drops on hotel Wi-Fi" for the matched-existing-article note. */
async function articleLabel(articleId: string): Promise<string> {
  const article = await db.query.articles.findFirst({ where: eq(tables.articles.id, articleId) });
  if (!article) return "an existing article";
  const kb = `KB-${String(article.kbNumber).padStart(3, "0")}`;
  if (!article.currentRevisionId) return kb;
  const rev = await db.query.articleRevisions.findFirst({ where: eq(tables.articleRevisions.id, article.currentRevisionId) });
  return rev ? `${kb} · ${rev.title}` : kb;
}

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

  try {
    await generate(resolution, request);
  } catch (err) {
    logger.error("article generation failed", { resolutionId, err: String(err) });
    await settleDocState(resolution, "failed", "Something went wrong while writing this up — the capture is saved.").catch(() => {});
    throw err;
  }
}

async function generate(
  resolution: typeof tables.resolutions.$inferSelect,
  request: typeof tables.requests.$inferSelect,
): Promise<void> {
  const resolutionId = resolution.id;
  const queryText = `${request.title}\n${resolution.structuredSummary ?? resolution.rawCaptureText}`;

  // 1. already documented? (vector similarity against published articles)
  const articleHits = await searchArticles(request.orgId, queryText, { limit: 3 });
  const best = articleHits[0];
  if (best?.similarity && best.similarity >= ALREADY_DOCUMENTED_SIMILARITY) {
    // documented — link resolution to the article; freshness scan will decide
    // if the new resolution contradicts it.
    await db.update(tables.resolutions).set({ articleId: best.id }).where(eq(tables.resolutions.id, resolutionId));
    await settleDocState(resolution, "already_documented", `Covered by ${await articleLabel(best.id)} — no new doc needed.`);
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
    if (covered) {
      await settleDocState(resolution, "covered_by_draft", "A draft already in review covers this — nothing new created.");
      return;
    }
  }

  // 4. draft it
  const requestIds = [...new Set(sources.map((s) => s.requestId))];
  const requests = await db.select().from(tables.requests).where(inArray(tables.requests.id, requestIds));
  const supporterIds = [...new Set(sources.map((s) => s.supporterId))];
  const supporters = await db
    .select({ id: tables.users.id, name: tables.users.name })
    .from(tables.users)
    .where(inArray(tables.users.id, supporterIds));

  // full conversation of the triggering request — symptoms, error messages and
  // troubleshooting detail beyond what the capture text alone carries
  const thread = await threadTranscript(resolution.requestId, { maxTotalChars: 4000 }).catch(() => "");

  const llm = getLlmProvider();
  const raw = await llm.complete({
    system:
      "You distill helpdesk resolutions into knowledge-base articles. Output strict JSON: " +
      '{"title": string, "summary": string (1-2 sentences), "blocks": [{"kind": "symptoms"|"environment"|"resolution"|"notes", "contentMd": string, "conditionText": string|null}], "confidence": number 0-1}. ' +
      "symptoms: what the user sees, as markdown bullets. environment: applies-to conditions if evident, else omit the block. " +
      "resolution: numbered steps, imperative, deduplicated across sources. notes: root cause / gotchas if evident, else omit. " +
      "thread is the full conversation of the latest request — mine it for exact symptoms, error messages and steps. " +
      "Write for the next person hitting this problem. Do not invent steps not present in the sources.",
    prompt: JSON.stringify({
      requests: requests.map((r) => ({ title: r.title, body: r.body.slice(0, 500) })),
      resolutions: sources.map((s) => ({
        summary: s.structuredSummary,
        raw: s.rawCaptureText.slice(0, 1000),
        kind: s.captureKind,
      })),
      thread,
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
    await settleDocState(resolution, "failed", "Draft generation failed — the capture is saved and can feed a future draft.");
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
  if (blocks.length === 0) {
    await settleDocState(resolution, "skipped", "Not enough substance to document — the capture is saved as a precedent.");
    return;
  }

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
  await settleDocState(resolution, "drafted", `Draft "${draft.title || request.title}" is ready for review.`);
  await notifySupportersOfReviewItem(request.orgId, `New article draft: ${draft.title || request.title}`, item.id);
}
