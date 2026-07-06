import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KloopClient, colors } from "@kloop/shared";
import { api } from "../../src/api";
import { activeWorkspace, useConnection } from "../../src/store/connection";
import { Button, ErrorNote, Spinner } from "../../src/ui";

/**
 * Deep-link target for magic-link emails: kloop://auth/verify?token=...&server=...
 * Bootstraps the workspace via discovery when the server isn't connected yet,
 * verifies the token, and lands in the right home screen.
 */
export default function VerifyDeepLink() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; server?: string }>();
  const [error, setError] = useState<string | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    void (async () => {
      try {
        const token = typeof params.token === "string" ? params.token : "";
        if (!token) throw new Error("This link is missing its token.");
        await connectWorkspaceFromLink(typeof params.server === "string" ? params.server : null);
        const res = await api.verifyMagicLink(token);
        useConnection.getState().setSession(res.token, res.user);
        router.replace(res.user.role === "requester" ? "/(requester)" : "/(supporter)/queue");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Verification failed.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 24 }}>
        {error ? (
          <>
            <ErrorNote>{error}</ErrorNote>
            <Button title="Back to sign in" variant="secondary" onPress={() => router.replace("/login")} />
          </>
        ) : (
          <>
            <Spinner />
            <Text style={{ fontSize: 14, color: colors.textSecondary }}>Signing you in…</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

/**
 * Make the link's server the active workspace: switch to it if already
 * connected, otherwise bootstrap it from the discovery document.
 */
export async function connectWorkspaceFromLink(server: string | null): Promise<void> {
  if (server) {
    const origin = new URL(server).origin;
    const state = useConnection.getState();
    const existing = state.workspaces.findIndex((w) => w.origin === origin);
    if (existing >= 0) {
      state.setActive(existing);
    } else {
      const doc = await KloopClient.discover(origin);
      state.addWorkspace({
        origin,
        name: doc.org.name,
        slug: doc.org.slug,
        logoUrl: doc.org.logoUrl,
        theme: doc.org.theme,
        auth: doc.auth,
        token: null,
        user: null,
      });
    }
  }
  if (!activeWorkspace()) throw new Error("Connect to your workspace first, then open the link again.");
}
