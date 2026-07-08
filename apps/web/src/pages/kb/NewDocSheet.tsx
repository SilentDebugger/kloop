import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { DocCaptureTopicView } from "@kloop/shared";
import { api } from "../../lib/api";
import { Button, ErrorNote, Sheet, Textarea } from "../../ui";
import { MediaQueryBar, useComposerAttachments } from "../../ui/attachments";
import { IconCheck, IconSparkle } from "../../ui/icons";

const KIND_BADGES: Record<string, { label: string; cls: string }> = {
  "how-to": { label: "HOW-TO", cls: "bg-mint text-primary" },
  onboarding: { label: "ONBOARDING", cls: "bg-mint text-primary" },
  "good-to-know": { label: "GOOD TO KNOW", cls: "bg-amber-soft text-amber" },
  other: { label: "NOTE", cls: "bg-chip text-ink-secondary" },
};

/**
 * Knowledge capture ("New doc") — the web twin of the mobile new-doc screen.
 * One sheet, three phases: brain-dump capture → live "structuring your notes"
 * progress → draft cards to keep or discard before sending to review.
 * State lives on this component (not the Sheet), so closing keeps the notes.
 */
export function NewDocSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const att = useComposerAttachments();

  const [text, setText] = useState("");
  const [captureId, setCaptureId] = useState<string | null>(null);
  // what fed the capture, remembered for the results subtitle
  const [sourceSummary, setSourceSummary] = useState("your notes");
  const [genError, setGenError] = useState<string | null>(null);
  const [discarded, setDiscarded] = useState<Set<string>>(new Set());

  const create = useMutation({
    mutationFn: () => api.createDocCapture({ text, attachmentIds: att.ids }),
    onSuccess: (res) => {
      setSourceSummary(describeSources(text, att.attachments.map((a) => a.kind)));
      setText("");
      att.clear();
      setDiscarded(new Set());
      setCaptureId(res.capture.id);
    },
  });

  const { data } = useQuery({
    queryKey: ["doc-capture", captureId],
    queryFn: () => api.docCapture(captureId!),
    enabled: !!captureId,
    refetchInterval: (query) => {
      const s = query.state.data?.capture.status;
      return s === "queued" || s === "reading" || s === "drafting" ? 1500 : false;
    },
  });
  const capture = data?.capture ?? null;

  // generation failed → back to the capture phase with the notes restored
  useEffect(() => {
    if (capture?.status !== "failed") return;
    if (!text.trim() && capture.rawText) setText(capture.rawText);
    setGenError(capture.error ?? "Something went wrong — try again.");
    setCaptureId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture?.status]);

  const submit = useMutation({
    mutationFn: () => api.submitDocCapture(captureId!, [...discarded]),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reviews"] });
      void qc.invalidateQueries({ queryKey: ["review-counts"] });
      void qc.invalidateQueries({ queryKey: ["articles"] });
      setCaptureId(null);
      setDiscarded(new Set());
      onClose();
    },
  });

  const cancel = () => {
    if (captureId) void api.cancelDocCapture(captureId).catch(() => {});
    setCaptureId(null);
    onClose();
  };

  const phase: "capture" | "generating" | "results" =
    capture?.status === "ready" ? "results" : captureId ? "generating" : "capture";

  return (
    <Sheet open={open} onClose={phase === "generating" ? cancel : onClose}>
      {phase === "capture" && (
        <CapturePhase
          text={text}
          setText={setText}
          att={att}
          error={genError ?? (create.isError ? (create.error instanceof Error ? create.error.message : "Couldn't start — try again.") : null)}
          submitting={create.isPending}
          onSubmit={() => {
            setGenError(null);
            create.mutate();
          }}
        />
      )}
      {phase === "generating" && <GeneratingPhase topics={capture?.topics ?? []} onCancel={cancel} />}
      {phase === "results" && capture && (
        <ResultsPhase
          topics={capture.topics}
          sourceSummary={sourceSummary}
          discarded={discarded}
          onToggleDiscard={(articleId) =>
            setDiscarded((prev) => {
              const next = new Set(prev);
              if (next.has(articleId)) next.delete(articleId);
              else next.add(articleId);
              return next;
            })
          }
          submitting={submit.isPending}
          submitError={submit.isError ? (submit.error instanceof Error ? submit.error.message : "Couldn't submit — try again.") : null}
          onSubmit={() => submit.mutate()}
        />
      )}
    </Sheet>
  );
}

