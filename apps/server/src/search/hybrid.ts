import { and, eq, inArray, sql } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { getEmbeddingProvider } from "../providers/embeddings/index.js";
import { rrfFuse } from "./rrf.js";
import { logger } from "../lib/logger.js";

/**
 * Hybrid search: pgvector cosine KNN + Postgres full-text, fused with RRF.
 * Every query is hard-scoped by org_id. Vector half degrades gracefully if
 * the query embedding fails (keyword-only), and vice versa.
 */

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function embedQuery(text: string, meta?: { orgId?: string; purpose?: string }): Promise<number[] | null> {
  try {
    const [vec] = await getEmbeddingProvider().embed([text], {
      orgId: meta?.orgId,
      purpose: meta?.purpose ?? "search_query",
    });
    return vec ?? null;
  } catch (err) {
    logger.warn("query embedding failed — falling back to keyword-only search", { err: String(err) });
    return null;
  }
}

/** Mean of the query embeddings — lets one KNN query blend typed text with photo/voice vectors. */
function averageVectors(vecs: number[][]): number[] | null {
  if (vecs.length === 0) return null;
  if (vecs.length === 1) return vecs[0];
  const out = new Array<number>(vecs[0].length).fill(0);
  for (const v of vecs) for (let i = 0; i < out.length; i++) out[i] += v[i] / vecs.length;
  return out;
}

export type MultimodalQuery = {
  /** typed text plus OCR/transcripts of the attached media — drives the keyword half */
  queryText: string;
  /** text vector averaged with the media vectors — drives the KNN half */
  vec: number[] | null;
  /** attachments whose OCR/transcription/embedding hasn't landed yet — clients re-ask while > 0 */
  pendingAttachments: number;
};

/**
 * One query from typed text plus uploaded photos/voice notes. The attachments
 * must still be ownerless ("pending") and belong to the asking user: their
 * extracted text extends the keyword+text-vector half and their multimodal
 * media embeddings are averaged into the query vector. Shared by live
 * deflection and global/KB search.
 */
export async function multimodalQuery(
  orgId: string,
  text: string,
  opts: { attachmentIds?: string[]; userId?: string; purpose?: string } = {},
): Promise<MultimodalQuery> {
  let queryText = text.trim();
  let pendingAttachments = 0;
  const vecs: number[][] = [];

  if (opts.attachmentIds && opts.attachmentIds.length > 0) {
    const rows = await db
      .select({
        extractedText: tables.attachments.extractedText,
        embedding: tables.attachments.embedding,
        embeddingStatus: tables.attachments.embeddingStatus,
      })
      .from(tables.attachments)
      .where(
        and(
          inArray(tables.attachments.id, opts.attachmentIds),
          eq(tables.attachments.orgId, orgId),
          eq(tables.attachments.ownerKind, "pending"),
          ...(opts.userId ? [eq(tables.attachments.ownerId, opts.userId)] : []),
        ),
      );
    for (const a of rows) {
      if (a.embeddingStatus === "pending") pendingAttachments++;
      // The corpus (articles/requests/messages) is embedded as *text*, so the
      // OCR/transcript is the strong bridge — raw media vectors sit in a
      // different region of the space (~0.4 cosine vs text) and only help
      // when extraction yielded nothing.
      if (a.extractedText) queryText = `${queryText}\n${a.extractedText}`.trim();
      else if (a.embedding) vecs.push(a.embedding as number[]);
    }
  }

  if (queryText) {
    const textVec = await embedQuery(queryText, { orgId, purpose: opts.purpose ?? "search_query" });
    if (textVec) vecs.unshift(textVec);
  }
  return { queryText, vec: averageVectors(vecs), pendingAttachments };
}

type Row = Record<string, unknown>;

async function knn(table: string, orgId: string, vec: number[], where: string, limit: number): Promise<Row[]> {
  const res = await db.execute(sql`
    select id, 1 - (embedding <=> ${toVectorLiteral(vec)}::vector) as similarity
    from ${sql.raw(table)}
    where org_id = ${orgId} and embedding is not null ${sql.raw(where)}
    order by embedding <=> ${toVectorLiteral(vec)}::vector
    limit ${limit}
  `);
  return res.rows as Row[];
}

async function fts(table: string, orgId: string, query: string, where: string, limit: number): Promise<Row[]> {
  const res = await db.execute(sql`
    select id, ts_rank(search_text, q) as rank
    from ${sql.raw(table)}, websearch_to_tsquery('simple', ${query}) q
    where org_id = ${orgId} and search_text @@ q ${sql.raw(where)}
    order by rank desc
    limit ${limit}
  `);
  return res.rows as Row[];
}

export type HybridHit = {
  id: string;
  score: number;
  /** cosine similarity when the hit came from the vector half */
  similarity?: number;
  /** true when the hit matched the keyword (full-text) half */
  keyword?: boolean;
};

/**
 * Minimum cosine similarity for a vector-only hit to be presented as a
 * relevant suggestion (deflection, precedents). pgvector KNN always returns
 * the nearest rows no matter how far away they are, so without a floor an
 * unrelated query ("how do i make a coffee") would still surface the org's
 * printer articles. Calibrated on gemini-embedding-2: on-topic paraphrases
 * score ~0.75-0.85, unrelated queries ~0.45-0.55. Keyword (full-text) matches
 * are kept regardless — the user literally typed those words.
 */
export const MIN_SUGGESTION_SIMILARITY = 0.62;

