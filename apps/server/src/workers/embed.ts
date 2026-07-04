import { eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { getEmbeddingProvider } from "../providers/embeddings/index.js";
import { getLlmProvider } from "../providers/llm/index.js";
import { getStorage } from "../providers/storage/index.js";
import { logger } from "../lib/logger.js";
import type { EmbedJob } from "./queues.js";

/**
 * Embedding pipeline: writes never block on embedding. Rows are created with
 * embedding_status='pending'; this worker embeds and flips to 'ok'.
 * Target: <5s from creation to searchable.
 */
export async function handleEmbedJob(job: EmbedJob): Promise<void> {
  try {
    switch (job.kind) {
      case "request":
        return await embedRequest(job.id);
      case "resolution":
        return await embedResolution(job.id);
      case "article":
        return await embedArticle(job.id);
      case "article_block":
        return await embedArticleBlock(job.id);
      case "message":
        return await embedMessage(job.id);
      case "attachment":
        return await embedAttachment(job.id);
    }
  } catch (err) {
    logger.error("embed job failed", { job, err: String(err) });
    await markFailed(job);
    throw err; // let pg-boss retry
  }
}

async function markFailed(job: EmbedJob): Promise<void> {
  const table = {
    request: tables.requests,
    resolution: tables.resolutions,
    article: tables.articles,
    article_block: tables.articleBlocks,
    message: tables.messages,
    attachment: tables.attachments,
  }[job.kind];
  await db
    .update(table)
    .set({ embeddingStatus: "failed" })
    .where(eq(table.id, job.id))
    .catch(() => {});
}

function vecLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

async function embedText(
  text: string,
  meta: { orgId: string; purpose: string },
): Promise<{ vec: string; model: string } | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const provider = getEmbeddingProvider();
  const [vec] = await provider.embed([trimmed], meta);
  return { vec: vecLiteral(vec), model: provider.model };
}

async function embedRequest(id: string): Promise<void> {
  const row = await db.query.requests.findFirst({ where: eq(tables.requests.id, id) });
  if (!row) return;
  const out = await embedText(`${row.title}\n${row.body}`, { orgId: row.orgId, purpose: "embed_request" });
  await db
    .update(tables.requests)
    .set(out ? { embedding: JSON.parse(out.vec), embeddingModel: out.model, embeddingStatus: "ok" } : { embeddingStatus: "skipped" })
    .where(eq(tables.requests.id, id));
}

async function embedResolution(id: string): Promise<void> {
  const row = await db.query.resolutions.findFirst({ where: eq(tables.resolutions.id, id) });
  if (!row) return;
  const out = await embedText(`${row.structuredSummary ?? ""}\n${row.rawCaptureText}`, {
    orgId: row.orgId,
    purpose: "embed_resolution",
  });
  await db
    .update(tables.resolutions)
    .set(out ? { embedding: JSON.parse(out.vec), embeddingStatus: "ok" } : { embeddingStatus: "skipped" })
    .where(eq(tables.resolutions.id, id));
}

async function embedArticle(id: string): Promise<void> {
  const row = await db.query.articles.findFirst({ where: eq(tables.articles.id, id) });
  if (!row?.currentRevisionId) return;
  const rev = await db.query.articleRevisions.findFirst({
    where: eq(tables.articleRevisions.id, row.currentRevisionId),
  });
  if (!rev) return;
  const out = await embedText(`${rev.title}\n${rev.summary}`, { orgId: row.orgId, purpose: "embed_article" });
  await db
    .update(tables.articles)
    .set(out ? { embedding: JSON.parse(out.vec), embeddingModel: out.model, embeddingStatus: "ok" } : { embeddingStatus: "skipped" })
    .where(eq(tables.articles.id, id));
}

async function embedArticleBlock(id: string): Promise<void> {
  const row = await db.query.articleBlocks.findFirst({ where: eq(tables.articleBlocks.id, id) });
  if (!row) return;
  const out = await embedText(`${row.conditionText ?? ""}\n${row.contentMd}`, {
    orgId: row.orgId,
    purpose: "embed_article",
  });
  await db
    .update(tables.articleBlocks)
    .set(out ? { embedding: JSON.parse(out.vec), embeddingStatus: "ok" } : { embeddingStatus: "skipped" })
    .where(eq(tables.articleBlocks.id, id));
}

async function embedMessage(id: string): Promise<void> {
  const row = await db.query.messages.findFirst({ where: eq(tables.messages.id, id) });
  if (!row) return;
  const out = await embedText(row.body, { orgId: row.orgId, purpose: "embed_message" });
  await db
    .update(tables.messages)
    .set(out ? { embedding: JSON.parse(out.vec), embeddingStatus: "ok" } : { embeddingStatus: "skipped" })
    .where(eq(tables.messages.id, id));
}

/**
 * Attachments: OCR (images) / transcription (audio) via the LLM provider,
 * then embed. If the embedding provider is natively multimodal
 * (gemini-embedding-2), the media itself is embedded directly — the extracted
 * text is still stored for display and keyword search.
 */
async function embedAttachment(id: string): Promise<void> {
  const row = await db.query.attachments.findFirst({ where: eq(tables.attachments.id, id) });
  if (!row) return;

  let extractedText = row.extractedText ?? "";
  const llm = getLlmProvider();
  const embedder = getEmbeddingProvider();

  let mediaVec: number[] | null = null;
  if (row.kind === "image" || row.kind === "audio") {
    const data = await getStorage().get(row.storageKey);

    const meta = { orgId: row.orgId, purpose: "embed_attachment" };
    if (embedder.embedMedia) {
      mediaVec = await embedder.embedMedia(data, row.mimeType, meta).catch(() => null);
    }
    if (!extractedText) {
      try {
        if (row.kind === "image" && llm.ocr) {
          extractedText = (await llm.ocr(data, row.mimeType, meta)) ?? "";
        } else if (row.kind === "audio" && llm.transcribe) {
          extractedText = (await llm.transcribe(data, row.mimeType, row.filename, meta)) ?? "";
        }
      } catch (err) {
        logger.warn("attachment text extraction failed", { id, err: String(err) });
      }
    }
  }

  let embedding: number[] | null = mediaVec;
  if (!embedding && extractedText.trim()) {
    const [vec] = await embedder.embed([extractedText], { orgId: row.orgId, purpose: "embed_attachment" });
    embedding = vec;
  }

  await db
    .update(tables.attachments)
    .set({
      extractedText: extractedText || null,
      embedding: embedding ?? undefined,
      embeddingStatus: embedding ? "ok" : "skipped",
    })
    .where(eq(tables.attachments.id, id));

  // Extracted text feeds back into the owner's embedding (photo of an error
  // screen attached to a request makes the request itself more matchable).
  if (extractedText && row.ownerKind === "request") {
    const req = await db.query.requests.findFirst({ where: eq(tables.requests.id, row.ownerId) });
    if (req) {
      const out = await embedText(`${req.title}\n${req.body}\n${extractedText}`, {
        orgId: req.orgId,
        purpose: "embed_request",
      });
      if (out) {
        await db
          .update(tables.requests)
          .set({ embedding: JSON.parse(out.vec), embeddingModel: out.model, embeddingStatus: "ok" })
          .where(eq(tables.requests.id, req.id));
      }
    }
  }
}
