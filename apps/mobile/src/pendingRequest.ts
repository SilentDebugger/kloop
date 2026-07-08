import type { AttachmentRef, RequestDetail, SessionUser } from "@kloop/shared";
import type { LocalAttachment } from "./ui/attachments";

/**
 * The home composer already uploaded attachments (it has ids + filenames +
 * kinds locally) before Send is enabled, so the pending thread can render
 * them immediately without a round trip — only the fields the thread needs
 * survive the navigation params.
 */
export type PendingAttachment = { id: string; filename: string; kind: string };

export function encodePendingAttachments(items: LocalAttachment[]): string | undefined {
  if (items.length === 0) return undefined;
  return JSON.stringify(items.map((a): PendingAttachment => ({ id: a.id, filename: a.filename, kind: a.kind })));
}

export function decodePendingAttachments(json?: string): PendingAttachment[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toAttachmentRef(a: PendingAttachment): AttachmentRef {
  return { id: a.id, filename: a.filename, mimeType: "", kind: a.kind === "image" || a.kind === "audio" ? a.kind : "file" };
}

/**
 * The instant, client-only stand-in for a `RequestDetail` shown the moment
 * the user taps Send — before the server has assigned a real id. Shaped to
 * match a genuinely fresh, unclaimed request so the thread renders exactly
 * like it will once `POST /api/requests` resolves (see `originalMessage` in
 * request/[id].tsx, which reads `request.body`/`request.title` straight off
 * this object).
 */
export function buildPendingDetail(draft: string, attachments: PendingAttachment[], user: SessionUser | null): RequestDetail {
  const now = new Date().toISOString();
  return {
    request: {
      id: "pending",
      ref: "",
      title: draft,
      body: draft,
      guestName: null,
      status: "open",
      channel: "mobile",
      tags: [],
      claimedBy: null,
      confirmationState: "none",
      autoAnswered: false,
      escalated: false,
      selfSolvedArticleId: null,
      unreadForRequester: false,
      unreadForSupporter: false,
      createdAt: now,
      solvedAt: null,
      lastActivityAt: now,
      author: user ? { id: user.id, name: user.name, email: user.email, role: user.role } : null,
    },
    messages: [],
    attachments: attachments.map(toAttachmentRef),
    resolutions: [],
  };
}
