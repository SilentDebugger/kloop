import { Hono, type Context } from "hono";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { requireAuth, requireRole } from "../http/middleware.js";
import { orgSettings, type AppEnv } from "../http/context.js";
import { nextCounter } from "../lib/counters.js";
import { recordEvent } from "../lib/events.js";
import { notifyUser } from "../lib/notify.js";
import { bus } from "../realtime/bus.js";
import { enqueueEmbed, enqueue, QUEUES } from "../workers/queues.js";

export const requestRoutes = new Hono<AppEnv>();
requestRoutes.use("*", requireAuth());

const userCols = {
  id: tables.users.id,
  name: tables.users.name,
  email: tables.users.email,
  role: tables.users.role,
};

function requestSummary(r: typeof tables.requests.$inferSelect) {
  return {
    id: r.id,
    ref: `REQ-${r.refNumber}`,
    title: r.title,
    body: r.body,
    status: r.status,
    channel: r.channel,
    tags: r.tags,
    claimedBy: r.claimedBy,
    confirmationState: r.confirmationState,
    autoAnswered: r.autoAnswered,
    escalated: r.escalated,
    selfSolvedArticleId: r.selfSolvedArticleId,
    unreadForRequester: r.unreadForRequester,
    unreadForSupporter: r.unreadForSupporter,
    createdAt: r.createdAt,
    solvedAt: r.solvedAt,
    lastActivityAt: r.lastActivityAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadOwnedRequest(c: Context<AppEnv, any>) {
  const org = c.get("org");
  const user = c.get("user");
  const id = c.req.param("id") ?? "";
  const request = await db.query.requests.findFirst({
    where: and(eq(tables.requests.id, id), eq(tables.requests.orgId, org.id)),
  });
  if (!request) return { error: c.json({ error: "not found" }, 404) } as const;
  if (user.role === "requester" && request.authorId !== user.id) {
    return { error: c.json({ error: "not found" }, 404) } as const;
  }
  return { request } as const;
}

// ---------------------------------------------------------------------------
// Create (one-box composer / API / email-in adds channel)
// ---------------------------------------------------------------------------

requestRoutes.post("/", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const body = z
    .object({
      title: z.string().min(1).max(500),
      body: z.string().max(20_000).default(""),
      channel: z.enum(["web", "mobile", "email", "api"]).default("web"),
      tags: z.array(z.string()).max(10).default([]),
      attachmentIds: z.array(z.string().uuid()).max(10).default([]),
    })
    .parse(await c.req.json());

  const refNumber = await nextCounter(org.id, "request");
  const [request] = await db
    .insert(tables.requests)
    .values({
      orgId: org.id,
      refNumber,
      authorId: user.id,
      title: body.title,
      body: body.body,
      channel: body.channel,
      tags: body.tags,
    })
    .returning();

  if (body.attachmentIds.length > 0) {
    await db
      .update(tables.attachments)
      .set({ ownerKind: "request", ownerId: request.id })
      .where(
        and(
          inArray(tables.attachments.id, body.attachmentIds),
          eq(tables.attachments.orgId, org.id),
          eq(tables.attachments.ownerKind, "pending"),
        ),
      );
  }

  await enqueueEmbed("request", request.id);
  await recordEvent(org.id, "user", user.id, "request_created", {
    requestId: request.id,
    ref: `REQ-${refNumber}`,
    title: request.title,
    channel: body.channel,
  });
  bus.publish(org.id, { type: "request_created", supporterOnly: true, data: requestSummary(request) });

  // Tier 2/3 automation: try auto-answering once the embedding lands.
  await enqueue(QUEUES.autoAnswer, { requestId: request.id }, { startAfterSeconds: 8 });

  return c.json({ request: requestSummary(request) }, 201);
});

/**
 * Deflection success — "this solved it" on a suggestion while composing.
 * Records a solved request for the requester's history + the north-star metric.
 */
requestRoutes.post("/self-solve", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const body = z
    .object({
      title: z.string().min(1).max(500),
      body: z.string().max(20_000).default(""),
      articleId: z.string().uuid(),
    })
    .parse(await c.req.json());

  const refNumber = await nextCounter(org.id, "request");
  const now = new Date();
  const [request] = await db
    .insert(tables.requests)
    .values({
      orgId: org.id,
      refNumber,
      authorId: user.id,
      title: body.title,
      body: body.body,
      status: "solved",
      solvedAt: now,
      selfSolvedArticleId: body.articleId,
      confirmationState: "confirmed",
      unreadForSupporter: false,
    })
    .returning();

  await db
    .update(tables.articles)
    .set({ solveCount: sql`${tables.articles.solveCount} + 1` })
    .where(and(eq(tables.articles.id, body.articleId), eq(tables.articles.orgId, org.id)));

  await enqueueEmbed("request", request.id);
  await recordEvent(org.id, "user", user.id, "deflection_accepted", {
    requestId: request.id,
    articleId: body.articleId,
    title: body.title,
  });
  return c.json({ request: requestSummary(request) }, 201);
});

