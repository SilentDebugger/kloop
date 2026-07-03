import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
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

export async function embedQuery(text: string): Promise<number[] | null> {
  try {
    const [vec] = await getEmbeddingProvider().embed([text]);
    return vec ?? null;
  } catch (err) {
    logger.warn("query embedding failed — falling back to keyword-only search", { err: String(err) });
    return null;
  }
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

export type HybridHit = { id: string; score: number; similarity?: number };

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
    kwRows.map((r) => ({ id: String(r.id) })),
  ]);

  return fused.slice(0, limit).map((f) => ({
    id: f.id,
    score: f.score,
    similarity: typeof f.extra.similarity === "number" ? f.extra.similarity : undefined,
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
  const queryVec = opts.vec !== undefined ? opts.vec : await embedQuery(queryText);

  const [vecRows, kwRows] = await Promise.all([
    queryVec ? knn("articles", orgId, queryVec, "and status = 'published'", limit * 3) : Promise.resolve([]),
    queryText.trim() ? articleFts(orgId, queryText, limit * 3) : Promise.resolve([]),
  ]);

  const fused = rrfFuse([
    vecRows.map((r) => ({ id: String(r.id), extra: { similarity: Number(r.similarity) } })),
    kwRows.map((r) => ({ id: String(r.id) })),
  ]);
  return fused.slice(0, limit).map((f) => ({
    id: f.id,
    score: f.score,
    similarity: typeof f.extra.similarity === "number" ? f.extra.similarity : undefined,
  }));
}

/** Solved-request search: deflection ("solved this week") + supporter precedents. */
export async function searchSolvedRequests(
  orgId: string,
  queryText: string,
  opts: { limit?: number; vec?: number[] | null; excludeId?: string } = {},
): Promise<HybridHit[]> {
  const limit = opts.limit ?? 8;
  const vec = opts.vec !== undefined ? opts.vec : await embedQuery(queryText);
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
  const vec = opts.vec !== undefined ? opts.vec : await embedQuery(queryText);
  return hybrid("resolutions", orgId, queryText, vec, "", limit);
}

/** All requests (any status) for supporter global search. */
export async function searchAllRequests(
  orgId: string,
  queryText: string,
  opts: { limit?: number; vec?: number[] | null } = {},
): Promise<HybridHit[]> {
  const limit = opts.limit ?? 8;
  const vec = opts.vec !== undefined ? opts.vec : await embedQuery(queryText);
  return hybrid("requests", orgId, queryText, vec, "", limit);
}
