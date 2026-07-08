import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import type { DocCaptureTopic } from "../db/schema.js";
import { getLlmProvider, extractJson } from "../providers/llm/index.js";
import { searchArticles } from "../search/hybrid.js";
import { createArticleWithRevision, type BlockInput } from "./articles.js";
import { recordEvent } from "../lib/events.js";
import { enqueue, QUEUES } from "../workers/queues.js";
import { logger } from "../lib/logger.js";

const ALREADY_DOCUMENTED_SIMILARITY = 0.86;
/** OCR/transcription is async — poll a few times before drafting without it. */
const MAX_MEDIA_WAIT_ATTEMPTS = 10;

export type DocGenJob = { captureId: string; attempt?: number };

type SplitJson = {
  topics: { title: string; kind?: string; summary?: string; sourceHint?: string }[];
};

type DraftJson = {
  title: string;
  summary: string;
  blocks: { kind: string; contentMd: string; conditionText?: string | null }[];
  confidence?: number;
};

const TOPIC_KINDS = new Set(["how-to", "onboarding", "good-to-know", "other"]);

async function setCapture(captureId: string, patch: Partial<typeof tables.docCaptures.$inferInsert>): Promise<void> {
  await db
    .update(tables.docCaptures)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(tables.docCaptures.id, captureId));
}

/** "KB-041 · VPN drops on hotel Wi-Fi" for covered topics. */
async function articleLabel(articleId: string): Promise<string> {
  const article = await db.query.articles.findFirst({ where: eq(tables.articles.id, articleId) });
  if (!article) return "an existing article";
  const kb = `KB-${String(article.kbNumber).padStart(3, "0")}`;
  if (!article.currentRevisionId) return kb;
  const rev = await db.query.articleRevisions.findFirst({ where: eq(tables.articleRevisions.id, article.currentRevisionId) });
  return rev ? `${kb} · ${rev.title}` : kb;
}

/** Archive any draft articles a cancelled capture already produced. */
export async function archiveCaptureDrafts(capture: typeof tables.docCaptures.$inferSelect): Promise<void> {
  for (const topic of capture.topics) {
    if (topic.status !== "drafted" || !topic.articleId) continue;
    await db
      .update(tables.articles)
      .set({ status: "tombstone", updatedAt: new Date() })
      .where(and(eq(tables.articles.id, topic.articleId), eq(tables.articles.orgId, capture.orgId), eq(tables.articles.status, "draft")));
  }
}

/**
 * Knowledge capture pipeline: split a supporter brain-dump (notes + OCR'd
 * photos + voice transcripts) into topics, then draft one article per topic —
 * skipping anything already documented. Drafts stay out of the review inbox
 * until the author submits the results.
 */
export async function generateDocsFromCapture(job: DocGenJob): Promise<void> {
  const capture = await db.query.docCaptures.findFirst({ where: eq(tables.docCaptures.id, job.captureId) });
  if (!capture) return;
  if (capture.status === "cancelled" || capture.status === "submitted") return;

  try {
    await run(capture, job.attempt ?? 0);
  } catch (err) {
    logger.error("doc capture generation failed", { captureId: job.captureId, err: String(err) });
    await setCapture(capture.id, {
      status: "failed",
      error: "Something went wrong while structuring your notes — they're saved, try again in a moment.",
    }).catch(() => {});
  }
}

