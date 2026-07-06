import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { autoAnswerSkipLabel, type AttachmentRef, type MessageView, type RequestDetail } from "@kloop/shared";
import { api } from "../../lib/api";
import { isSupporter as roleIsSupporter, useAuth } from "../../lib/auth";
import { clockTime, sentLabel } from "../../lib/format";
import { useVoiceRecorder } from "../../lib/recorder";
import { Button, Card, Chip, ErrorState, SectionLabel, Spinner, StatusBadge } from "../../ui";
import { IconCheck, IconMic, IconPaperclip, IconSend, IconSparkle, IconX } from "../../ui/icons";
import { BackBar } from "../shared/BackBar";
import { ResolveSheet } from "./ResolveSheet";

export function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuth((s) => s.user);
  const supporter = roleIsSupporter(user);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["request", id],
    queryFn: () => api.requestDetail(id!),
    enabled: !!id,
    refetchInterval: 30_000,
  });

  if (error && !data) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />;
  if (isLoading || !data) {
    return (
      <div className="flex justify-center pt-24">
        <Spinner size={26} />
      </div>
    );
  }

  return supporter && data.request.author?.id !== user?.id ? (
    <WorkbenchView detail={data} />
  ) : (
    <RequesterThreadView detail={data} />
  );
}

/* ===================================================================== */
/* Requester thread — status timeline + confirm loop                     */
/* ===================================================================== */

/**
 * What was sent when the request was created, rendered like a chat message —
 * the intake photo / voice note would otherwise be invisible in the thread.
 */
function originalMessage({ request, attachments }: RequestDetail): MessageView | null {
  if (!request.body.trim() && attachments.length === 0) return null;
  return {
    id: "original",
    kind: "message",
    body: request.body,
    author: request.author ?? (request.guestName ? { id: "guest", name: request.guestName } : null),
    createdAt: request.createdAt,
    attachments,
  };
}

function RequesterThreadView({ detail }: { detail: RequestDetail }) {
  const { t } = useTranslation();
  const { request, messages } = detail;
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();

  const confirm = useMutation({
    mutationFn: (fixed: boolean) => api.confirm(request.id, fixed),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["request", request.id] }),
  });
  const reopen = useMutation({
    mutationFn: () => api.reopen(request.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["request", request.id] }),
  });

  const resolverName =
    request.claimer?.name ?? messages.filter((m) => m.author && m.author.id !== user?.id).at(-1)?.author?.name ?? "Support";

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-4 pt-4">
      <BackBar
        title={request.title}
        subtitle={`Sent ${sentLabel(request.createdAt)}`}
        right={<StatusBadge status={request.status} />}
      />

      <StatusTimeline status={request.status} />

      <div className="flex flex-col gap-3 pb-44">
        {[originalMessage(detail), ...messages].map(
          (m) => m && <MessageBubble key={m.id} m={m} ownId={user?.id ?? ""} />,
        )}

        {request.confirmationState === "pending" && (
          <div className="fade-up rounded-card bg-mint p-5">
            <div className="text-[17px] font-bold text-ink">{t("thread.didThisFixIt")}</div>
            <div className="mt-0.5 text-[13px] text-ink-secondary">
              {request.autoAnswered && !request.claimer
                ? "kloop suggested this fix automatically."
                : `${resolverName} marked this as resolved.`}
            </div>
            <div className="mt-4 flex gap-2.5">
              <Button className="flex-1" loading={confirm.isPending} onClick={() => confirm.mutate(true)}>
                {t("thread.yesFixed")}
              </Button>
              <Button variant="outline" className="flex-1" disabled={confirm.isPending} onClick={() => confirm.mutate(false)}>
                {t("thread.notYet")}
              </Button>
            </div>
          </div>
        )}

        {request.status === "solved" && (
          <div className="mt-1 text-center">
            <button className="text-[13px] font-semibold text-ink-secondary underline underline-offset-2 cursor-pointer"
              onClick={() => reopen.mutate()} disabled={reopen.isPending}>
              Something's still wrong — {t("thread.reopen").toLowerCase()}
            </button>
            {reopen.isError && <div className="mt-1 text-[12px] text-danger">{(reopen.error as Error).message}</div>}
          </div>
        )}
      </div>

      <Composer requestId={request.id} />
    </div>
  );
}

