import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SessionUser } from "@kloop/shared";

type AuthState = {
  token: string | null;
  user: SessionUser | null;
  setSession: (token: string, user: SessionUser) => void;
  setUser: (user: SessionUser) => void;
  clear: () => void;
};

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      clear: () => set({ token: null, user: null }),
    }),
    { name: "kloop-auth" },
  ),
);

export function isSupporter(user: SessionUser | null): boolean {
  return user?.role === "supporter" || user?.role === "admin";
}
export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === "admin";
}