// ---------------------------------------------------------------------------
// Lists: requester history & supporter queue
// ---------------------------------------------------------------------------

requestRoutes.get("/", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const q = c.req.query();

  const conditions = [eq(tables.requests.orgId, org.id)];

  if (user.role === "requester" || q.mine === "authored") {
    conditions.push(eq(tables.requests.authorId, user.id));
  } else {
    // supporter queue filters
    const filter = q.filter ?? "all";
    if (filter === "unassigned") conditions.push(isNull(tables.requests.claimedBy), eq(tables.requests.status, "open"));
    if (filter === "mine") conditions.push(eq(tables.requests.claimedBy, user.id));
    if (q.status) conditions.push(eq(tables.requests.status, q.status));
    if (q.tag) conditions.push(sql`${q.tag} = any(${tables.requests.tags})`);
    if (q.channel) conditions.push(eq(tables.requests.channel, q.channel));
    if (filter === "all" && !q.status && q.includeSolved !== "true") {
      conditions.push(or(eq(tables.requests.status, "open"), eq(tables.requests.status, "handled"))!);
    }
  }

  const rows = await db
    .select()
    .from(tables.requests)
    .where(and(...conditions))
    .orderBy(desc(tables.requests.lastActivityAt))
    .limit(Math.min(Number(q.limit ?? 100), 200));

  // authors + claimers resolved in one shot for the queue cards
  const userIds = [...new Set(rows.flatMap((r) => [r.authorId, r.claimedBy].filter(Boolean) as string[]))];
  const people =
    userIds.length > 0
      ? await db.select(userCols).from(tables.users).where(inArray(tables.users.id, userIds))
      : [];
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));

  return c.json({
    requests: rows.map((r) => ({
      ...requestSummary(r),
      author: byId[r.authorId] ?? null,
      claimer: r.claimedBy ? (byId[r.claimedBy] ?? null) : null,
    })),
  });
});

// ---------------------------------------------------------------------------
// Detail + thread
// ---------------------------------------------------------------------------

