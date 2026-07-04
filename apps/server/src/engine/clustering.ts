import { and, eq, isNull, sql } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { getLlmProvider, extractJson } from "../providers/llm/index.js";
import { recordEvent } from "../lib/events.js";
import { notifyUser } from "../lib/notify.js";
import { logger } from "../lib/logger.js";

const ASSIGN_THRESHOLD = 0.78; // request joins a cluster above this centroid similarity
const ARTICLE_MATCH_THRESHOLD = 0.82; // cluster considered "covered" by an article
const GAP_MIN_REQUESTS = 3; // documentation gap = this much mass without an article

function vecLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => x / norm);
}

/**
 * Incremental threshold-based agglomerative clustering over request vectors.
 * Runs continuously (cron): each unclustered embedded request either joins the
 * nearest cluster (centroid updated incrementally) or seeds a new one.
 * High-mass clusters without an article are documentation gaps.
 */
export async function clusterScan(orgId: string): Promise<{ assigned: number; gaps: number }> {
  const pending = await db
    .select()
    .from(tables.requests)
    .where(
      and(
        eq(tables.requests.orgId, orgId),
        isNull(tables.requests.clusterId),
        eq(tables.requests.embeddingStatus, "ok"),
      ),
    )
    .limit(200);

  let assigned = 0;
  const touched = new Set<string>();

  for (const request of pending) {
    const vec = request.embedding as number[] | null;
    if (!vec) continue;

    const nearest = await db.execute(sql`
      select id, request_count, 1 - (centroid <=> ${vecLiteral(vec)}::vector) as sim
      from clusters
      where org_id = ${orgId} and centroid is not null
      order by centroid <=> ${vecLiteral(vec)}::vector
      limit 1
    `);
    const hit = nearest.rows[0] as { id: string; request_count: number; sim: number } | undefined;

    let clusterId: string;
    if (hit && Number(hit.sim) >= ASSIGN_THRESHOLD) {
      clusterId = String(hit.id);
      const cluster = await db.query.clusters.findFirst({ where: eq(tables.clusters.id, clusterId) });
      if (cluster?.centroid) {
        const n = cluster.requestCount;
        const centroid = cluster.centroid as number[];
        const updated = normalize(centroid.map((x, i) => (x * n + vec[i]) / (n + 1)));
        await db
          .update(tables.clusters)
          .set({
            centroid: updated,
            requestCount: n + 1,
            lastRequestAt: request.createdAt,
            updatedAt: new Date(),
          })
          .where(eq(tables.clusters.id, clusterId));
      }
    } else {
      const [cluster] = await db
        .insert(tables.clusters)
        .values({
          orgId,
          centroid: vec,
          requestCount: 1,
          label: null,
          lastRequestAt: request.createdAt,
        })
        .returning();
      clusterId = cluster.id;
    }

    // time spent feeds gap ranking (mass x handling cost)
    const minutes =
      request.solvedAt && request.createdAt
        ? Math.min(480, Math.max(1, (request.solvedAt.getTime() - request.createdAt.getTime()) / 60_000))
        : 0;
    if (minutes > 0) {
      await db
        .update(tables.clusters)
        .set({ totalMinutesSpent: sql`${tables.clusters.totalMinutesSpent} + ${minutes}` })
        .where(eq(tables.clusters.id, clusterId));
    }

    await db.update(tables.requests).set({ clusterId }).where(eq(tables.requests.id, request.id));
    touched.add(clusterId);
    assigned++;
  }

  // label new multi-member clusters + link them to covering articles
  for (const clusterId of touched) {
    await labelAndLinkCluster(orgId, clusterId);
  }

  const gaps = await detectGaps(orgId);
  return { assigned, gaps };
}

