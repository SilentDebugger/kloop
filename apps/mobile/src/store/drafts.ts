import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import * as SecureStore from "expo-secure-store";

/** Offline drafts: composer text survives restarts; queued sends sync later. */
export type QueuedDraft = { localId: string; title: string; queuedAt: string };

type DraftState = {
  composerText: string;
  captureText: Record<string, string>; // requestId -> in-progress capture
  /** knowledge-capture notes ("New doc") — survives close / "Save for later" */
  docCaptureText: string;
  queue: QueuedDraft[];
  setComposerText: (t: string) => void;
  setCaptureText: (requestId: string, t: string) => void;
  setDocCaptureText: (t: string) => void;
  enqueue: (title: string) => void;
  dequeue: (localId: string) => void;
};

export const useDrafts = create<DraftState>()(
  persist(
    (set) => ({
      composerText: "",
      captureText: {},
      docCaptureText: "",
      queue: [],
      setComposerText: (composerText) => set({ composerText }),
      setCaptureText: (requestId, t) => set((s) => ({ captureText: { ...s.captureText, [requestId]: t } })),
      setDocCaptureText: (docCaptureText) => set({ docCaptureText }),
      enqueue: (title) =>
        set((s) => ({
          queue: [...s.queue, { localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`, title, queuedAt: new Date().toISOString() }],
        })),
      dequeue: (localId) => set((s) => ({ queue: s.queue.filter((d) => d.localId !== localId) })),
    }),
    {
      name: "kloop-drafts",
      storage: createJSONStorage(() => ({
        getItem: (n: string) => SecureStore.getItemAsync(n),
        setItem: (n: string, v: string) => SecureStore.setItemAsync(n, v),
        removeItem: (n: string) => SecureStore.deleteItemAsync(n),
      })),
    },
  ),
);
