import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../lib/api";
import { useVoiceRecorder } from "../../lib/recorder";
import { Button, Chip, Logo, SectionLabel, Sheet } from "../../ui";
import { IconCamera, IconChevron, IconSparkle, IconTerminal, IconX } from "../../ui/icons";

/**
 * Resolution capture — "How did you fix it?" bottom sheet.
 * Under 30 seconds: rough text, optional voice/photo/log, optional
 * "same as last time" link to a previous resolution. kloop structures it
 * afterwards (LLM worker) and feeds article generation.
 */
export function ResolveSheet({
  open,
  onClose,
  requestId,
  onResolved,
}: {
  open: boolean;
  onClose: () => void;
  requestId: string;
  onResolved: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [linked, setLinked] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<{ id: string; filename: string }[]>([]);
  const photoRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLInputElement>(null);
  const recorder = useVoiceRecorder();

  const { data: similar } = useQuery({
    queryKey: ["similar-resolutions", requestId],
    queryFn: () => api.similarResolutions(requestId),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const genDraft = useMutation({
    mutationFn: () => api.resolutionDraft(requestId),
    onSuccess: (res) => setText(res.draft),
  });

  const resolve = useMutation({
    mutationFn: (skip: boolean) =>
      api.resolve(requestId, {
        rawCaptureText: skip ? undefined : text.trim() || undefined,
        captureKind: attachments.length > 0 ? "mixed" : "text",
        linkedResolutionId: linked,
        attachmentIds: attachments.map((a) => a.id),
        skipCapture: skip && !text.trim() && !linked && attachments.length === 0,
      }),
    onSuccess: onResolved,
  });

  const upload = async (blob: Blob, name: string) => {
    const res = await api.upload({ blob, name });
    setAttachments((a) => [...a, { id: res.attachment.id, filename: res.attachment.filename }]);
  };

  const toggleVoice = async () => {
    if (recorder.recording) {
      const note = await recorder.stop();
      if (note) await upload(note.blob, note.name);
    } else {
      await recorder.start().catch(() => {});
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void upload(f, f.name);
    e.target.value = "";
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("resolve.title")}>
      <p className="-mt-2 mb-3 text-[13px] text-ink-secondary">{t("resolve.hint")}</p>

      <textarea
        rows={4}
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Re-installed the VPN profile from Self Service, restarted the client…"
        className="w-full resize-none rounded-inner border border-line bg-card px-4 py-3 text-[15px] outline-none placeholder:text-ink-faint focus:border-primary"
      />

      <button
        onClick={() => genDraft.mutate()}
        disabled={genDraft.isPending}
        className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-mint px-3.5 py-2 text-[13px] font-semibold text-primary transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        <IconSparkle size={14} />
        {genDraft.isPending ? "Drafting from thread…" : "Draft from thread"}
      </button>
      {genDraft.isError && (
        <p className="mt-1 text-[12px] text-danger">Couldn't generate a draft — write it manually.</p>
      )}

      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
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

      <div className="mt-3 flex gap-2">
        <input ref={photoRef} type="file" accept="image/*" hidden onChange={onPick} />
        <input ref={logRef} type="file" accept=".log,.txt,text/plain" hidden onChange={onPick} />
        <Chip onClick={() => void toggleVoice()} active={recorder.recording} className="flex-1 justify-center !py-2.5">
          <span className={`h-2 w-2 rounded-full ${recorder.recording ? "bg-white" : "bg-danger"}`} />
          {recorder.recording ? `${recorder.seconds}s` : "Voice"}
        </Chip>
        <Chip onClick={() => photoRef.current?.click()} className="flex-1 justify-center !py-2.5">
          <IconCamera size={15} /> Photo
        </Chip>
        <Chip onClick={() => logRef.current?.click()} className="flex-1 justify-center !py-2.5">
          <IconTerminal size={15} /> Log
        </Chip>
      </div>

      {(similar?.resolutions.length ?? 0) > 0 && (
        <>
          <SectionLabel className="mb-2 mt-5">{t("resolve.sameAsLastTime")}</SectionLabel>
          <div className="flex flex-col gap-2">
            {similar!.resolutions.slice(0, 3).map((r) => {
              const active = linked === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setLinked(active ? null : r.id)}
                  className={`flex w-full items-center gap-3 rounded-inner p-3.5 text-left transition-colors cursor-pointer ${
                    active ? "bg-mint ring-2 ring-primary" : "bg-mint/60 hover:bg-mint"
                  }`}
                >
                  <Logo size={20} stroke={4.5} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">
                      {r.ref} · {r.requestTitle}
                    </span>
                    <span className="block truncate text-[12px] text-ink-secondary">
                      {r.supporterName ? `Solved by ${r.supporterName}` : "Solved"} · tap to link
                    </span>
                  </span>
                  <IconChevron size={15} className="shrink-0 text-ink-faint" />
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-5 flex gap-2.5">
        <Button variant="secondary" className="flex-1" disabled={resolve.isPending} onClick={() => resolve.mutate(true)}>
          {t("resolve.skip")}
        </Button>
        <Button className="flex-[2]" loading={resolve.isPending} onClick={() => resolve.mutate(false)}>
          {t("resolve.done")}
        </Button>
      </div>
    </Sheet>
  );
}
