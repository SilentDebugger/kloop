import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { colors } from "@kloop/shared";
import { useConnection } from "../src/store/connection";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="dark" />
      <AuthGate />
    </QueryClientProvider>
  );
}

function AuthGate() {
  const router = useRouter();
  const segments = useSegments();
  const workspaces = useConnection((s) => s.workspaces);
  const activeIndex = useConnection((s) => s.activeIndex);
  const hydrated = useConnection.persist?.hasHydrated?.() ?? true;

  const ws = workspaces[activeIndex] ?? null;

  // push notification tap → deep link to the linked screen
  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    void (async () => {
      try {
        const Notifications = await import("expo-notifications");
        sub = Notifications.addNotificationResponseReceivedListener((response) => {
          const link = response.notification.request.content.data?.linkPath;
          if (typeof link === "string" && link.startsWith("/")) router.push(link as never);
        });
      } catch {
        // expo-notifications unavailable (web preview / Expo Go limitations)
      }
    })();
    return () => sub?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const inAuthFlow = segments[0] === "connect" || segments[0] === "login" || segments[0] === "qr-scan";
    if (!ws) {
      if (!inAuthFlow) router.replace("/connect");
      return;
    }
    if (!ws.token || !ws.user) {
      if (!inAuthFlow) router.replace("/login");
      return;
    }
    if (inAuthFlow || (segments as string[]).length === 0) {
      router.replace(ws.user.role === "requester" ? "/(requester)" : "/(supporter)/queue");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, ws?.token, ws?.user?.role, activeIndex, segments[0]]);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
