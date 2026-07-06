import { useRef, useState } from "react";
import { api } from "../lib/api";
import { useVoiceRecorder } from "../lib/recorder";
import { IconMic, IconPaperclip, IconX } from "./icons";

/** An uploaded attachment still held in a composer (object URL for previews). */
export type WebAttachment = { id: string; filename: string; kind: string; previewUrl: string };

/**
 * File / voice-note capture + upload with the pending list kept for previews.
 * The web twin of the mobile useComposerAttachments hook.
 */
export function useComposerAttachments() {
  const recorder = useVoiceRecorder();
  const [attachments, setAttachments] = useState<WebAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFile = async (blob: Blob, name: string) => {
    setUploading(true);
    setError(null);
    try {
      const res = await api.upload({ blob, name });
      setAttachments((x) => [
        ...x,
        { id: res.attachment.id, filename: res.attachment.filename, kind: res.attachment.kind, previewUrl: URL.createObjectURL(blob) },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed — try again.");
    } finally {
      setUploading(false);
    }
  };

  const toggleVoice = async () => {
    if (recorder.recording) {
      const note = await recorder.stop();
      if (note) await addFile(note.blob, note.name);
    } else {
      await recorder.start().catch(() => setError("Microphone unavailable — check browser permissions."));
    }
  };

  return {
    attachments,
    ids: attachments.map((a) => a.id),
    uploading,
    error,
    dismissError: () => setError(null),
    recording: recorder.recording,
    seconds: recorder.seconds,
    addFile,
    toggleVoice,
    remove: (id: string) => setAttachments((x) => x.filter((y) => y.id !== id)),
    clear: () => setAttachments([]),
  };
}

/**
 * Photo + voice buttons with pending previews — turns any search box or form
 * into a multimodal one. Pairs with useComposerAttachments.
 */
export function MediaQueryBar({ att, accept = "image/*" }: { att: ReturnType<typeof useComposerAttachments>; accept?: string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void att.addFile(f, f.name);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        className="glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-ink cursor-pointer hover:bg-white/65"
      >
        <IconPaperclip size={14} /> Photo
      </button>
      <button
        onClick={() => void att.toggleVoice()}
        className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium cursor-pointer ${
          att.recording ? "bg-danger text-white" : "glass text-ink hover:bg-white/65"
        }`}
      >
        <IconMic size={14} /> {att.recording ? `Stop · 0:${String(att.seconds % 60).padStart(2, "0")}` : "Voice"}
      </button>

      {att.attachments.map((a) =>
        a.kind === "image" ? (
          <span key={a.id} className="relative">
            <img src={a.previewUrl} alt={a.filename} className="h-12 w-12 rounded-xl object-cover" />
            <button
              onClick={() => att.remove(a.id)}
              aria-label="Remove"
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-white cursor-pointer"
            >
              <IconX size={11} />
            </button>
          </span>
        ) : a.kind === "audio" ? (
          <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full bg-mint py-1 pl-1 pr-2">
            <audio controls src={a.previewUrl} className="h-8 max-w-52" />
            <button onClick={() => att.remove(a.id)} aria-label="Remove" className="text-primary cursor-pointer">
              <IconX size={13} />
            </button>
          </span>
        ) : (
          <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full bg-mint px-3 py-1 text-[12px] font-medium text-primary">
            {a.filename}
            <button onClick={() => att.remove(a.id)} aria-label="Remove" className="cursor-pointer">
              <IconX size={13} />
            </button>
          </span>
        ),
      )}

      {att.error && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-3 py-1 text-[12px] font-medium text-danger">
          {att.error}
          <button onClick={att.dismissError} aria-label="Dismiss" className="cursor-pointer">
            <IconX size={13} />
          </button>
        </span>
      )}
    </div>
  );
}