export function relevantHits(hits: HybridHit[]): HybridHit[] {
  return hits.filter((h) => h.keyword || (h.similarity ?? 0) >= MIN_SUGGESTION_SIMILARITY);
}

async function hybrid(
  table: string,
  orgId: string,
  queryText: string,
  queryVec: number[] | null,
  where: string,
  limit: number,
): Promise<HybridHit[]> {
  const [vecRows, kwRows] = await Promise.all([
    queryVec ? knn(table, orgId, queryVec, where, limit * 3) : Promise.resolve([]),
    queryText.trim() ? fts(table, orgId, queryText, where, limit * 3) : Promise.resolve([]),
  ]);

  const fused = rrfFuse([
    vecRows.map((r) => ({ id: String(r.id), extra: { similarity: Number(r.similarity) } })),
    kwRows.map((r) => ({ id: String(r.id), extra: { keyword: true } })),
  ]);

  return fused.slice(0, limit).map((f) => ({
    id: f.id,
    score: f.score,
    similarity: typeof f.extra.similarity === "number" ? f.extra.similarity : undefined,
    keyword: f.extra.keyword === true,
  }));
}

// Articles table has no search_text column of its own; keyword search goes
// through the current revision (title+summary) and blocks.
async function articleFts(orgId: string, query: string, limit: number): Promise<Row[]> {
  const res = await db.execute(sql`
    select a.id, max(rank) as rank from (
      select ar.article_id as id, ts_rank(ar.search_text, websearch_to_tsquery('simple', ${query})) as rank
      from article_revisions ar
      join articles art on art.current_revision_id = ar.id
      where ar.org_id = ${orgId} and ar.search_text @@ websearch_to_tsquery('simple', ${query})
      union all
      select ab.article_id as id, ts_rank(ab.search_text, websearch_to_tsquery('simple', ${query})) as rank
      from article_blocks ab
      join articles art on art.current_revision_id = ab.revision_id
      where ab.org_id = ${orgId} and ab.search_text @@ websearch_to_tsquery('simple', ${query})
    ) hits
    join articles a on a.id = hits.id
    where a.status = 'published'
    group by a.id
    order by max(rank) desc
    limit ${limit}
  `);
  return res.rows as Row[];
}

/** Published-article search: powers deflection + KB browser + global search. */
export async function searchArticles(
  orgId: string,
  queryText: string,
  opts: { limit?: number; vec?: number[] | null } = {},
): Promise<HybridHit[]> {
  const limit = opts.limit ?? 8;
  const queryVec = opts.vec !== undefined ? opts.vec : await embedQuery(queryText, { orgId });

  const [vecRows, kwRows] = await Promise.all([
    queryVec ? knn("articles", orgId, queryVec, "and status = 'published'", limit * 3) : Promise.resolve([]),
    queryText.trim() ? articleFts(orgId, queryText, limit * 3) : Promise.resolve([]),
  ]);

  const fused = rrfFuse([
    vecRows.map((r) => ({ id: String(r.id), extra: { similarity: Number(r.similarity) } })),
    kwRows.map((r) => ({ id: String(r.id), extra: { keyword: true } })),
  ]);
  return fused.slice(0, limit).map((f) => ({
    id: f.id,
    score: f.score,
    similarity: typeof f.extra.similarity === "number" ? f.extra.similarity : undefined,
    keyword: f.extra.keyword === true,
  }));
}

/** Solved-request search: deflection ("solved this week") + supporter precedents. */
export async function searchSolvedRequests(
  orgId: string,
  queryText: string,
  opts: { limit?: number; vec?: number[] | null; excludeId?: string } = {},
): Promise<HybridHit[]> {
  const limit = opts.limit ?? 8;
  const vec = opts.vec !== undefined ? opts.vec : await embedQuery(queryText, { orgId });
  // excludeId is validated as a UUID before being inlined into the SQL fragment
  const isUuid = opts.excludeId && /^[0-9a-f-]{36}$/i.test(opts.excludeId);
  const exclude = isUuid ? `and id <> '${opts.excludeId}'` : "";
  return hybrid("requests", orgId, queryText, vec, `and status = 'solved' ${exclude}`, limit);
}

/** Resolution search: "same as last time" picker + mid-call lookup. */
export async function searchResolutions(
  orgId: string,
  queryText: string,
  opts: { limit?: number; vec?: number[] | null } = {},
): Promise<HybridHit[]> {
  const limit = opts.limit ?? 8;
  const vec = opts.vec !== undefined ? opts.vec : await embedQuery(queryText, { orgId });
  return hybrid("resolutions", orgId, queryText, vec, "", limit);
}

/** All requests (any status) for supporter global search. */
export async function searchAllRequests(
  orgId: string,
  queryText: string,
  opts: { limit?: number; vec?: number[] | null } = {},
): Promise<HybridHit[]> {
  const limit = opts.limit ?? 8;
  const vec = opts.vec !== undefined ? opts.vec : await embedQuery(queryText, { orgId });
  return hybrid("requests", orgId, queryText, vec, "", limit);
}

/** Chat search: human messages (replies + internal notes) for global search. */
export async function searchMessages(
  orgId: string,
  queryText: string,
  opts: { limit?: number; vec?: number[] | null } = {},
): Promise<HybridHit[]> {
  const limit = opts.limit ?? 8;
  const vec = opts.vec !== undefined ? opts.vec : await embedQuery(queryText, { orgId });
  return hybrid("messages", orgId, queryText, vec, "and kind in ('message', 'internal_note')", limit);
}
