import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { colors } from "@kloop/shared";
import { api } from "../../src/api";
import { useConnection } from "../../src/store/connection";
import { Button, ErrorNote, Input } from "../../src/ui";
import { connectWorkspaceFromLink } from "./verify";

/**
 * Deep-link target for invitation emails: kloop://auth/invite?token=...&server=...
 * Same account-setup form as the web invite page, inside the app.
 */
export default function InviteDeepLink() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string; server?: string }>();
  const token = typeof params.token === "string" ? params.token : "";

  const [ready, setReady] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    connectWorkspaceFromLink(typeof params.server === "string" ? params.server : null)
      .then(() => setReady(true))
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't reach the workspace."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api.acceptInvite(token, name.trim(), password);
      useConnection.getState().setSession(res.token, res.user);
      router.replace(res.user.role === "requester" ? "/(requester)" : "/(supporter)/queue");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not accept the invitation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 12 }}>
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5 }}>
            Join your team on kloop
          </Text>
          <Text style={{ fontSize: 14, color: colors.textSecondary, marginBottom: 8 }}>
            Set up your account to accept the invitation.
          </Text>
          <Input autoFocus placeholder="Your name" value={name} onChangeText={setName} />
          <Input
            placeholder="Choose a password (min. 8 characters)"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button
            title="Create account"
            size="lg"
            loading={busy}
            disabled={!ready || !token || name.trim().length === 0 || password.length < 8}
            onPress={() => void submit()}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
