import { asc, eq, inArray } from "drizzle-orm";
import { db, tables } from "../db/index.js";

/**
 * Plain-text transcript of a request thread for LLM context: original request
 * plus every message (including internal notes — supporter-facing prompts
 * only), attributed and truncated so prompts stay bounded.
 */
export async function threadTranscript(
  requestId: string,
  opts: { maxMessages?: number; maxMessageChars?: number; maxTotalChars?: number } = {},
): Promise<string> {
  const { maxMessages = 40, maxMessageChars = 600, maxTotalChars = 6000 } = opts;

  const request = await db.query.requests.findFirst({ where: eq(tables.requests.id, requestId) });
  if (!request) return "";

  const msgs = await db
    .select()
    .from(tables.messages)
    .where(eq(tables.messages.requestId, requestId))
    .orderBy(asc(tables.messages.createdAt))
    .limit(maxMessages);

  const authorIds = [...new Set([request.authorId, ...msgs.map((m) => m.authorId)].filter(Boolean) as string[])];
  const people =
    authorIds.length > 0
      ? await db
          .select({ id: tables.users.id, name: tables.users.name })
          .from(tables.users)
          .where(inArray(tables.users.id, authorIds))
      : [];
  const nameOf = (id: string | null) => (id ? (people.find((p) => p.id === id)?.name ?? "Unknown") : null);

  const who = (m: (typeof msgs)[number]): string => {
    if (m.kind === "system") return "System";
    if (m.kind === "auto_answer") return "AI auto-answer";
    const name = nameOf(m.authorId) ?? "Unknown";
    const role = m.authorId && m.authorId === request.authorId ? "Requester" : "Supporter";
    return m.kind === "internal_note" ? `Internal note (${name})` : `${role} (${name})`;
  };

  const clip = (s: string) => (s.length > maxMessageChars ? `${s.slice(0, maxMessageChars)}…` : s);
  const lines = [
    `Requester (${nameOf(request.authorId) ?? request.guestName ?? "Guest"}): ${clip(`${request.title}. ${request.body}`)}`,
    ...msgs.map((m) => `${who(m)}: ${clip(m.body)}`),
  ];

  let out = lines.join("\n");
  if (out.length > maxTotalChars) out = `…${out.slice(out.length - maxTotalChars)}`;
  return out;
}
