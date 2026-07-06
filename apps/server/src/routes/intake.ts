import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { config } from "../config.js";
import { orgSettings, type AppEnv } from "../http/context.js";
import { nextCounter } from "../lib/counters.js";
import { recordEvent } from "../lib/events.js";
import { bus } from "../realtime/bus.js";
import { getStorage } from "../providers/storage/index.js";
import { enqueue, enqueueEmbed, QUEUES } from "../workers/queues.js";
import { logger } from "../lib/logger.js";

/**
 * Email-in intake: point your email provider's inbound webhook here.
 * Accepts SendGrid Inbound Parse, Mailgun Routes, and SES/SNS-style payloads
 * (JSON or multipart). Guarded by EMAIL_IN_SECRET:
 *   POST /api/intake/email?secret=<EMAIL_IN_SECRET>
 */
export const intakeRoutes = new Hono<AppEnv>();

type ParsedEmail = { from: string; subject: string; text: string };

function parseFields(fields: Record<string, unknown>): ParsedEmail | null {
  // SendGrid: from, subject, text | Mailgun: sender/from, subject, body-plain
  // SES-SNS (already unwrapped): mail.source + content
  const from =
    (fields.from as string) ??
    (fields.sender as string) ??
    ((fields.mail as Record<string, unknown>)?.source as string) ??
    "";
  const subject =
    (fields.subject as string) ??
    (((fields.mail as Record<string, unknown>)?.commonHeaders as Record<string, unknown>)?.subject as string) ??
    "";
  const text =
    (fields.text as string) ??
    (fields["body-plain"] as string) ??
    (fields.content as string) ??
    (fields.html as string) ??
    "";
  const emailMatch = from.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
  if (!emailMatch) return null;
  return { from: emailMatch[0].toLowerCase(), subject: subject || "(no subject)", text: stripHtml(text) };
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s{3,}/g, "\n").trim();
}

const MAX_EMAIL_ATTACHMENTS = 5;
const MAX_EMAIL_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB

function attachmentKindOf(mimeType: string): "image" | "audio" | "file" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

/**
 * Store email attachments (SendGrid/Mailgun post them as extra multipart File
 * entries) against the new request. Their OCR/transcripts feed back into the
 * request embedding via the existing attachment pipeline.
 */
async function ingestEmailAttachments(orgId: string, requestId: string, userId: string, files: File[]): Promise<number> {
  let stored = 0;
  for (const file of files.slice(0, MAX_EMAIL_ATTACHMENTS)) {
    if (file.size === 0 || file.size > MAX_EMAIL_ATTACHMENT_SIZE) continue;
    try {
      const mimeType = file.type || "application/octet-stream";
      const filename = file.name || `attachment-${stored + 1}`;
      const bytes = Buffer.from(await file.arrayBuffer());
      const storageKey = `${orgId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${filename.replace(/[^\w.\-]+/g, "_")}`;
      await getStorage().put(storageKey, bytes, mimeType);

      const [attachment] = await db
        .insert(tables.attachments)
        .values({
          orgId,
          ownerKind: "request",
          ownerId: requestId,
          uploadedBy: userId,
          filename,
          mimeType,
          sizeBytes: file.size,
          storageKey,
          kind: attachmentKindOf(mimeType),
        })
        .returning();
      await enqueueEmbed("attachment", attachment.id);
      stored++;
    } catch (err) {
      logger.error("email attachment ingest failed", { requestId, filename: file.name, err: String(err) });
    }
  }
  return stored;
}

intakeRoutes.post("/email", async (c) => {
  if (!config.EMAIL_IN_SECRET) return c.json({ error: "email intake is not configured (EMAIL_IN_SECRET)" }, 501);
  const secret = c.req.query("secret") ?? c.req.header("x-kloop-secret") ?? "";
  if (secret !== config.EMAIL_IN_SECRET) return c.json({ error: "unauthorized" }, 401);

  const org = c.get("org");
  if (!orgSettings(org).emailInEnabled) return c.json({ error: "email intake disabled for this org" }, 400);

  let fields: Record<string, unknown> = {};
  const files: File[] = [];
  const contentType = c.req.header("content-type") ?? "";
  try {
    if (contentType.includes("json")) {
      fields = await c.req.json();
    } else {
      const form = await c.req.formData();
      for (const [k, v] of form.entries()) {
        if (typeof v === "string") fields[k] = v;
        else if (v instanceof File) files.push(v);
      }
    }
  } catch {
    return c.json({ error: "unparseable payload" }, 400);
  }

  const parsed = parseFields(fields);
  if (!parsed) return c.json({ error: "no sender address found" }, 400);

  // find or JIT-create the requester
  let user = await db.query.users.findFirst({
    where: and(eq(tables.users.orgId, org.id), eq(tables.users.email, parsed.from)),
  });
  if (!user) {
    [user] = await db
      .insert(tables.users)
      .values({
        orgId: org.id,
        email: parsed.from,
        name: parsed.from.split("@")[0],
        role: "requester",
      })
      .returning();
  }

  const refNumber = await nextCounter(org.id, "request");
  const [request] = await db
    .insert(tables.requests)
    .values({
      orgId: org.id,
      refNumber,
      authorId: user.id,
      title: parsed.subject.slice(0, 500),
      body: parsed.text.slice(0, 20_000),
      channel: "email",
    })
    .returning();

  const storedAttachments = await ingestEmailAttachments(org.id, request.id, user.id, files);

  await enqueueEmbed("request", request.id);
  await enqueue(QUEUES.autoTag, { requestId: request.id });
  await enqueue(QUEUES.autoAnswer, { requestId: request.id }, { startAfterSeconds: 8 });
  await recordEvent(org.id, "user", user.id, "request_created", {
    requestId: request.id,
    ref: `REQ-${refNumber}`,
    title: request.title,
    channel: "email",
  });
  bus.publish(org.id, {
    type: "request_created",
    supporterOnly: true,
    data: { id: request.id, ref: `REQ-${refNumber}`, title: request.title, status: request.status, channel: "email" },
  });

  logger.info("email intake accepted", { ref: `REQ-${refNumber}`, from: parsed.from, attachments: storedAttachments });
  return c.json({ ok: true, ref: `REQ-${refNumber}`, attachments: storedAttachments }, 201);
});