requestRoutes.get("/:id", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const loaded = await loadOwnedRequest(c);
  if ("error" in loaded) return loaded.error;
  const { request } = loaded;

  const isSupporter = user.role !== "requester";
  const msgs = await db
    .select()
    .from(tables.messages)
    .where(eq(tables.messages.requestId, request.id))
    .orderBy(tables.messages.createdAt);
  const visibleMsgs = isSupporter ? msgs : msgs.filter((m) => m.kind !== "internal_note");

  const atts = await db
    .select()
    .from(tables.attachments)
    .where(
      and(
        eq(tables.attachments.orgId, org.id),
        or(
          and(eq(tables.attachments.ownerKind, "request"), eq(tables.attachments.ownerId, request.id)),
          msgs.length > 0
            ? and(
                eq(tables.attachments.ownerKind, "message"),
                inArray(tables.attachments.ownerId, msgs.map((m) => m.id)),
              )
            : sql`false`,
        ),
      ),
    );

  const resolutionRows = await db
    .select()
    .from(tables.resolutions)
    .where(eq(tables.resolutions.requestId, request.id))
    .orderBy(desc(tables.resolutions.createdAt));

  const userIds = [
    ...new Set([
      request.authorId,
      ...(request.claimedBy ? [request.claimedBy] : []),
      ...visibleMsgs.map((m) => m.authorId).filter(Boolean),
    ] as string[]),
  ];
  const people = await db.select(userCols).from(tables.users).where(inArray(tables.users.id, userIds));
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));

  // mark read for the viewer's side
  if (isSupporter && request.unreadForSupporter) {
    await db.update(tables.requests).set({ unreadForSupporter: false }).where(eq(tables.requests.id, request.id));
  } else if (!isSupporter && request.unreadForRequester) {
    await db.update(tables.requests).set({ unreadForRequester: false }).where(eq(tables.requests.id, request.id));
  }

  // requester context for the workbench header: past request count
  const [pastCount] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tables.requests)
    .where(and(eq(tables.requests.orgId, org.id), eq(tables.requests.authorId, request.authorId)));

  return c.json({
    request: {
      ...requestSummary(request),
      author: byId[request.authorId] ?? null,
      claimer: request.claimedBy ? (byId[request.claimedBy] ?? null) : null,
      authorPastRequests: pastCount?.n ?? 1,
    },
    messages: visibleMsgs.map((m) => ({
      id: m.id,
      kind: m.kind,
      body: m.body,
      articleId: m.articleId,
      fromAiDraft: m.fromAiDraft,
      author: m.authorId ? (byId[m.authorId] ?? null) : null,
      createdAt: m.createdAt,
      attachments: atts
        .filter((a) => a.ownerKind === "message" && a.ownerId === m.id)
        .map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, kind: a.kind })),
    })),
    attachments: atts
      .filter((a) => a.ownerKind === "request")
      .map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, kind: a.kind })),
    resolutions: isSupporter
      ? resolutionRows.map((r) => ({
          id: r.id,
          captureKind: r.captureKind,
          rawCaptureText: r.rawCaptureText,
          structuredSummary: r.structuredSummary,
          trusted: r.trusted,
          linkedResolutionId: r.linkedResolutionId,
          articleId: r.articleId,
          createdAt: r.createdAt,
        }))
      : [],
  });
});

// ---------------------------------------------------------------------------
// Thread messages
// ---------------------------------------------------------------------------

requestRoutes.post("/:id/messages", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const loaded = await loadOwnedRequest(c);
  if ("error" in loaded) return loaded.error;
  const { request } = loaded;

  const body = z
    .object({
      body: z.string().min(1).max(20_000),
      kind: z.enum(["message", "internal_note"]).default("message"),
      fromAiDraft: z.boolean().default(false),
      attachmentIds: z.array(z.string().uuid()).max(10).default([]),
    })
    .parse(await c.req.json());

  const isSupporter = user.role !== "requester";
  if (body.kind === "internal_note" && !isSupporter) return c.json({ error: "forbidden" }, 403);

  const [message] = await db
    .insert(tables.messages)
    .values({
      orgId: org.id,
      requestId: request.id,
      authorId: user.id,
      kind: body.kind,
      body: body.body,
      fromAiDraft: body.fromAiDraft,
    })
    .returning();

  if (body.attachmentIds.length > 0) {
    await db
      .update(tables.attachments)
      .set({ ownerKind: "message", ownerId: message.id })
      .where(
        and(
          inArray(tables.attachments.id, body.attachmentIds),
          eq(tables.attachments.orgId, org.id),
          eq(tables.attachments.ownerKind, "pending"),
        ),
      );
  }

  const patch: Partial<typeof tables.requests.$inferInsert> = { lastActivityAt: new Date(), updatedAt: new Date() };
  if (body.kind === "message") {
    if (isSupporter) {
      patch.unreadForRequester = true;
      // a requester replying to a solved request does not reopen it; a supporter reply on open claims-ish
      if (request.status === "open" && !request.claimedBy) {
        patch.claimedBy = user.id;
        patch.claimedAt = new Date();
        patch.status = "handled";
      }
    } else {
      patch.unreadForSupporter = true;
    }
  }
  await db.update(tables.requests).set(patch).where(eq(tables.requests.id, request.id));

  // supporter replies get embedded (mining undocumented answers)
  if (isSupporter && body.kind === "message") await enqueueEmbed("message", message.id);

  if (body.kind === "message") {
    const notifyTarget = isSupporter ? request.authorId : (request.claimedBy ?? null);
    if (notifyTarget && notifyTarget !== user.id) {
      await notifyUser({
        orgId: org.id,
        userId: notifyTarget,
        type: "reply",
        title: `${user.name} replied — ${request.title.slice(0, 60)}`,
        body: body.body.slice(0, 140),
        linkPath: `/requests/${request.id}`,
      });
    }
  }

  bus.publish(org.id, {
    type: "message_created",
    supporterOnly: body.kind === "internal_note",
    data: {
      requestId: request.id,
      message: {
        id: message.id,
        kind: message.kind,
        body: message.body,
        author: { id: user.id, name: user.name, role: user.role },
        createdAt: message.createdAt,
      },
    },
  });

  await recordEvent(org.id, "user", user.id, "message_created", { requestId: request.id, kind: body.kind });
  return c.json({ message: { id: message.id, kind: message.kind, body: message.body, createdAt: message.createdAt } }, 201);
});

