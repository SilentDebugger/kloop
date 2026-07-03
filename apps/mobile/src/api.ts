import { KloopClient } from "@kloop/shared";
import { activeWorkspace, useConnection } from "./store/connection";

/**
 * One client whose target follows the active workspace — switching orgs in
 * Settings instantly redirects every query to the right server + session.
 */
export const api = new KloopClient({
  baseUrl: () => activeWorkspace()?.origin ?? "",
  getToken: () => activeWorkspace()?.token ?? null,
  getOrgSlug: () => activeWorkspace()?.slug ?? null,
});

export function useSignedIn(): boolean {
  return useConnection((s) => Boolean(s.workspaces[s.activeIndex]?.token));
}
