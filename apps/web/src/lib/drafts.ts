import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Offline request drafts: the composer autosaves here; if the network is
 * down when the user hits Send, the draft is queued and synced when the
 * browser comes back online (see useDraftSync).
 */
export type QueuedDraft = {
  localId: string;
  title: string;
  body: string;
  queuedAt: string;
};

type DraftState = {
  composerText: string;
  queue: QueuedDraft[];
  setComposerText: (text: string) => void;
  enqueue: (draft: Omit<QueuedDraft, "localId" | "queuedAt">) => void;
  dequeue: (localId: string) => void;
};

export const useDrafts = create<DraftState>()(
  persist(
    (set) => ({
      composerText: "",
      queue: [],
      setComposerText: (composerText) => set({ composerText }),
      enqueue: (draft) =>
        set((s) => ({
          queue: [...s.queue, { ...draft, localId: crypto.randomUUID(), queuedAt: new Date().toISOString() }],
        })),
      dequeue: (localId) => set((s) => ({ queue: s.queue.filter((d) => d.localId !== localId) })),
    }),
    { name: "kloop-drafts" },
  ),
);