// ---------------------------------------------------------------------------
// Queue actions (supporter)
// ---------------------------------------------------------------------------

requestRoutes.post("/:id/claim", requireRole("supporter"), async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const loaded = await loadOwnedRequest(c);
  if ("error" in loaded) return loaded.error;
  const { request } = loaded;

  const [updated] = await db
    .update(tables.requests)
    .set({ claimedBy: user.id, claimedAt: new Date(), status: request.status === "open" ? "handled" : request.status, lastActivityAt: new Date() })
    .where(eq(tables.requests.id, request.id))
    .returning();

  await recordEvent(org.id, "user", user.id, "request_claimed", { requestId: request.id });
  await notifyUser({
    orgId: org.id,
    userId: request.authorId,
    type: "status_change",
    title: `Your request is being handled — ${request.title.slice(0, 60)}`,
    linkPath: `/requests/${request.id}`,
  });
  bus.publish(org.id, { type: "request_updated", data: requestSummary(updated) });
  return c.json({ request: requestSummary(updated) });
});

requestRoutes.post("/:id/assign", requireRole("supporter"), async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const loaded = await loadOwnedRequest(c);
  if ("error" in loaded) return loaded.error;
  const { request } = loaded;
  const body = z.object({ userId: z.string().uuid().nullable() }).parse(await c.req.json());

  if (body.userId) {
    const target = await db.query.users.findFirst({
      where: and(eq(tables.users.id, body.userId), eq(tables.users.orgId, org.id)),
    });
    if (!target || target.role === "requester") return c.json({ error: "invalid assignee" }, 400);
  }

  const [updated] = await db
    .update(tables.requests)
    .set({
      claimedBy: body.userId,
      claimedAt: body.userId ? new Date() : null,
      status: body.userId ? (request.status === "open" ? "handled" : request.status) : "open",
      lastActivityAt: new Date(),
    })
    .where(eq(tables.requests.id, request.id))
    .returning();

  await recordEvent(org.id, "user", user.id, "request_assigned", { requestId: request.id, assignee: body.userId });
  if (body.userId && body.userId !== user.id) {
    await notifyUser({
      orgId: org.id,
      userId: body.userId,
      type: "status_change",
      title: `${user.name} handed you a request — ${request.title.slice(0, 60)}`,
      linkPath: `/requests/${request.id}`,
    });
  }
  bus.publish(org.id, { type: "request_updated", data: requestSummary(updated) });
  return c.json({ request: requestSummary(updated) });
});

// ---------------------------------------------------------------------------
// Confirmation loop, reopen, rating
// ---------------------------------------------------------------------------

