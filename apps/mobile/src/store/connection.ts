import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import * as SecureStore from "expo-secure-store";
import type { SessionUser } from "@kloop/shared";

/**
 * Multi-workspace connection store, persisted in the device keychain.
 * A workspace = one kloop server origin + org branding + session.
 */
export type Workspace = {
  origin: string; // https://support.fjord.io
  name: string;
  slug: string;
  logoUrl: string | null;
  theme: Record<string, string>;
  auth: { magicLink: boolean; password: boolean; oidc: boolean };
  token: string | null;
  user: SessionUser | null;
};

type ConnectionState = {
  workspaces: Workspace[];
  activeIndex: number;
  addWorkspace: (w: Workspace) => void;
  removeWorkspace: (index: number) => void;
  setActive: (index: number) => void;
  setSession: (token: string, user: SessionUser) => void;
  setUser: (user: SessionUser) => void;
  signOutActive: () => void;
};

const secureStorage = {
  getItem: (name: string) => SecureStore.getItemAsync(name),
  setItem: (name: string, value: string) => SecureStore.setItemAsync(name, value),
  removeItem: (name: string) => SecureStore.deleteItemAsync(name),
};

export const useConnection = create<ConnectionState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      activeIndex: 0,
      addWorkspace: (w) => {
        const existing = get().workspaces.findIndex((x) => x.origin === w.origin && x.slug === w.slug);
        if (existing >= 0) {
          set((s) => ({
            workspaces: s.workspaces.map((x, i) => (i === existing ? { ...x, ...w, token: x.token ?? w.token, user: x.user ?? w.user } : x)),
            activeIndex: existing,
          }));
        } else {
          set((s) => ({ workspaces: [...s.workspaces, w], activeIndex: s.workspaces.length }));
        }
      },
      removeWorkspace: (index) =>
        set((s) => ({
          workspaces: s.workspaces.filter((_, i) => i !== index),
          activeIndex: Math.max(0, s.activeIndex >= index ? s.activeIndex - 1 : s.activeIndex),
        })),
      setActive: (index) => set({ activeIndex: index }),
      setSession: (token, user) =>
        set((s) => ({
          workspaces: s.workspaces.map((w, i) => (i === s.activeIndex ? { ...w, token, user } : w)),
        })),
      setUser: (user) =>
        set((s) => ({
          workspaces: s.workspaces.map((w, i) => (i === s.activeIndex ? { ...w, user } : w)),
        })),
      signOutActive: () =>
        set((s) => ({
          workspaces: s.workspaces.map((w, i) => (i === s.activeIndex ? { ...w, token: null, user: null } : w)),
        })),
    }),
    { name: "kloop-connections", storage: createJSONStorage(() => secureStorage) },
  ),
);

export function activeWorkspace(): Workspace | null {
  const s = useConnection.getState();
  return s.workspaces[s.activeIndex] ?? null;
}

/** hook variant */
export function useActiveWorkspace(): Workspace | null {
  return useConnection((s) => s.workspaces[s.activeIndex] ?? null);
}
