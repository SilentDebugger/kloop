import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DocCaptureView } from "@kloop/shared";
import { api } from "./api";

export function isGenerating(status: string | undefined | null): boolean {
  return status === "queued" || status === "reading" || status === "drafting";
}

export const ACTIVE_CAPTURE_KEY = ["doc-capture-active"] as const;

/**
 * The signed-in supporter's in-flight (or finished-but-unacknowledged)
 * capture, straight from the server — the single source of truth for the
 * resume pill, the auto-reopen watcher, and the doc-capture sheet. Everything
 * shares one query key, so any number of subscribers costs one poll.
 */
export function useActiveDocCapture(enabled = true) {
  return useQuery({
    queryKey: ACTIVE_CAPTURE_KEY,
    queryFn: () => api.activeDocCapture(),
    enabled,
    refetchInterval: (query) => (isGenerating(query.state.data?.capture?.status) ? 1500 : false),
  });
}

/** Push a fresh value into the shared active-capture cache (post create/submit/cancel). */
export function useSetActiveDocCapture() {
  const qc = useQueryClient();
  return (capture: DocCaptureView | null) => {
    qc.setQueryData(ACTIVE_CAPTURE_KEY, { capture });
  };
}

/** "your notes, voice memos and photos" — rebuilt from the capture row so it
 *  works even when the sheet is opened fresh after an app restart. */
export function describeCaptureSources(capture: Pick<DocCaptureView, "rawText" | "topics">): string {
  const parts: string[] = [];
  if (capture.rawText.trim()) parts.push("your notes");
  const hints = capture.topics.map((t) => t.sourceHint.toLowerCase()).join(" ");
  if (hints.includes("voice")) parts.push("voice memos");
  if (hints.includes("photo") || hints.includes("image")) parts.push("photos");
  if (hints.includes("file")) parts.push("files");
  if (parts.length === 0) return "your capture";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Sheet presence — read by the watcher (skip auto-open while the user  */
/* is already looking at it) and by the foreground push handler.        */
/* ------------------------------------------------------------------ */
let sheetPresented = false;

export const captureSheet = {
  setPresented(open: boolean) {
    sheetPresented = open;
  },
  isPresented() {
    return sheetPresented;
  },
};
