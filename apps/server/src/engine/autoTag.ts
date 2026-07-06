import { eq, sql } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { getLlmProvider, extractJson } from "../providers/llm/index.js";
import { recordEvent } from "../lib/events.js";
import { bus } from "../realtime/bus.js";
import { logger } from "../lib/logger.js";

/**
 * Auto-tagging (queued on request creation): the LLM picks 1–3 lowercase tags,
 * strongly preferring the org's existing vocabulary so the taxonomy converges
 * instead of fragmenting. Tags power queue filters and per-tag tier overrides.
 */
export async function autoTagRequest(requestId: string): Promise<string[]> {
  const request = await db.query.requests.findFirst({ where: eq(tables.requests.id, requestId) });
  if (!request || request.tags.length > 0) return []; // already tagged (manually or by a retry)

  // org vocabulary: every distinct tag in use across requests and articles
  const vocabRows = await db.execute(sql`
    select tag from (
      select unnest(tags) as tag from requests where org_id = ${request.orgId}
      union all
      select unnest(tags) as tag from articles where org_id = ${request.orgId}
    ) t group by tag order by count(*) desc limit 40
  `);
  const vocabulary = vocabRows.rows.map((r) => String((r as Record<string, unknown>).tag));

  let tags: string[];
  try {
    const raw = await getLlmProvider().complete({
      system:
        "You tag helpdesk requests. Return 1-3 short lowercase tags (single words or hyphenated, e.g. \"vpn\", \"printer\", \"password-reset\"). " +
        "STRONGLY prefer tags from the provided vocabulary when they fit; only invent a new tag when nothing fits. " +
        'Output strict JSON: {"tags": string[]}.',
      prompt: JSON.stringify({ title: request.title, body: request.body.slice(0, 800), vocabulary }),
      json: true,
      orgId: request.orgId,
      task: "auto_tag",
      data: { title: request.title, body: request.body, vocabulary },
    });
    tags = extractJson<{ tags: string[] }>(raw).tags ?? [];
  } catch (err) {
    logger.error("auto-tag failed", { requestId, err: String(err) });
    return [];
  }

  const clean = [...new Set(tags.map((t) => t.toLowerCase().trim().replace(/\s+/g, "-").slice(0, 30)).filter(Boolean))].slice(0, 3);
  if (clean.length === 0) return [];

  await db.update(tables.requests).set({ tags: clean }).where(eq(tables.requests.id, requestId));
  await recordEvent(request.orgId, "ai", null, "request_auto_tagged", { requestId, tags: clean });
  bus.publish(request.orgId, { type: "request_updated", data: { id: requestId, tags: clean } });
  return clean;
}