async function labelAndLinkCluster(orgId: string, clusterId: string): Promise<void> {
  const cluster = await db.query.clusters.findFirst({ where: eq(tables.clusters.id, clusterId) });
  if (!cluster) return;

  if (!cluster.label && cluster.requestCount >= 2) {
    const members = await db
      .select({ title: tables.requests.title })
      .from(tables.requests)
      .where(eq(tables.requests.clusterId, clusterId))
      .limit(10);
    try {
      const raw = await getLlmProvider().complete({
        system: 'Label this group of similar helpdesk requests. Output strict JSON: {"label": string (3-6 words, lowercase)}.',
        prompt: JSON.stringify(members.map((m) => m.title)),
        json: true,
        orgId,
        task: "cluster_label",
        data: { titles: members.map((m) => m.title) },
      });
      const { label } = extractJson<{ label: string }>(raw);
      if (label) await db.update(tables.clusters).set({ label }).where(eq(tables.clusters.id, clusterId));
    } catch (err) {
      logger.warn("cluster labeling failed", { clusterId, err: String(err) });
    }
  }

  if (!cluster.articleId && cluster.centroid) {
    const match = await db.execute(sql`
      select id, 1 - (embedding <=> ${vecLiteral(cluster.centroid as number[])}::vector) as sim
      from articles
      where org_id = ${orgId} and status = 'published' and embedding is not null
      order by embedding <=> ${vecLiteral(cluster.centroid as number[])}::vector
      limit 1
    `);
    const hit = match.rows[0] as { id: string; sim: number } | undefined;
    if (hit && Number(hit.sim) >= ARTICLE_MATCH_THRESHOLD) {
      await db.update(tables.clusters).set({ articleId: String(hit.id) }).where(eq(tables.clusters.id, clusterId));
    }
  }
}

/** Gap = high-mass cluster without an article. Alert once per cluster. */
async function detectGaps(orgId: string): Promise<number> {
  const gaps = await db
    .select()
    .from(tables.clusters)
    .where(and(eq(tables.clusters.orgId, orgId), isNull(tables.clusters.articleId), sql`request_count >= ${GAP_MIN_REQUESTS}`));

  let alerted = 0;
  for (const gap of gaps) {
    const already = await db.execute(sql`
      select 1 from events
      where org_id = ${orgId} and type = 'gap_alert' and payload->>'clusterId' = ${gap.id}
      limit 1
    `);
    if (already.rows.length > 0) continue;

    await recordEvent(orgId, "system", null, "gap_alert", {
      clusterId: gap.id,
      label: gap.label,
      requestCount: gap.requestCount,
      totalMinutesSpent: gap.totalMinutesSpent,
    });

    const supporters = await db.execute(sql`
      select id from users where org_id = ${orgId} and role in ('supporter','admin') and deactivated_at is null
    `);
    for (const row of supporters.rows as { id: string }[]) {
      await notifyUser({
        orgId,
        userId: row.id,
        type: "gap_alert",
        title: `Documentation gap: "${gap.label ?? "unlabeled issue"}" (${gap.requestCount} requests, no article)`,
        linkPath: "/kb/gaps",
      });
    }
    alerted++;
  }
  return alerted;
}

/** Gaps & Health payload: clusters ranked by impact (mass x time cost). */
export async function gapsAndHealth(orgId: string) {
  const gapClusters = await db.execute(sql`
    select c.id, c.label, c.request_count, c.total_minutes_spent, c.last_request_at,
           (select json_agg(t.title) from (
              select title from requests where cluster_id = c.id order by created_at desc limit 3
           ) t) as sample_titles
    from clusters c
    where c.org_id = ${orgId} and c.article_id is null and c.request_count >= 2
    order by c.request_count * greatest(c.total_minutes_spent, 1) desc
    limit 25
  `);

  const staleArticles = await db.execute(sql`
    select a.id, a.kb_number, a.freshness_score, a.stale_reason, a.updated_at, ar.title
    from articles a
    join article_revisions ar on ar.id = a.current_revision_id
    where a.org_id = ${orgId} and a.status = 'published' and (a.stale_flag or a.freshness_score < 0.5)
    order by a.freshness_score asc
    limit 25
  `);

  return {
    gaps: (gapClusters.rows as Record<string, unknown>[]).map((r) => ({
      clusterId: r.id,
      label: r.label,
      requestCount: Number(r.request_count),
      minutesSpent: Math.round(Number(r.total_minutes_spent)),
      lastRequestAt: r.last_request_at,
      sampleTitles: r.sample_titles ?? [],
    })),
    staleArticles: (staleArticles.rows as Record<string, unknown>[]).map((r) => ({
      id: r.id,
      kb: `KB-${String(r.kb_number).padStart(3, "0")}`,
      title: r.title,
      freshnessScore: Number(r.freshness_score),
      staleReason: r.stale_reason,
      updatedAt: r.updated_at,
    })),
  };
}
