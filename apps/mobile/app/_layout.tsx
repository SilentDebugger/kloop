import { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { featureFlags } from "react-native-screens";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { colors } from "@kloop/shared";
import { useRealtime } from "../src/realtime";
import { registerPush } from "../src/push";
import { captureSheet, useActiveDocCapture } from "../src/docCapture";
import { useConnection, useStoreHydrated } from "../src/store/connection";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
});

// The home composer's Send button uses Expo Router's native iOS 18 zoom
// transition (Link.AppleZoom) into the request thread. Both flags already
// default to `true` in the installed react-native-screens, but are pinned
// explicitly here since they're load-bearing for that transition feeling
// native — without them the destination screen can ignore touches for ~1s
// after the animation settles. Setting them to their current default is a
// documented no-op, kept as a guard against the default changing upstream.
if (Platform.OS === "ios") {
  featureFlags.experiment.iosPreventReattachmentOfDismissedScreens = true;
  featureFlags.experiment.ios26AllowInteractionsDuringTransition = true;
}

/**
 * Server linkPaths are web-app routes (/requests/<id>, /reviews, /kb/gaps).
 * Translate them to the mobile equivalents; unknown paths are dropped rather
 * than pushed into an "Unmatched Route" screen.
 */
function toMobileRoute(link: unknown): string | null {
  if (typeof link !== "string" || !link.startsWith("/")) return null;
  const request = /^\/requests?\/([A-Za-z0-9_-]+)/.exec(link);
  if (request) return `/request/${request[1]}`;
  const capture = /^\/captures\/([A-Za-z0-9_-]+)/.exec(link);
  if (capture) return `/doc-capture/${capture[1]}`;
  if (link.startsWith("/reviews")) return "/(supporter)/reviews";
  if (link.startsWith("/kb")) return "/kb";
  return null;
}

/**
 * Headless follower of the server's active knowledge capture. Keeps the shared
 * /captures/active poll running app-wide, and when generation settles (ready /
 * failed) with the doc-capture sheet closed it re-presents the sheet — at most
 * once per capture+outcome per app session, so a deliberate dismissal isn't
 * nagged. A fresh cold start observes the settled capture again and reopens.
 */
function ActiveCaptureWatcher() {
  const router = useRouter();
  const hydrated = useStoreHydrated();
  const workspaces = useConnection((s) => s.workspaces);
  const activeIndex = useConnection((s) => s.activeIndex);
  const ws = workspaces[activeIndex] ?? null;
  // the doc-capture sheet lives in the supporter-protected group — a push
  // for anyone else would be silently swallowed by the guard
  const isSupporter = hydrated && !!ws?.token && !!ws?.user && ws.user.role !== "requester";

  const { data } = useActiveDocCapture(isSupporter);
  const capture = data?.capture ?? null;
  const status = capture?.status;
  const openedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!capture || (status !== "ready" && status !== "failed")) return;
    const key = `${capture.id}:${status}`;
    if (openedFor.current === key) return;
    openedFor.current = key;
    if (captureSheet.isPresented()) return;
    router.push(`/doc-capture/${capture.id}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture?.id, status]);

  return null;
}

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <ActiveCaptureWatcher />
        <AuthGate />
      </QueryClientProvider>
    </KeyboardProvider>
  );
}

function AuthGate() {
  useRealtime();
  const router = useRouter();
  const segments = useSegments();
  const hydrated = useStoreHydrated();
  const workspaces = useConnection((s) => s.workspaces);
  const activeIndex = useConnection((s) => s.activeIndex);
  // deep link from a notification tap, held until the session is ready
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);

  const ws = workspaces[activeIndex] ?? null;
  const authed = hydrated && !!ws?.token && !!ws?.user;
  const isRequester = authed && ws?.user?.role === "requester";

  // (re-)register the push token whenever a session is active — login-only
  // registration missed users who were already signed in
  useEffect(() => {
    if (authed) void registerPush();
  }, [authed]);

  // push notification tap → deep link to the linked screen. Routes are held
  // in state and only pushed once authed, otherwise the Stack.Protected
  // guards silently swallow the navigation (cold start races hydration).
  useEffect(() => {
    let sub: { remove: () => void } | undefined;
    void (async () => {
      try {
        const Notifications = await import("expo-notifications");
        sub = Notifications.addNotificationResponseReceivedListener((response) => {
          const route = toMobileRoute(response.notification.request.content.data?.linkPath);
          if (route) setPendingRoute(route);
        });
        // app cold-started by a notification tap — the listener above wasn't
        // mounted at tap time, so pick up the launch response explicitly
        const launch = await Notifications.getLastNotificationResponseAsync();
        const launchRoute = toMobileRoute(launch?.notification.request.content.data?.linkPath);
        if (launchRoute) setPendingRoute(launchRoute);
      } catch {
        // expo-notifications unavailable (web preview / Expo Go limitations)
      }
    })();
    return () => sub?.remove();
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
    // initial routing only — signed-in users may visit the auth flow on
    // purpose ("Add a workspace…" in Settings pushes /connect)
    if ((segments as string[]).length === 0) {
      router.replace(ws.user.role === "requester" ? "/(requester)" : "/(supporter)/queue");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, ws?.token, ws?.user?.role, activeIndex, segments[0]]);

  // Declared after the home redirect above so a cold-start deep link pushes
  // the target screen on top of home (back returns to home) instead of the
  // redirect replacing the deep-linked screen.
  useEffect(() => {
    if (!pendingRoute || !authed) return;
    setPendingRoute(null);
    router.push(pendingRoute as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRoute, authed]);

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
        {/* knowledge capture — standard push; the Link.AppleZoom morph from the
            Knowledge tab's "New doc" pill drives the presentation */}
        <Stack.Screen name="new-doc" />
        {/* live generation progress + results for a capture — a true bottom
            sheet (half height, expandable) so the screen behind stays visible;
            generation continues server-side while it's dismissed */}
        <Stack.Screen
          name="doc-capture/[id]"
          options={{
            presentation: "formSheet",
            sheetAllowedDetents: [0.62, 0.95],
            sheetInitialDetentIndex: 0,
            sheetGrabberVisible: true,
            sheetCornerRadius: 24,
          }}
        />
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
      {/* auth flow stays reachable while signed in — "Add a workspace…" pushes
          /connect from Settings, and a guard would silently swallow that push */}
      <Stack.Screen name="connect" />
      <Stack.Screen name="qr-scan" />
      <Stack.Screen name="login" />
    </Stack>
  );
}
