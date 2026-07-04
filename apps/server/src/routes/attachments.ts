import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { requireAuth } from "../http/middleware.js";
import type { AppEnv } from "../http/context.js";
import { getStorage } from "../providers/storage/index.js";
import { enqueueEmbed } from "../workers/queues.js";

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

function kindOf(mimeType: string): "image" | "audio" | "file" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

export const attachmentRoutes = new Hono<AppEnv>();
// media is loaded by <img>/<Image>/audio players that can't set headers — accept ?token= like /api/stream
attachmentRoutes.use("*", async (c, next) => {
  const token = c.req.query("token");
  if (token && !c.req.header("authorization")) {
    c.req.raw.headers.set("authorization", `Bearer ${token}`);
  }
  await next();
});
attachmentRoutes.use("*", requireAuth());

/**
 * Upload (multipart). Attachments are created ownerless ("pending") and
 * re-parented when the request/message/resolution is created — this lets the
 * composer upload while the user is still typing.
 */
attachmentRoutes.post("/", async (c) => {
  const org = c.get("org");
  const user = c.get("user");

  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "multipart field 'file' is required" }, 400);
  if (file.size > MAX_SIZE) return c.json({ error: "file too large (max 25 MB)" }, 413);

  const mimeType = file.type || "application/octet-stream";
  const bytes = Buffer.from(await file.arrayBuffer());
  const storageKey = `${org.id}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;

  await getStorage().put(storageKey, bytes, mimeType);

  const [attachment] = await db
    .insert(tables.attachments)
    .values({
      orgId: org.id,
      ownerKind: "pending",
      ownerId: user.id,
      uploadedBy: user.id,
      filename: file.name,
      mimeType,
      sizeBytes: file.size,
      storageKey,
      kind: kindOf(mimeType),
    })
    .returning();

  // OCR / transcription + embedding happen async
  await enqueueEmbed("attachment", attachment.id);

  return c.json(
    {
      attachment: {
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        kind: attachment.kind,
        sizeBytes: attachment.sizeBytes,
      },
    },
    201,
  );
});

attachmentRoutes.get("/:id", async (c) => {
  const org = c.get("org");
  const attachment = await db.query.attachments.findFirst({
    where: and(eq(tables.attachments.id, c.req.param("id") ?? ""), eq(tables.attachments.orgId, org.id)),
  });
  if (!attachment) return c.json({ error: "not found" }, 404);
  const url = await getStorage().url(attachment.storageKey);
  return c.json({
    attachment: {
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      kind: attachment.kind,
      sizeBytes: attachment.sizeBytes,
      extractedText: attachment.extractedText,
      url,
    },
  });
});

/**
 * Raw file bytes (local driver). S3 driver clients use the signed URL instead.
 * Supports HTTP Range requests — iOS AVPlayer (voice-note playback) probes with
 * `Range: bytes=0-1` and refuses to play sources whose server ignores ranges.
 */
attachmentRoutes.get("/:id/raw", async (c) => {
  const org = c.get("org");
  const attachment = await db.query.attachments.findFirst({
    where: and(eq(tables.attachments.id, c.req.param("id") ?? ""), eq(tables.attachments.orgId, org.id)),
  });
  if (!attachment) return c.json({ error: "not found" }, 404);
  const data = await getStorage().get(attachment.storageKey);
  const size = data.length;
  const baseHeaders = {
    "content-type": attachment.mimeType,
    "content-disposition": `inline; filename="${attachment.filename.replace(/"/g, "")}"`,
    "cache-control": "private, max-age=3600",
    "accept-ranges": "bytes",
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header("range") ?? "");
  if (range && (range[1] || range[2])) {
    // "bytes=a-b", "bytes=a-" or suffix "bytes=-n"
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return c.body(null, 416, { "content-range": `bytes */${size}` });
    }
    const chunk = data.subarray(start, end + 1);
    return c.body(new Uint8Array(chunk).buffer as ArrayBuffer, 206, {
      ...baseHeaders,
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": String(chunk.length),
    });
  }

  return c.body(new Uint8Array(data).buffer as ArrayBuffer, 200, baseHeaders);
});
