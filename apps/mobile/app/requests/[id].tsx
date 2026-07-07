import { useEffect, useRef } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@kloop/shared";
import { useActiveWorkspace, useStoreHydrated } from "../../src/store/connection";

/**
 * Web-style alias: emailed links and universal links use the web app's
 * /requests/<id> path — forward them to the mobile thread at /request/<id>.
 * On a cold start the home screen is laid down first so back doesn't dead-end.
 * Signed-out users are picked up by the AuthGate redirect instead.
 */
export default function RequestsAlias() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const hydrated = useStoreHydrated();
  const ws = useActiveWorkspace();
  const authed = hydrated && !!ws?.token && !!ws?.user;
  const fired = useRef(false);

  useEffect(() => {
    if (!authed || !id || fired.current) return;
    fired.current = true;
    if (router.canGoBack()) {
      router.replace(`/request/${id}`);
    } else {
      router.replace(ws!.user!.role === "requester" ? "/(requester)" : "/(supporter)/queue");
      router.push(`/request/${id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed, id]);

  return <View style={{ flex: 1, backgroundColor: colors.background }} />;
}