function describeSources(text: string, kinds: string[]): string {
  const parts: string[] = [];
  if (text.trim()) parts.push("your notes");
  const audio = kinds.filter((k) => k === "audio").length;
  const images = kinds.filter((k) => k === "image").length;
  const files = kinds.filter((k) => k !== "audio" && k !== "image").length;
  if (audio > 0) parts.push(audio === 1 ? "one voice memo" : `${audio} voice memos`);
  if (images > 0) parts.push(images === 1 ? "a photo" : `${images} photos`);
  if (files > 0) parts.push(files === 1 ? "a file" : `${files} files`);
  if (parts.length === 0) return "your capture";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Phase 7b — brain-dump anything, in any mix                          */
/* ------------------------------------------------------------------ */
function CapturePhase({
  text,
  setText,
  att,
  error,
  submitting,
  onSubmit,
}: {
  text: string;
  setText: (t: string) => void;
  att: ReturnType<typeof useComposerAttachments>;
  error: string | null;
  submitting: boolean;
  onSubmit: () => void;
}) {
  const thingCount = (text.trim() ? 1 : 0) + att.attachments.length;
  const canSubmit = (text.trim().length > 0 || att.ids.length > 0) && !att.uploading && !att.recording;

  return (
    <div>
      <h2 className="text-xl font-bold text-ink">What did you learn?</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
        Notes, sentences, voice, photos — in any order. No structure needed, that's our job.{" "}
        <IconSparkle size={13} className="inline -mt-0.5 text-primary" />
      </p>

      <Textarea
        autoFocus
        rows={8}
        placeholder="– the guest wifi voucher printer is in room 2.14…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="mt-4"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MediaQueryBar att={att} accept="image/*,audio/*,.pdf,.txt,.md,.csv" />
        {thingCount > 0 && (
          <span className="mt-2.5 text-[13px] text-ink-secondary">
            {thingCount} thing{thingCount === 1 ? "" : "s"} added
          </span>
        )}
      </div>

      {error && (
        <div className="mt-3">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <Button size="lg" className="mt-4" disabled={!canSubmit} loading={submitting} onClick={onSubmit}>
        <IconSparkle size={16} /> Turn into drafts
      </Button>
      <p className="mt-2.5 text-center text-[12px] text-ink-faint">Might become more than one article — that's fine.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Phase 7c — structuring your notes                                   */
/* ------------------------------------------------------------------ */
function GeneratingPhase({ topics, onCancel }: { topics: DocCaptureTopicView[]; onCancel: () => void }) {
  const settled = topics.filter((t) => t.status !== "pending").length;
  const subtitle =
    topics.length > 0
      ? `Found ${topics.length} separate topic${topics.length === 1 ? "" : "s"} · drafting ${Math.min(settled + 1, topics.length)} of ${topics.length}`
      : "Reading your notes, voice memos and photos…";

  return (
    <div className="flex flex-col items-center py-6 text-center">
      <div className="flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-mint text-primary">
        <IconSparkle size={30} />
      </div>
      <h2 className="mt-5 text-xl font-bold text-ink">Structuring your notes…</h2>
      <p className="mt-1 text-[13px] text-ink-secondary">{subtitle}</p>

      {topics.length > 0 && (
        <div className="mt-6 flex w-full flex-col gap-2">
          {topics.map((t) => (
            <div key={t.id} className="flex items-center gap-2.5 rounded-inner bg-card px-3.5 py-3 text-left shadow-card">
              {t.status === "pending" ? (
                <span className="h-5 w-5 shrink-0 rounded-full border-2 border-mint-strong" />
              ) : (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-mint text-primary">
                  <IconCheck size={11} />
                </span>
              )}
              <span className={`min-w-0 flex-1 truncate text-[14px] font-semibold ${t.status === "pending" ? "text-ink-secondary" : "text-ink"}`}>
                {t.title}
              </span>
            </div>
          ))}
        </div>
      )}

      <button onClick={onCancel} className="mt-7 cursor-pointer text-[14px] font-semibold text-ink-secondary hover:text-ink">
        Cancel
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Phase 7d — draft cards: open, discard, send to review               */
/* ------------------------------------------------------------------ */
function ResultsPhase({
  topics,
  sourceSummary,
  discarded,
  onToggleDiscard,
  submitting,
  submitError,
  onSubmit,
}: {
  topics: DocCaptureTopicView[];
  sourceSummary: string;
  discarded: Set<string>;
  onToggleDiscard: (articleId: string) => void;
  submitting: boolean;
  submitError: string | null;
  onSubmit: () => void;
}) {
  const drafts = topics.filter((t) => t.status === "drafted" && t.articleId);
  const covered = topics.filter((t) => t.status === "covered");
  const kept = drafts.filter((t) => !discarded.has(t.articleId!));

  return (
    <div>
      <h2 className="flex items-center gap-2 text-xl font-bold text-ink">
        <IconSparkle size={18} className="text-primary" />
        {drafts.length} draft{drafts.length === 1 ? "" : "s"} ready
      </h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">From {sourceSummary}. Skim, tweak, or toss.</p>

      <div className="mt-4 flex flex-col gap-3">
        {drafts.map((t) => {
          const badge = KIND_BADGES[t.kind] ?? KIND_BADGES.other;
          const isDiscarded = discarded.has(t.articleId!);
          return (
            <div key={t.id} className={`rounded-card bg-card p-4 shadow-card transition-opacity ${isDiscarded ? "opacity-45" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${badge.cls}`}>
                  {badge.label}
                </span>
                <span className="text-[12px] text-ink-faint">{t.sourceHint}</span>
              </div>
              <div className="mt-2.5 text-[15px] font-bold leading-snug text-ink">{t.title}</div>
              {t.summary && <div className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{t.summary}</div>}
              <div className="mt-3 flex items-center gap-2.5">
                {isDiscarded ? (
                  <Button size="sm" variant="secondary" className="flex-1" onClick={() => onToggleDiscard(t.articleId!)}>
                    Keep it
                  </Button>
                ) : (
                  <>
                    {/* new tab so the results stay on screen */}
                    <Button size="sm" variant="secondary" className="flex-1" onClick={() => window.open(`/kb/${t.articleId}`, "_blank")}>
                      Open & edit
                    </Button>
                    <button
                      onClick={() => onToggleDiscard(t.articleId!)}
                      className="cursor-pointer px-2.5 text-[13px] font-semibold text-danger hover:opacity-80"
                    >
                      Discard
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {covered.map((t) => (
          <div key={t.id} className="flex items-center gap-2.5 rounded-card bg-surface p-4">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-mint text-primary">
              <IconCheck size={11} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-ink">{t.title}</span>
              <span className="block text-[12px] text-ink-secondary">
                Already covered by {t.coveredByLabel ?? "an existing article"} — no new doc needed.
              </span>
            </span>
          </div>
        ))}

        {drafts.length === 0 && covered.length === 0 && (
          <ErrorNote>Nothing documentable came out of this capture — the notes are saved.</ErrorNote>
        )}
      </div>

      {submitError && (
        <div className="mt-3">
          <ErrorNote>{submitError}</ErrorNote>
        </div>
      )}

      <Button size="lg" className="mt-5" loading={submitting} onClick={onSubmit}>
        {kept.length > 0
          ? `Send ${kept.length === drafts.length ? `all ${kept.length}` : String(kept.length)} to review`
          : "Discard all & close"}
      </Button>
      <p className="mt-2.5 text-center text-[12px] text-ink-faint">Nothing publishes without the usual review step.</p>
    </div>
  );
}
