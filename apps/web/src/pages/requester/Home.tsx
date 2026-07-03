import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { DeflectionSuggestion } from "@kloop/shared";
import { api } from "../../lib/api";
import { useDrafts } from "../../lib/drafts";
import { useVoiceRecorder } from "../../lib/recorder";
import { PageHeader } from "../../shell/AppShell";
import { Button, Card, Chip, Logo, SectionLabel, Spinner } from "../../ui";
import { IconCamera, IconChevron, IconMic, IconPaperclip, IconX } from "../../ui/icons";

type PendingAttachment = { id: string; filename: string; kind: string };

export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { composerText, setComposerText, queue, enqueue, dequeue } = useDrafts();
  const [text, setText] = useState(composerText);
  const [debounced, setDebounced] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const recorder = useVoiceRecorder();
  const cameraRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  // persist draft + debounce deflection
  useEffect(() => {
    setComposerText(text);
    const id = setTimeout(() => setDebounced(text.trim()), 450);
    return () => clearTimeout(id);
  }, [text, setComposerText]);

  const { data: deflect, isFetching } = useQuery({
    queryKey: ["deflect", debounced],
    queryFn: () => api.deflect(debounced),
    enabled: debounced.length >= 8,
    staleTime: 30_000,
  });

  const send = useMutation({
    mutationFn: () =>
      api.createRequest({
        title: text.trim(),
        channel: "web",
        attachmentIds: attachments.map((a) => a.id),
      }),
    onSuccess: (res) => {
      setText("");
      setComposerText("");
      setAttachments([]);
      navigate(`/requests/${res.request.id}`);
    },
    onError: () => {
      if (!navigator.onLine) {
        enqueue({ title: text.trim(), body: "" });
        setText("");
        setComposerText("");
      }
    },
  });

  // sync offline-queued drafts when back online
  useEffect(() => {
    const sync = () => {
      for (const draft of useDrafts.getState().queue) {
        api
          .createRequest({ title: draft.title, body: draft.body, channel: "web" })
          .then(() => dequeue(draft.localId))
          .catch(() => {});
      }
    };
    window.addEventListener("online", sync);
    if (navigator.onLine) sync();
    return () => window.removeEventListener("online", sync);
  }, [dequeue]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const res = await api.upload({ blob: file, name: file.name });
      setAttachments((a) => [...a, { id: res.attachment.id, filename: res.attachment.filename, kind: res.attachment.kind }]);
    } finally {
      setUploading(false);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void upload(file);
    e.target.value = "";
  };

  const toggleVoice = async () => {
    if (recorder.recording) {
      const note = await recorder.stop();
      if (note) {
        setUploading(true);
        try {
          const res = await api.upload(note);
          setAttachments((a) => [...a, { id: res.attachment.id, filename: res.attachment.filename, kind: res.attachment.kind }]);
        } finally {
          setUploading(false);
        }
      }
    } else {
      await recorder.start().catch(() => {});
    }
  };

  const suggestions = deflect?.suggestions ?? [];
  const canSend = text.trim().length >= 3 && !send.isPending;

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-6 md:pt-10">
      <PageHeader title={t("home.title")} />

      {/* composer card */}
      <div className="rounded-card border-2 border-primary bg-card p-4 shadow-card">
        <textarea
          autoFocus
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSend) send.mutate();
          }}
          placeholder={t("home.placeholder")}
          className="w-full resize-none bg-transparent text-[16px] outline-none placeholder:text-ink-faint"
        />
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
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
        <div className="flex items-center gap-2">
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
          <input ref={photoRef} type="file" accept="image/*,application/pdf,text/plain,.log" hidden onChange={onPick} />
          <Chip onClick={() => cameraRef.current?.click()}>
            <IconCamera size={15} /> Camera
          </Chip>
          <Chip onClick={() => photoRef.current?.click()}>
            <IconPaperclip size={15} /> Photo
          </Chip>
          <Chip onClick={() => void toggleVoice()} active={recorder.recording}>
            <IconMic size={15} /> {recorder.recording ? `${recorder.seconds}s` : "Voice"}
          </Chip>
          <div className="ml-auto flex items-center gap-2">
            {(uploading || isFetching) && <Spinner size={16} />}
            <Button onClick={() => send.mutate()} disabled={!canSend} loading={send.isPending}>
              {t("home.send")}
            </Button>
          </div>
        </div>
      </div>

      {queue.length > 0 && (
        <div className="mt-3 rounded-inner bg-amber-soft px-4 py-2.5 text-[13px] font-medium text-amber">
          {queue.length} draft{queue.length > 1 ? "s" : ""} queued offline — will send when you're back online.
        </div>
      )}

      {/* live deflection */}
      {suggestions.length > 0 && (
        <div className="fade-up mt-7">
          <SectionLabel className="mb-2.5 px-1">{t("home.mightSolve")}</SectionLabel>
          <div className="flex flex-col gap-2.5">
            {suggestions.map((s) => (
              <SuggestionCard key={`${s.kind}-${s.id}`} s={s} draftTitle={text.trim()} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 text-center">
        <Link to="/kb" className="text-[14px] font-semibold text-primary">
          {t("home.browseKb")} →
        </Link>
      </div>
    </div>
  );
}

function SuggestionCard({ s, draftTitle }: { s: DeflectionSuggestion; draftTitle: string }) {
  const navigate = useNavigate();
  if (s.kind === "article") {
    return (
      <Card
        onClick={() => navigate(`/answer/${s.id}`, { state: { draftTitle } })}
        className="flex items-center gap-3.5 p-4"
        as="button"
      >
        <Logo size={22} stroke={4.5} />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold leading-snug text-ink">{s.title}</span>
          <span className="mt-0.5 block text-[13px] text-ink-secondary">
            Article{s.helpfulPercent != null ? ` · ${s.helpfulPercent}% found this helpful` : ""}
          </span>
        </span>
        <IconChevron size={16} className="shrink-0 text-ink-faint" />
      </Card>
    );
  }
  return (
    <Card className="flex items-center gap-3.5 p-4">
      <span className="ml-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold leading-snug text-ink">"{s.title}" — solved</span>
        <span className="mt-0.5 block text-[13px] text-ink-secondary">
          Similar request{s.resolutionMinutes != null ? ` · resolved in ${s.resolutionMinutes} min` : ""}
        </span>
      </span>
    </Card>
  );
}
