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
    guestName: r.guestName,
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

/** Status events rendered inline in the thread ("Maya is now handling this request"). */
async function addSystemMessage(orgId: string, requestId: string, body: string): Promise<void> {
  const [message] = await db
    .insert(tables.messages)
    .values({ orgId, requestId, kind: "system", body })
    .returning();
  bus.publish(orgId, {
    type: "message_created",
    data: {
      requestId,
      message: { id: message.id, kind: "system", body, author: null, createdAt: message.createdAt },
    },
  });
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
      /** supporters can log a request for a user — or a guest without an account */
      onBehalf: z
        .object({
          userId: z.string().uuid().optional(),
          guestName: z.string().trim().min(1).max(120).optional(),
        })
        .refine((v) => !!v.userId !== !!v.guestName, { message: "exactly one of userId or guestName" })
        .optional(),
    })
    .parse(await c.req.json());

  let author: { id: string } | null = { id: user.id };
  if (body.onBehalf) {
    if (user.role === "requester") return c.json({ error: "forbidden" }, 403);
    if (body.onBehalf.userId) {
      const target = await db.query.users.findFirst({
        where: and(eq(tables.users.id, body.onBehalf.userId), eq(tables.users.orgId, org.id)),
      });
      if (!target) return c.json({ error: "user not found" }, 404);
      author = { id: target.id };
    } else {
      author = null; // guest — tracked by name only
    }
  }

  const refNumber = await nextCounter(org.id, "request");
  const [request] = await db
    .insert(tables.requests)
    .values({
      orgId: org.id,
      refNumber,
      authorId: author?.id ?? null,
      guestName: body.onBehalf?.guestName ?? null,
      title: body.title,
      body: body.body,
      channel: body.channel,
      tags: body.tags,
      // the supporter logging it is already handling it
      ...(body.onBehalf ? { claimedBy: user.id, claimedAt: new Date(), status: "handled" } : {}),
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
    ...(body.onBehalf ? { onBehalf: true } : {}),
  });
  bus.publish(org.id, { type: "request_created", supporterOnly: true, data: requestSummary(request) });

  if (body.onBehalf) {
    // no auto-answer — the supporter logging it is already on it
    if (author && author.id !== user.id) {
      await notifyUser({
        orgId: org.id,
        userId: author.id,
        type: "system",
        title: `${user.name} opened a request for you — ${request.title.slice(0, 60)}`,
        body: "You'll get updates here as it's worked on.",
        linkPath: `/requests/${request.id}`,
      });
    }
  } else {
    // Tier 2/3 automation: try auto-answering once the embedding lands.
    await enqueue(QUEUES.autoAnswer, { requestId: request.id }, { startAfterSeconds: 8 });
  }

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
      author: r.authorId ? (byId[r.authorId] ?? null) : null,
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

  const resolutionRows = await db
    .select()
    .from(tables.resolutions)
    .where(eq(tables.resolutions.requestId, request.id))
    .orderBy(desc(tables.resolutions.createdAt));

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
          resolutionRows.length > 0
            ? and(
                eq(tables.attachments.ownerKind, "resolution"),
                inArray(tables.attachments.ownerId, resolutionRows.map((r) => r.id)),
              )
            : sql`false`,
        ),
      ),
    );

  const userIds = [
    ...new Set(
      [
        request.authorId,
        request.claimedBy,
        ...visibleMsgs.map((m) => m.authorId),
        ...resolutionRows.map((r) => r.supporterId),
      ].filter(Boolean) as string[],
    ),
  ];
  const people =
    userIds.length > 0 ? await db.select(userCols).from(tables.users).where(inArray(tables.users.id, userIds)) : [];
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));

  // mark read for the viewer's side
  if (isSupporter && request.unreadForSupporter) {
    await db.update(tables.requests).set({ unreadForSupporter: false }).where(eq(tables.requests.id, request.id));
  } else if (!isSupporter && request.unreadForRequester) {
    await db.update(tables.requests).set({ unreadForRequester: false }).where(eq(tables.requests.id, request.id));
  }

  // requester context for the workbench header: past request count (guests have no history)
  const [pastCount] = request.authorId
    ? await db
        .select({ n: sql<number>`count(*)::int` })
        .from(tables.requests)
        .where(and(eq(tables.requests.orgId, org.id), eq(tables.requests.authorId, request.authorId)))
    : [{ n: 1 }];

  return c.json({
    request: {
      ...requestSummary(request),
      author: request.authorId ? (byId[request.authorId] ?? null) : null,
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
          supporterName: byId[r.supporterId]?.name ?? null,
          attachments: atts
            .filter((a) => a.ownerKind === "resolution" && a.ownerId === r.id)
            .map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, kind: a.kind })),
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
      body: z.string().max(20_000).default(""),
      kind: z.enum(["message", "internal_note"]).default("message"),
      fromAiDraft: z.boolean().default(false),
      attachmentIds: z.array(z.string().uuid()).max(10).default([]),
    })
    .refine((v) => v.body.trim().length > 0 || v.attachmentIds.length > 0, {
      message: "message body or attachments required",
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
  if (patch.claimedBy) {
    // replying to an unclaimed request implicitly claims it — tell the thread
    await addSystemMessage(org.id, request.id, `${user.name} is now handling this request.`);
  }

  // every human chat message gets embedded — supporter replies feed answer
  // mining, and the whole thread becomes findable in global search. Image/voice-
  // only messages count too: their OCR/transcript joins the message embedding.
  if (body.body.trim() || body.attachmentIds.length > 0) await enqueueEmbed("message", message.id);

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
  await addSystemMessage(org.id, request.id, `${user.name} is now handling this request.`);
  if (request.authorId) {
    await notifyUser({
      orgId: org.id,
      userId: request.authorId,
      type: "status_change",
      title: `Your request is being handled — ${request.title.slice(0, 60)}`,
      linkPath: `/requests/${request.id}`,
    });
  }
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

  let assigneeName: string | null = null;
  if (body.userId) {
    const target = await db.query.users.findFirst({
      where: and(eq(tables.users.id, body.userId), eq(tables.users.orgId, org.id)),
    });
    if (!target || target.role === "requester") return c.json({ error: "invalid assignee" }, 400);
    assigneeName = target.name;
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
  await addSystemMessage(
    org.id,
    request.id,
    assigneeName ? `${assigneeName} is now handling this request.` : "This request went back to the queue.",
  );
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
    await addSystemMessage(org.id, request.id, `${user.name} confirmed the fix. Request solved.`);
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
  await addSystemMessage(org.id, request.id, `${user.name} reported the fix didn't help yet.`);
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
  await addSystemMessage(org.id, request.id, `${user.name} reopened this request.`);
  bus.publish(org.id, { type: "request_updated", data: requestSummary(updated) });
  return c.json({ request: requestSummary(updated) });
});

// ---------------------------------------------------------------------------
// Resolution capture (<30s) + precedents
// ---------------------------------------------------------------------------

/**
 * "Done — resolve": capture what fixed it (free text / voice / photo / log),
 * mark the request resolved, trigger the requester confirmation loop, and
 * feed the knowledge engine (structure -> embed -> article generation).
 */
requestRoutes.post("/:id/resolve", requireRole("supporter"), async (c) => {
  const org = c.get("org");
  const user = c.get("user");
  const loaded = await loadOwnedRequest(c);
  if ("error" in loaded) return loaded.error;
  const { request } = loaded;

  const body = z
    .object({
      rawCaptureText: z.string().max(20_000).default(""),
      captureKind: z.enum(["text", "voice", "photo", "command", "mixed"]).default("text"),
      linkedResolutionId: z.string().uuid().nullable().default(null),
      attachmentIds: z.array(z.string().uuid()).max(10).default([]),
      /** capture skipped — resolve without feeding the loop (discouraged, allowed) */
      skipCapture: z.boolean().default(false),
    })
    .parse(await c.req.json());

  if (request.status === "solved") return c.json({ error: "already solved" }, 400);

  let resolutionId: string | null = null;
  if (!body.skipCapture) {
    let raw = body.rawCaptureText;
    let linked: typeof tables.resolutions.$inferSelect | null = null;

    // "same as last time" — inherit the linked resolution's capture when empty
    if (body.linkedResolutionId) {
      linked =
        (await db.query.resolutions.findFirst({
          where: and(eq(tables.resolutions.id, body.linkedResolutionId), eq(tables.resolutions.orgId, org.id)),
        })) ?? null;
      if (linked && !raw.trim()) raw = linked.rawCaptureText;
    }

    const [resolution] = await db
      .insert(tables.resolutions)
      .values({
        orgId: org.id,
        requestId: request.id,
        supporterId: user.id,
        rawCaptureText: raw,
        captureKind: body.captureKind,
        linkedResolutionId: linked?.id ?? null,
        structuredSummary: linked?.structuredSummary ?? null,
        articleId: linked?.articleId ?? null,
      })
      .returning();
    resolutionId = resolution.id;

    if (body.attachmentIds.length > 0) {
      await db
        .update(tables.attachments)
        .set({ ownerKind: "resolution", ownerId: resolution.id })
        .where(
          and(
            inArray(tables.attachments.id, body.attachmentIds),
            eq(tables.attachments.orgId, org.id),
            eq(tables.attachments.ownerKind, "pending"),
          ),
        );
    }

    await enqueue(QUEUES.structure, { resolutionId: resolution.id });

    if (linked) {
      // strong recurrence signal
      await recordEvent(org.id, "user", user.id, "resolution_linked", {
        resolutionId: resolution.id,
        linkedTo: linked.id,
      });
    }
  }

  // Guest requests have nobody to confirm the fix — resolving closes them.
  const [updated] = await db
    .update(tables.requests)
    .set({
      claimedBy: request.claimedBy ?? user.id,
      claimedAt: request.claimedAt ?? new Date(),
      lastActivityAt: new Date(),
      ...(request.authorId
        ? { status: "handled", confirmationState: "pending", unreadForRequester: true }
        : { status: "solved", solvedAt: new Date(), confirmationState: "confirmed" }),
    })
    .where(eq(tables.requests.id, request.id))
    .returning();

  await recordEvent(org.id, "user", user.id, "request_resolved", {
    requestId: request.id,
    resolutionId,
    captureKind: body.captureKind,
    skippedCapture: body.skipCapture,
  });
  await addSystemMessage(org.id, request.id, `${user.name} marked this as resolved.`);
  if (request.authorId) {
    await notifyUser({
      orgId: org.id,
      userId: request.authorId,
      type: "status_change",
      title: `Did this fix it? — ${request.title.slice(0, 60)}`,
      body: "A supporter marked your request as resolved. Confirm to close it.",
      linkPath: `/requests/${request.id}`,
    });
  }
  bus.publish(org.id, { type: "request_updated", data: requestSummary(updated) });
  return c.json({ request: requestSummary(updated), resolutionId });
});

/** Tier 1+ AI reply draft for the workbench — grounded in articles + precedents. */
requestRoutes.get("/:id/ai-draft", requireRole("supporter"), async (c) => {
  const loaded = await loadOwnedRequest(c);
  if ("error" in loaded) return loaded.error;
  const { draftReply } = await import("../engine/automation.js");
  const draft = await draftReply(loaded.request);
  if (!draft) return c.json({ draft: null, reason: "automation tier 0 or drafting unavailable" });
  return c.json({ draft });
});

/** AI precedents: similar solved requests + matched articles for the workbench. */
requestRoutes.get("/:id/precedents", requireRole("supporter"), async (c) => {
  const loaded = await loadOwnedRequest(c);
  if ("error" in loaded) return loaded.error;
  const { precedentsFor } = await import("../engine/precedents.js");
  return c.json(await precedentsFor(loaded.request));
});

/** "Same as last time" picker: this supporter's recent similar resolutions. */
requestRoutes.get("/:id/similar-resolutions", requireRole("supporter"), async (c) => {
  const org = c.get("org");
  const loaded = await loadOwnedRequest(c);
  if ("error" in loaded) return loaded.error;
  const { request } = loaded;

  const { searchResolutions, relevantHits } = await import("../search/hybrid.js");
  // relevantHits drops far-away vector matches — better an empty list than
  // "top 3 nearest whatever they are"
  const hits = relevantHits(
    await searchResolutions(org.id, `${request.title}\n${request.body}`, {
      vec: (request.embedding as number[] | null) ?? undefined,
      limit: 8,
    }),
  );
  if (hits.length === 0) return c.json({ resolutions: [] });

  const rows = await db
    .select({
      id: tables.resolutions.id,
      requestId: tables.resolutions.requestId,
      structuredSummary: tables.resolutions.structuredSummary,
      rawCaptureText: tables.resolutions.rawCaptureText,
      supporterId: tables.resolutions.supporterId,
      createdAt: tables.resolutions.createdAt,
    })
    .from(tables.resolutions)
    .where(inArray(tables.resolutions.id, hits.map((h) => h.id)));

  const reqRows = await db
    .select({ id: tables.requests.id, refNumber: tables.requests.refNumber, title: tables.requests.title })
    .from(tables.requests)
    .where(inArray(tables.requests.id, rows.map((r) => r.requestId)));
  const supporters = await db
    .select({ id: tables.users.id, name: tables.users.name })
    .from(tables.users)
    .where(inArray(tables.users.id, [...new Set(rows.map((r) => r.supporterId))]));

  const reqById = Object.fromEntries(reqRows.map((r) => [r.id, r]));
  const supById = Object.fromEntries(supporters.map((s) => [s.id, s.name]));

  // one entry per source request (a re-solved request has several resolution
  // rows — hits are score-ordered, so the best one wins), never the request
  // currently being resolved, at most 3
  const seenRequests = new Set<string>([request.id]);
  const resolutions: object[] = [];
  for (const h of hits) {
    const r = rows.find((x) => x.id === h.id);
    if (!r || seenRequests.has(r.requestId)) continue;
    seenRequests.add(r.requestId);
    const req = reqById[r.requestId];
    resolutions.push({
      id: r.id,
      ref: req ? `REQ-${req.refNumber}` : "",
      requestTitle: req?.title ?? "",
      summary: r.structuredSummary ?? r.rawCaptureText.slice(0, 200),
      supporterName: supById[r.supporterId] ?? null,
      createdAt: r.createdAt,
    });
    if (resolutions.length >= 3) break;
  }

  return c.json({ resolutions });
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