requestRoutes.post("/:id/confirm", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const loaded = await loadOwnedRequest(c);
  if ("error" in loaded) return loaded.error;
  const { request } = loaded;

  if (request.authorId !== user.id) return c.json({ error: "only the requester can confirm" }, 403);
  if (request.confirmationState !== "pending") return c.json({ error: "nothing to confirm" }, 400);

  const body = z.object({ fixed: z.boolean() }).parse(await c.req.json());

  if (body.fixed) {
    const [updated] = await db
      .update(tables.requests)
      .set({ status: "solved", solvedAt: new Date(), confirmationState: "confirmed", lastActivityAt: new Date() })
      .where(eq(tables.requests.id, request.id))
      .returning();

    // user confirmation = trusted resolution signal for learning
    await db
      .update(tables.resolutions)
      .set({ trusted: true })
      .where(eq(tables.resolutions.requestId, request.id));

    await recordEvent(org.id, "user", user.id, "request_confirmed", { requestId: request.id });
    if (request.claimedBy) {
      await notifyUser({
        orgId: org.id,
        userId: request.claimedBy,
        type: "status_change",
        title: `Fix confirmed — ${request.title.slice(0, 60)}`,
        linkPath: `/requests/${request.id}`,
      });
    }
    bus.publish(org.id, { type: "request_updated", data: requestSummary(updated) });
    return c.json({ request: requestSummary(updated) });
  }

  // "not yet" — reopen and escalate if it was auto-answered
  const [updated] = await db
    .update(tables.requests)
    .set({
      status: request.claimedBy ? "handled" : "open",
      confirmationState: "rejected",
      escalated: request.autoAnswered ? true : request.escalated,
      unreadForSupporter: true,
      lastActivityAt: new Date(),
    })
    .where(eq(tables.requests.id, request.id))
    .returning();

  await recordEvent(org.id, "user", user.id, "confirmation_rejected", {
    requestId: request.id,
    wasAutoAnswered: request.autoAnswered,
  });
  if (request.claimedBy) {
    await notifyUser({
      orgId: org.id,
      userId: request.claimedBy,
      type: "status_change",
      title: `"Not fixed yet" — ${request.title.slice(0, 60)}`,
      linkPath: `/requests/${request.id}`,
    });
  }
  bus.publish(org.id, { type: "request_updated", data: requestSummary(updated) });
  return c.json({ request: requestSummary(updated) });
});

requestRoutes.post("/:id/reopen", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const loaded = await loadOwnedRequest(c);
  if ("error" in loaded) return loaded.error;
  const { request } = loaded;

  if (request.status !== "solved") return c.json({ error: "request is not solved" }, 400);
  const graceDays = orgSettings(org).reopenGraceDays;
  if (request.solvedAt && Date.now() - request.solvedAt.getTime() > graceDays * 24 * 3600 * 1000) {
    return c.json({ error: `reopen window (${graceDays} days) has passed — create a new request` }, 400);
  }

  const [updated] = await db
    .update(tables.requests)
    .set({
      status: request.claimedBy ? "handled" : "open",
      confirmationState: "none",
      solvedAt: null,
      reopenCount: request.reopenCount + 1,
      unreadForSupporter: true,
      lastActivityAt: new Date(),
    })
    .where(eq(tables.requests.id, request.id))
    .returning();

  await recordEvent(org.id, "user", user.id, "request_reopened", { requestId: request.id });
  bus.publish(org.id, { type: "request_updated", data: requestSummary(updated) });
  return c.json({ request: requestSummary(updated) });
});

requestRoutes.post("/:id/rate", async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const loaded = await loadOwnedRequest(c);
  if ("error" in loaded) return loaded.error;
  const { request } = loaded;
  if (request.authorId !== user.id) return c.json({ error: "only the requester can rate" }, 403);

  const body = z.object({ satisfaction: z.number().int().min(1).max(5) }).parse(await c.req.json());
  await db.update(tables.requests).set({ satisfaction: body.satisfaction }).where(eq(tables.requests.id, request.id));
  await recordEvent(org.id, "user", user.id, "request_rated", { requestId: request.id, satisfaction: body.satisfaction });
  return c.json({ ok: true });
});
