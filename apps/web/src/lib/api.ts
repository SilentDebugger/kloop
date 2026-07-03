import { KloopClient } from "@kloop/shared";
import { useAuth } from "./auth";

/** Single client instance; token is read live from the auth store. */
export const api = new KloopClient({
  baseUrl: "",
  getToken: () => useAuth.getState().token,
});
