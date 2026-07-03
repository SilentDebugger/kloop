import { useCallback, useRef, useState } from "react";

/** MediaRecorder hook for voice attachments (composer + resolution capture). */
export function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.start();
    recorderRef.current = rec;
    setSeconds(0);
    setRecording(true);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
  }, []);

  const stop = useCallback((): Promise<{ blob: Blob; name: string } | null> => {
    return new Promise((resolve) => {
      const rec = recorderRef.current;
      if (!rec) {
        resolve(null);
        return;
      }
      rec.onstop = () => {
        rec.stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) clearInterval(timerRef.current);
        setRecording(false);
        const type = rec.mimeType.includes("webm") ? "webm" : "m4a";
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        resolve(blob.size > 0 ? { blob, name: `voice-note.${type}` } : null);
      };
      rec.stop();
      recorderRef.current = null;
    });
  }, []);

  return { recording, seconds, start, stop };
}