function StatusTimeline({ status }: { status: string }) {
  const steps = [
    { key: "open", label: "Sent" },
    { key: "handled", label: "Being handled" },
    { key: "solved", label: "Solved" },
  ];
  const reached = status === "solved" ? 2 : status === "handled" ? 1 : 0;
  return (
    <div className="my-5 px-1">
      <div className="relative flex items-center">
        <div className="absolute inset-x-1 h-[3px] rounded-full bg-line" />
        <div
          className="absolute left-1 h-[3px] rounded-full bg-primary transition-all"
          style={{ width: `${(reached / 2) * 100}%` }}
        />
        {steps.map((s, i) => (
          <div key={s.key} className="relative flex-1">
            <div
              className={`relative z-10 h-3.5 w-3.5 rounded-full border-2 ${
                i <= reached ? "border-primary bg-primary" : "border-line bg-bg"
              } ${i === 1 ? "mx-auto" : i === 2 ? "ml-auto" : ""}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[12px] font-semibold">
        {steps.map((s, i) => (
          <span key={s.key} className={i <= reached ? "text-primary" : "text-ink-faint"}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ===================================================================== */
/* Supporter workbench — precedents, internal notes, AI draft, resolve   */
/* ===================================================================== */

function WorkbenchView({ detail }: { detail: RequestDetail }) {
  const { request, messages } = detail;
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const [resolveOpen, setResolveOpen] = useState(false);

  const { data: precedents } = useQuery({
    queryKey: ["precedents", request.id],
    queryFn: () => api.precedents(request.id),
    staleTime: 5 * 60_000,
  });

  const claim = useMutation({
    mutationFn: () => api.claim(request.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["request", request.id] });
      void qc.invalidateQueries({ queryKey: ["requests"] });
    },
  });

  const mine = request.claimedBy === user?.id;
  const similar = precedents?.similarSolved ?? [];
  const matched = precedents?.matchedArticles ?? [];

  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-4 pt-4">
      <BackBar
        title={request.title}
        subtitle={
          <>
            {request.ref} · {request.author?.name ?? "Unknown"} ·{" "}
            {request.authorPastRequests != null ? `${request.authorPastRequests} past requests` : ""}
            {request.escalated ? " · escalated" : ""}
          </>
        }
        right={
          request.status === "open" && !request.claimedBy ? (
            <Button size="sm" variant="secondary" loading={claim.isPending} onClick={() => claim.mutate()}>
              Claim
            </Button>
          ) : (
            <StatusBadge status={request.status === "handled" ? "handled" : request.status} />
          )
        }
      />

      {/* supporter-only: why the AI stayed out of this thread */}
      {detail.autoAnswerSkip && (
        <div className="fade-up mt-4 flex items-center gap-2.5 rounded-inner bg-surface px-4 py-2.5 text-[13px] font-medium text-ink-secondary">
          <span aria-hidden>✦</span>
          <span className="min-w-0 flex-1">{autoAnswerSkipLabel(detail.autoAnswerSkip)}</span>
          {detail.autoAnswerSkip.articleId && (
            <Link to={`/kb/${detail.autoAnswerSkip.articleId}`} className="shrink-0 font-semibold text-primary">
              View article ›
            </Link>
          )}
        </div>
      )}

      {/* precedents banner */}
      {(similar.length > 0 || matched.length > 0) && (
        <div className="fade-up mt-4 rounded-card bg-mint p-4">
          <SectionLabel className="!text-primary">
            Precedents · {similar.length} similar solved
          </SectionLabel>
          {similar.length > 0 && (
            <p className="mt-1.5 text-[14px] leading-snug text-ink">
              {similar.map((s) => s.ref).join(", ")}
              {similar[0]?.resolution?.summary ? ` — ${similar[0].resolution.summary.slice(0, 120)}` : ""}
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {matched.slice(0, 2).map((a) => (
              <Link key={a.id} to={`/kb/${a.id}`} className="rounded-full bg-card px-3 py-1.5 text-[13px] font-semibold text-ink shadow-sm">
                {a.kb} · {a.title.length > 30 ? `${a.title.slice(0, 30)}…` : a.title}
              </Link>
            ))}
            {similar.slice(0, 2).map((s) => (
              <Link key={s.id} to={`/requests/${s.id}`} className="text-[13px] font-semibold text-primary">
                View {s.ref} ›
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 pb-52">
        {[originalMessage(detail), ...messages].map(
          (m) => m && <MessageBubble key={m.id} m={m} ownId={user?.id ?? ""} />,
        )}

        {request.status !== "solved" && (
          <div className="mt-2 flex justify-center">
            <button
              onClick={() => (mine || request.claimedBy ? setResolveOpen(true) : claim.mutate(undefined, { onSuccess: () => setResolveOpen(true) }))}
              className="inline-flex items-center gap-2 rounded-full bg-card px-5 py-2.5 text-[14px] font-semibold text-primary shadow-card transition-shadow hover:shadow-float cursor-pointer"
            >
              <IconCheck size={16} /> Mark resolved
            </button>
          </div>
        )}
        {request.confirmationState === "pending" && (
          <div className="text-center text-[13px] text-ink-secondary">Waiting for {request.author?.name ?? "the requester"} to confirm the fix.</div>
        )}
      </div>

      <Composer requestId={request.id} supporter />

      <ResolveSheet
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        requestId={request.id}
        onResolved={() => {
          setResolveOpen(false);
          void qc.invalidateQueries({ queryKey: ["request", request.id] });
          void qc.invalidateQueries({ queryKey: ["requests"] });
        }}
      />
    </div>
  );
}

/* ===================================================================== */
/* Shared pieces                                                         */
/* ===================================================================== */

function MessageBubble({ m, ownId }: { m: MessageView; ownId: string }) {
  if (m.kind === "system") {
    return <div className="py-1 text-center text-[12px] text-ink-faint">{m.body}</div>;
  }
  if (m.kind === "internal_note") {
    return (
      <div className="rounded-card bg-note-bg p-4">
        <SectionLabel className="!text-note-label">Internal note</SectionLabel>
        <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{m.body}</p>
        <div className="mt-1.5 text-[12px] text-ink-secondary">
          {m.author?.name} · {clockTime(m.createdAt)}
        </div>
      </div>
    );
  }

  const own = m.author?.id === ownId;
  const meta = [
    own ? null : (m.author?.name ?? (m.kind === "auto_answer" ? "kloop" : "System")),
    clockTime(m.createdAt),
    m.fromAiDraft ? "from AI draft, edited" : null,
    m.kind === "auto_answer" ? "auto-answer" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={`max-w-[85%] rounded-bubble p-3.5 ${
        own ? "self-end rounded-br-[6px] bg-primary text-white" : "self-start rounded-bl-[6px] bg-card shadow-card"
      }`}
    >
      <p className={`whitespace-pre-wrap text-[15px] leading-relaxed ${own ? "text-white" : "text-ink"}`}>{m.body}</p>
      {m.attachments && m.attachments.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {m.attachments.map((a) => (
            <AttachmentPreview key={a.id} a={a} light={own} />
          ))}
        </div>
      )}
      {m.articleId && (
        <Link to={`/kb/${m.articleId}`} className={`mt-2 inline-block text-[13px] font-semibold underline underline-offset-2 ${own ? "text-white" : "text-primary"}`}>
          View the article ›
        </Link>
      )}
      <div className={`mt-1 text-[11px] ${own ? "text-right text-white/70" : "text-ink-secondary"}`}>{meta}</div>
    </div>
  );
}

export function AttachmentPreview({ a, light }: { a: AttachmentRef; light?: boolean }) {
  const url = api.attachmentRawUrl(a.id);
  if (a.kind === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt={a.filename} className="max-h-40 rounded-inner object-cover" />
      </a>
    );
  }
  if (a.kind === "audio") {
    return <audio controls src={url} className="h-9 max-w-full" />;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium ${light ? "bg-white/20 text-white" : "bg-chip text-ink"}`}
    >
      <IconPaperclip size={13} /> {a.filename}
    </a>
  );
}

function Composer({ requestId, supporter }: { requestId: string; supporter?: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const [fromDraft, setFromDraft] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; filename: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorder = useVoiceRecorder();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // AI draft (supporters): every click generates a fresh draft from the current thread
  const draft = useMutation({
    mutationFn: () => api.aiDraft(requestId),
    onSuccess: (res) => {
      if (res.draft) {
        setText(res.draft.body);
        setFromDraft(true);
        inputRef.current?.focus();
      }
    },
  });

  const send = useMutation({
    mutationFn: () =>
      api.postMessage(requestId, {
        body: text.trim(),
        kind: note ? "internal_note" : "message",
        fromAiDraft: fromDraft,
        attachmentIds: attachments.map((a) => a.id),
      }),
    onSuccess: () => {
      setText("");
      setAttachments([]);
      setFromDraft(false);
      setNote(false);
      void qc.invalidateQueries({ queryKey: ["request", requestId] });
    },
  });

  const upload = async (blob: Blob, name: string) => {
    const res = await api.upload({ blob, name });
    setAttachments((a) => [...a, { id: res.attachment.id, filename: res.attachment.filename }]);
  };

  const toggleVoice = async () => {
    if (recorder.recording) {
      const noteBlob = await recorder.stop();
      if (noteBlob) await upload(noteBlob.blob, noteBlob.name);
    } else {
      await recorder.start().catch(() => {});
    }
  };

  const canSend = text.trim().length > 0 && !send.isPending;

  return (
    <div className="fixed inset-x-0 bottom-16 z-20 px-3 pb-2 md:bottom-0 md:pl-60">
      <div className="mx-auto max-w-2xl">
        {supporter && (
          <div className="mb-2 flex items-center gap-2 px-1">
            <Chip onClick={() => !draft.isPending && draft.mutate()} className="!bg-mint !text-primary">
              <IconSparkle size={14} /> {draft.isPending ? "Drafting…" : fromDraft ? "Redraft" : "AI draft"}
            </Chip>
            <Chip onClick={() => setNote((n) => !n)} active={note}>
              Internal note
            </Chip>
            {fromDraft && draft.data?.draft?.groundedIn.articleTitle && (
              <span className="text-[12px] text-ink-secondary">grounded in {draft.data.draft.groundedIn.articleTitle}</span>
            )}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
            {attachments.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full bg-mint px-3 py-1 text-[12px] font-medium text-primary">
                {a.filename}
                <button onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))} className="cursor-pointer" aria-label="Remove">
                  <IconX size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className={`flex items-end gap-2 rounded-[26px] p-2 shadow-float ${note ? "bg-note-bg" : "bg-card"}`}>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f, f.name);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-secondary cursor-pointer hover:bg-white/65"
            aria-label="Attach"
          >
            <IconPaperclip size={18} />
          </button>
          <button
            onClick={() => void toggleVoice()}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full cursor-pointer ${recorder.recording ? "bg-danger text-white" : "glass text-ink-secondary hover:bg-white/65"}`}
            aria-label="Voice"
          >
            <IconMic size={18} />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            placeholder={note ? "Internal note (requester won't see this)…" : t("thread.reply")}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && canSend) {
                e.preventDefault();
                send.mutate();
              }
            }}
            className="max-h-[140px] flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] outline-none placeholder:text-ink-faint"
          />
          <button
            onClick={() => send.mutate()}
            disabled={!canSend}
            aria-label="Send"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors disabled:opacity-40 cursor-pointer"
          >
            {send.isPending ? <Spinner size={16} light /> : <IconSend size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
