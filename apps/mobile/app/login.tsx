import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ApiError } from "@kloop/shared";
import { colors } from "@kloop/shared";
import { api } from "../src/api";
import { haptics } from "../src/haptics";
import { registerPush } from "../src/push";
import { useActiveWorkspace, useConnection } from "../src/store/connection";
import { Button, Card, ErrorNote, Input } from "../src/ui";

/** Org-branded login: magic link (enter code from email) or password. */
export default function LoginScreen() {
  const router = useRouter();
  const ws = useActiveWorkspace();
  const setSession = useConnection((s) => s.setSession);
  const removeWorkspace = useConnection((s) => s.removeWorkspace);
  const activeIndex = useConnection((s) => s.activeIndex);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"magic" | "password" | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ws) return null;
  const effectiveMode = mode ?? (ws.auth.magicLink ? "magic" : "password");

  const finishLogin = (token: string, user: Parameters<typeof setSession>[1]) => {
    haptics.success();
    setSession(token, user);
    void registerPush();
    router.replace(user.role === "requester" ? "/(requester)" : "/(supporter)/queue");
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      if (effectiveMode === "magic") {
        await api.requestMagicLink(email.trim());
        haptics.success();
        setSent(true);
      } else {
        const res = await api.login(email.trim(), password);
        finishLogin(res.token, res.user);
      }
    } catch (e) {
      haptics.error();
      setError(e instanceof ApiError ? e.message : "Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: 24, justifyContent: "center", gap: 12 }}>
          <View
            style={{
              width: 60,
              height: 60,
              borderRadius: 16,
              backgroundColor: colors.mint,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 8,
            }}
          >
            <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 26 }}>{ws.name[0]?.toUpperCase()}</Text>
          </View>
          <Text style={{ fontSize: 27, fontWeight: "800", color: colors.text, letterSpacing: -0.5 }}>Sign in to {ws.name}</Text>
          <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}>
            <Text style={{ fontSize: 14, color: colors.textSecondary }}>{ws.origin.replace(/^https?:\/\//, "")} ·</Text>
            <Pressable
              onPress={() => {
                removeWorkspace(activeIndex);
                router.replace("/connect");
              }}
            >
              <Text style={{ fontSize: 14, color: colors.primary, fontWeight: "600" }}>change</Text>
            </Pressable>
          </View>

          {sent ? (
            <Card style={{ backgroundColor: colors.mint, padding: 18, gap: 6 }}>
              <Text style={{ fontWeight: "700", color: colors.primary, fontSize: 15 }}>Check your email</Text>
              <Text style={{ fontSize: 14, color: colors.text, lineHeight: 20 }}>
                If an account exists for {email}, a sign-in link is on its way. Open it on this device to finish signing in.
              </Text>
              <Pressable onPress={() => setSent(false)}>
                <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 13, marginTop: 6 }}>Use a different email</Text>
              </Pressable>
            </Card>
          ) : (
            <View style={{ gap: 10 }}>
              <Input
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChangeText={setEmail}
              />
              {effectiveMode === "password" && (
                <Input placeholder="Password" secureTextEntry autoComplete="current-password" value={password} onChangeText={setPassword} />
              )}
              {error ? <ErrorNote>{error}</ErrorNote> : null}
              <Button
                title={effectiveMode === "magic" ? "Send magic link" : "Sign in"}
                size="lg"
                loading={busy}
                disabled={!email.includes("@") || (effectiveMode === "password" && !password)}
                onPress={() => void submit()}
              />
              {ws.auth.magicLink && ws.auth.password && (
                <Pressable onPress={() => setMode(effectiveMode === "magic" ? "password" : "magic")}>
                  <Text style={{ textAlign: "center", fontWeight: "600", fontSize: 14, color: colors.text, paddingVertical: 8 }}>
                    {effectiveMode === "magic" ? "Use a password instead" : "Use a magic link instead"}
                  </Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
        <Text style={{ textAlign: "center", fontSize: 12, color: colors.textFaint, paddingBottom: 16 }}>
          Auth methods are set by your organization
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
