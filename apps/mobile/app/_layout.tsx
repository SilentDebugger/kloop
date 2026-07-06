import { useEffect, useState } from "react";
import { View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { colors } from "@kloop/shared";
import { useRealtime } from "../src/realtime";
import { registerPush } from "../src/push";
import { useConnection } from "../src/store/connection";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <AuthGate />
      </QueryClientProvider>
    </KeyboardProvider>
  );
}

/**
 * The connection store rehydrates asynchronously from the device keychain.
 * Subscribe to hydration so the gate re-evaluates the moment it completes —
 * reading `hasHydrated()` once during render would never trigger a re-render.
 */
function useStoreHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useConnection.persist?.hasHydrated?.() ?? true);
  useEffect(() => {
    if (hydrated) return;
    if (useConnection.persist?.hasHydrated?.()) {
      setHydrated(true);
      return;
    }
    return useConnection.persist?.onFinishHydration?.(() => setHydrated(true));
  }, [hydrated]);
  return hydrated;
}

function AuthGate() {
  useRealtime();
  const router = useRouter();
  const segments = useSegments();
  const hydrated = useStoreHydrated();
  const workspaces = useConnection((s) => s.workspaces);
  const activeIndex = useConnection((s) => s.activeIndex);

  const ws = workspaces[activeIndex] ?? null;
  const authed = hydrated && !!ws?.token && !!ws?.user;
  const isRequester = authed && ws?.user?.role === "requester";

  // (re-)register the push token whenever a session is active — login-only
  // registration missed users who were already signed in
  useEffect(() => {
    if (authed) void registerPush();
  }, [authed]);

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
    // deep-link targets (kloop://auth/verify, kloop://auth/invite) handle their
    // own workspace bootstrap — never redirect away from them
    if (segments[0] === "auth") return;
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

  // Hold a blank branded frame until the keychain store has loaded, so a
  // signed-in user never sees the connect screen flash (and vice versa).
  if (!hydrated) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={isRequester}>
        <Stack.Screen name="(requester)" />
      </Stack.Protected>
      <Stack.Protected guard={authed && !isRequester}>
        <Stack.Screen name="(supporter)" />
        {/* log a request for a user or guest — same native sheet as resolve */}
        <Stack.Screen
          name="new-request"
          options={{
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
            sheetCornerRadius: 24,
          }}
        />
      </Stack.Protected>
      <Stack.Protected guard={authed}>
        <Stack.Screen name="request/[id]" />
        <Stack.Screen name="article/[id]" />
        <Stack.Screen name="review/[id]" />
        {/* native iOS sheet: system slide/backdrop/grabber, Apple-feel resolve capture */}
        <Stack.Screen
          name="resolve/[id]"
          options={{
            presentation: "formSheet",
            sheetAllowedDetents: [0.85],
            sheetGrabberVisible: true,
            sheetCornerRadius: 24,
          }}
        />
        <Stack.Screen name="kb" />
        <Stack.Screen name="settings" />
      </Stack.Protected>
      <Stack.Protected guard={!authed}>
        <Stack.Screen name="connect" />
        <Stack.Screen name="qr-scan" />
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
}
