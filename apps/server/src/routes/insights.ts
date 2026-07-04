import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { requireAuth, requireRole } from "../http/middleware.js";
import type { AppEnv } from "../http/context.js";
import { gapsAndHealth } from "../engine/clustering.js";
import { ratesFor } from "../lib/aiUsage.js";

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

  // ---- AI cost analytics ----------------------------------------------------
  // The ai_usage ledger is append-only, one row per provider API call, with the
  // exact token counts the provider reported. Aggregating it is the source of
  // truth — no derived caches to go stale.
  const aiTotals = await db.execute(sql`
    select
      count(*)::int as calls,
      coalesce(sum(cost_usd), 0) as cost,
      coalesce(sum(input_tokens), 0)::bigint as input_tokens,
      coalesce(sum(cached_tokens), 0)::bigint as cached_tokens,
      coalesce(sum(output_tokens), 0)::bigint as output_tokens,
      coalesce(sum(image_tokens + audio_tokens), 0)::bigint as media_tokens,
      count(*) filter (where not exact)::int as estimated_calls
    from ai_usage
    where org_id = ${org.id} and created_at > now() - make_interval(days => ${days})
  `);
  const ai = aiTotals.rows[0] as Record<string, unknown>;

  const aiByModel = await db.execute(sql`
    select provider, model, count(*)::int as calls, sum(cost_usd) as cost,
      sum(input_tokens)::bigint as input_tokens,
      sum(cached_tokens)::bigint as cached_tokens,
      sum(output_tokens)::bigint as output_tokens,
      sum(image_tokens + audio_tokens)::bigint as media_tokens,
      sum(media_seconds) as media_seconds
    from ai_usage
    where org_id = ${org.id} and created_at > now() - make_interval(days => ${days})
    group by provider, model
    order by cost desc
  `);

  const aiByPurpose = await db.execute(sql`
    select coalesce(purpose, 'other') as purpose, count(*)::int as calls, sum(cost_usd) as cost
    from ai_usage
    where org_id = ${org.id} and created_at > now() - make_interval(days => ${days})
    group by 1
    order by cost desc
  `);

  const aiByDay = await db.execute(sql`
    select date_trunc('day', created_at)::date as day, count(*)::int as calls, sum(cost_usd) as cost
    from ai_usage
    where org_id = ${org.id} and created_at > now() - make_interval(days => ${days})
    group by 1
    order by 1
  `);

  // what prompt caching saved: cached tokens billed at the discounted rate
  // instead of the full input rate
  let cacheSavingsUsd = 0;
  for (const r of aiByModel.rows as Record<string, unknown>[]) {
    const rates = ratesFor(String(r.provider), String(r.model));
    if (!rates?.inputPerM) continue;
    const discount = rates.inputPerM - (rates.cachedInputPerM ?? rates.inputPerM);
    cacheSavingsUsd += (Number(r.cached_tokens ?? 0) / 1e6) * discount;
  }

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
    ai: {
      totalCostUsd: Number(ai.cost ?? 0),
      calls: Number(ai.calls ?? 0),
      estimatedCalls: Number(ai.estimated_calls ?? 0),
      cacheSavingsUsd,
      tokens: {
        input: Number(ai.input_tokens ?? 0),
        cached: Number(ai.cached_tokens ?? 0),
        output: Number(ai.output_tokens ?? 0),
        media: Number(ai.media_tokens ?? 0),
      },
      byModel: (aiByModel.rows as Record<string, unknown>[]).map((r) => ({
        provider: String(r.provider),
        model: String(r.model),
        calls: Number(r.calls),
        costUsd: Number(r.cost ?? 0),
        inputTokens: Number(r.input_tokens ?? 0),
        cachedTokens: Number(r.cached_tokens ?? 0),
        outputTokens: Number(r.output_tokens ?? 0),
        mediaTokens: Number(r.media_tokens ?? 0),
        mediaSeconds: Number(r.media_seconds ?? 0),
      })),
      byPurpose: (aiByPurpose.rows as Record<string, unknown>[]).map((r) => ({
        purpose: String(r.purpose),
        calls: Number(r.calls),
        costUsd: Number(r.cost ?? 0),
      })),
      byDay: (aiByDay.rows as Record<string, unknown>[]).map((r) => ({
        day: r.day,
        calls: Number(r.calls),
        costUsd: Number(r.cost ?? 0),
      })),
    },
  });
});