async function run(capture: typeof tables.docCaptures.$inferSelect, attempt: number): Promise<void> {
  const attachments = await db
    .select()
    .from(tables.attachments)
    .where(and(eq(tables.attachments.ownerKind, "doc_capture"), eq(tables.attachments.ownerId, capture.id)));

  // 1. wait for OCR / transcription so photos and voice memos contribute
  const mediaPending = attachments.some((a) => (a.kind === "image" || a.kind === "audio") && a.embeddingStatus === "pending");
  if (mediaPending && attempt < MAX_MEDIA_WAIT_ATTEMPTS) {
    await setCapture(capture.id, { status: "reading" });
    await enqueue(QUEUES.docGen, { captureId: capture.id, attempt: attempt + 1 } satisfies DocGenJob, { startAfterSeconds: 4 });
    return;
  }

  await setCapture(capture.id, { status: "reading" });

  // 2. split into topics
  const sources = attachments
    .filter((a) => a.extractedText?.trim())
    .map((a) => ({
      kind: a.kind === "audio" ? ("voice memo" as const) : a.kind === "image" ? ("photo" as const) : ("file" as const),
      text: a.extractedText!.slice(0, 4000),
    }));

  const llm = getLlmProvider();
  const splitRaw = await llm.complete({
    system:
      "You split a support team member's knowledge brain-dump into distinct documentable topics. " +
      "Input is free-form notes plus transcripts of voice memos and OCR text from photos, in any mix and order. " +
      'Output strict JSON: {"topics": [{"title": string (short, imperative or descriptive), ' +
      '"kind": "how-to"|"onboarding"|"good-to-know"|"other", "summary": string (1 sentence), ' +
      '"sourceHint": string (e.g. "from notes + photo", "from voice memo")}]}. ' +
      "Find 1-6 genuinely separate topics; merge fragments about the same thing into one topic. " +
      "Never invent topics not supported by the input.",
    prompt: JSON.stringify({
      notes: capture.rawText.slice(0, 8000),
      attachments: sources,
    }),
    json: true,
    orgId: capture.orgId,
    task: "capture_split",
    data: { raw: [capture.rawText, ...sources.map((s) => s.text)].filter(Boolean).join("\n") },
  });

  let split: SplitJson;
  try {
    split = extractJson<SplitJson>(splitRaw);
  } catch (err) {
    logger.error("capture split JSON parse failed", { captureId: capture.id, err: String(err) });
    await setCapture(capture.id, { status: "failed", error: "Couldn't make sense of the notes — try adding a bit more detail." });
    return;
  }

  const topics: DocCaptureTopic[] = (split.topics ?? [])
    .filter((t) => t.title?.trim())
    .slice(0, 6)
    .map((t) => ({
      id: randomUUID(),
      title: t.title.trim().slice(0, 200),
      kind: TOPIC_KINDS.has(t.kind ?? "") ? (t.kind as DocCaptureTopic["kind"]) : "other",
      summary: (t.summary ?? "").trim().slice(0, 500),
      sourceHint: (t.sourceHint ?? "from notes").trim().slice(0, 100),
      status: "pending",
    }));

  if (topics.length === 0) {
    await setCapture(capture.id, { status: "failed", error: "No documentable topics found — try adding a bit more detail." });
    return;
  }

  await setCapture(capture.id, { status: "drafting", topics });

  // 3. draft each topic, updating the row after every one so the client's
  //    poll renders live progress ticks
  for (const topic of topics) {
    const fresh = await db.query.docCaptures.findFirst({ where: eq(tables.docCaptures.id, capture.id) });
    if (!fresh || fresh.status === "cancelled") {
      if (fresh) await archiveCaptureDrafts(fresh);
      return;
    }

    try {
      await draftTopic(capture, topic, sources);
    } catch (err) {
      logger.error("capture topic draft failed", { captureId: capture.id, topic: topic.title, err: String(err) });
      topic.status = "failed";
    }
    await setCapture(capture.id, { topics });
  }

  await setCapture(capture.id, { status: "ready", topics });
  await recordEvent(capture.orgId, "ai", null, "doc_capture_drafted", {
    captureId: capture.id,
    topics: topics.length,
    drafted: topics.filter((t) => t.status === "drafted").length,
  });
}

async function draftTopic(
  capture: typeof tables.docCaptures.$inferSelect,
  topic: DocCaptureTopic,
  sources: { kind: string; text: string }[],
): Promise<void> {
  // already documented? then point at the existing article instead of duplicating
  const hits = await searchArticles(capture.orgId, `${topic.title}\n${topic.summary}`, { limit: 3 });
  const best = hits[0];
  if (best?.similarity && best.similarity >= ALREADY_DOCUMENTED_SIMILARITY) {
    topic.status = "covered";
    topic.coveredByLabel = await articleLabel(best.id);
    return;
  }

  const llm = getLlmProvider();
  const raw = await llm.complete({
    system:
      "You turn one topic from a support team member's knowledge notes into a knowledge-base article. Output strict JSON: " +
      '{"title": string, "summary": string (1-2 sentences), "blocks": [{"kind": "symptoms"|"environment"|"resolution"|"notes", "contentMd": string, "conditionText": string|null}], "confidence": number 0-1}. ' +
      "Block guidance: use resolution (numbered imperative steps) for how-tos and procedures; use notes for context, policies and good-to-know facts; " +
      "use symptoms only when the topic describes a problem people hit; use environment only when applies-to conditions are evident. " +
      "Write for the next person needing this knowledge. Only use facts present in the input — never invent steps or details.",
    prompt: JSON.stringify({
      topic: { title: topic.title, kind: topic.kind, summary: topic.summary },
      notes: capture.rawText.slice(0, 8000),
      attachments: sources,
    }),
    json: true,
    orgId: capture.orgId,
    task: "capture_draft",
    data: { title: topic.title, notes: `${topic.summary}\n${capture.rawText}` },
  });

  const draft = extractJson<DraftJson>(raw);
  const validKinds = new Set(["symptoms", "environment", "resolution", "notes"]);
  const blocks: BlockInput[] = (draft.blocks ?? [])
    .filter((b) => validKinds.has(b.kind) && b.contentMd?.trim())
    .map((b) => ({
      kind: b.kind as BlockInput["kind"],
      contentMd: b.contentMd.trim(),
      conditionText: b.conditionText ?? null,
    }));
  if (blocks.length === 0) {
    topic.status = "failed";
    return;
  }

  const confidence = Math.max(0.1, Math.min(1, draft.confidence ?? 0.5));
  const { article } = await createArticleWithRevision({
    orgId: capture.orgId,
    title: draft.title || topic.title,
    summary: draft.summary ?? topic.summary,
    blocks,
    tags: [topic.kind],
    createdByKind: "ai",
    status: "draft",
    confidence,
    changeNote: "drafted from a knowledge capture",
  });

  topic.status = "drafted";
  topic.articleId = article.id;
  topic.title = draft.title || topic.title;
  if (draft.summary) topic.summary = draft.summary;
}
