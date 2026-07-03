import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { requireAuth, requireRole } from "../http/middleware.js";
import type { AppEnv } from "../http/context.js";
import { gapsAndHealth } from "../engine/clustering.js";

export const insightRoutes = new Hono<AppEnv>();
insightRoutes.use("*", requireAuth(), requireRole("supporter"));

/** Gaps & Health (supporter): documentation gaps ranked by impact + stale docs. */
insightRoutes.get("/gaps", async (c) => {
  const org = c.get("org");
  return c.json(await gapsAndHealth(org.id));
});

/**
 * Admin insights: deflection rate, knowledge coverage, recurring issues,
 * time-saved estimate — computed live from requests + events.
 */
insightRoutes.get("/", requireRole("admin"), async (c) => {
  const org = c.get("org");
  const days = Math.min(Number(c.req.query("days") ?? 30), 365);

  const totals = await db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where self_solved_article_id is not null)::int as self_solved,
      count(*) filter (where auto_answered and status = 'solved')::int as auto_answered_solved,
      count(*) filter (where status = 'solved')::int as solved,
      count(*) filter (where escalated)::int as escalated,
      avg(extract(epoch from (solved_at - created_at)) / 60) filter (where solved_at is not null) as avg_solve_minutes
    from requests
    where org_id = ${org.id} and created_at > now() - make_interval(days => ${days})
  `);
  const t = totals.rows[0] as Record<string, unknown>;

  const total = Number(t.total ?? 0);
  const selfSolved = Number(t.self_solved ?? 0);
  const autoSolved = Number(t.auto_answered_solved ?? 0);
  const deflected = selfSolved + autoSolved;
  const avgSolveMinutes = t.avg_solve_minutes == null ? 25 : Number(t.avg_solve_minutes);

  const coverage = await db.execute(sql`
    select
      count(*) filter (where article_id is not null)::int as covered,
      count(*)::int as clusters
    from clusters where org_id = ${org.id} and request_count >= 2
  `);
  const cov = coverage.rows[0] as Record<string, unknown>;

  const articles = await db.execute(sql`
    select
      count(*) filter (where status = 'published')::int as published,
      count(*) filter (where status = 'draft')::int as drafts,
      count(*) filter (where stale_flag)::int as stale
    from articles where org_id = ${org.id}
  `);
  const art = articles.rows[0] as Record<string, unknown>;

  // recurring issues heatmap: top clusters by requests in window
  const heatmap = await db.execute(sql`
    select c.id, c.label, c.article_id is not null as covered, count(r.id)::int as recent_requests
    from clusters c
    join requests r on r.cluster_id = c.id and r.created_at > now() - make_interval(days => ${days})
    where c.org_id = ${org.id}
    group by c.id
    order by recent_requests desc
    limit 10
  `);

  // per-week request volume vs deflections for the trend chart
  const trend = await db.execute(sql`
    select date_trunc('week', created_at)::date as week,
      count(*)::int as requests,
      count(*) filter (where self_solved_article_id is not null or (auto_answered and status = 'solved'))::int as deflected
    from requests
    where org_id = ${org.id} and created_at > now() - make_interval(days => ${days})
    group by 1 order by 1
  `);

  return c.json({
    windowDays: days,
    requests: {
      total,
      solved: Number(t.solved ?? 0),
      escalated: Number(t.escalated ?? 0),
      avgSolveMinutes: Math.round(avgSolveMinutes),
    },
    deflection: {
      selfSolved,
      autoAnswered: autoSolved,
      rate: total + deflected === 0 ? 0 : deflected / (total || 1),
      timeSavedHours: Math.round((deflected * avgSolveMinutes) / 60),
    },
    knowledge: {
      published: Number(art.published ?? 0),
      drafts: Number(art.drafts ?? 0),
      stale: Number(art.stale ?? 0),
      clusterCoverage: Number(cov.clusters ?? 0) === 0 ? 0 : Number(cov.covered) / Number(cov.clusters),
    },
    recurringIssues: (heatmap.rows as Record<string, unknown>[]).map((r) => ({
      clusterId: r.id,
      label: r.label,
      covered: Boolean(r.covered),
      recentRequests: Number(r.recent_requests),
    })),
    trend: (trend.rows as Record<string, unknown>[]).map((r) => ({
      week: r.week,
      requests: Number(r.requests),
      deflected: Number(r.deflected),
    })),
  });
});
