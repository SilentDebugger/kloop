import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { KloopClient, colors, type DiscoveryDoc } from "@kloop/shared";
import { useConnection } from "../src/store/connection";
import { animateLayout, Button, Card, ErrorNote, Input, Logo, Reveal, Spinner } from "../src/ui";

/**
 * Server connect — enter the workspace domain (or scan the QR from the admin
 * area). Fetches /.well-known/kloop.json and shows a live org confirmation
 * card before continuing to login.
 */
export default function ConnectScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ scanned?: string }>();
  const addWorkspace = useConnection((s) => s.addWorkspace);

  const [domain, setDomain] = useState("");
  const [doc, setDoc] = useState<DiscoveryDoc | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const lookup = (raw: string) => {
    animateLayout();
    setDoc(null);
    setError(null);
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length < 4) return;
    const candidate = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    let normalized: string;
    try {
      normalized = new URL(candidate).origin;
    } catch {
      return;
    }
    setChecking(true);
    KloopClient.discover(normalized)
      .then((d) => {
        animateLayout();
        setDoc(d);
        setOrigin(normalized);
      })
      .catch(async () => {
        // dev convenience: retry as http:// for local servers
        if (!trimmed.startsWith("http")) {
          try {
            const httpOrigin = new URL(`http://${trimmed}`).origin;
            const d = await KloopClient.discover(httpOrigin);
            animateLayout();
            setDoc(d);
            setOrigin(httpOrigin);
            return;
          } catch {
            /* fall through */
          }
        }
        animateLayout();
        setError("No kloop workspace found at that address.");
      })
      .finally(() => {
        animateLayout();
        setChecking(false);
      });
  };

  // debounce typing
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => lookup(domain), 600);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  // handle QR scan result
  useEffect(() => {
    if (params.scanned) {
      const url = String(params.scanned).replace(/\/\.well-known\/kloop\.json$/, "");
      setDomain(url);
    }
  }, [params.scanned]);

  const continueToLogin = () => {
    if (!doc || !origin) return;
    addWorkspace({
      origin,
      name: doc.org.name,
      slug: doc.org.slug,
      logoUrl: doc.org.logoUrl,
      theme: doc.org.theme,
      auth: doc.auth,
      token: null,
      user: null,
    });
    // push (not replace) so getting to sign-in is a native slide with
    // swipe-back to re-pick the workspace; login collapses the stack on success
    router.push("/login");
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: 24, justifyContent: "center", gap: 16 }}>
          <Logo size={56} stroke={5} />
          <Text style={{ fontSize: 30, fontWeight: "800", color: colors.text, letterSpacing: -0.5, lineHeight: 36 }}>
            Connect to your{"\n"}workspace
          </Text>
          <Text style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 20 }}>
            Enter your organization's kloop domain, or scan the QR code from your IT team.
          </Text>

          <Input
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="support.fjord.io"
            value={domain}
            onChangeText={setDomain}
            style={{ borderColor: doc ? colors.primary : colors.border, borderWidth: 1.5 }}
          />

          {checking && <Spinner pad={8} />}
          {error && !checking ? (
            <Reveal>
              <ErrorNote>{error}</ErrorNote>
            </Reveal>
          ) : null}

          {doc && !checking && (
            <Reveal>
              <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: colors.mint,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 17 }}>{doc.org.name[0]?.toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: "700", fontSize: 15, color: colors.text }}>{doc.org.name}</Text>
                  <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                    Found{doc.auth.oidc ? " · SSO enabled" : ""}{doc.auth.magicLink ? " · magic link" : ""}
                  </Text>
                </View>
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: colors.primary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>✓</Text>
                </View>
              </Card>
            </Reveal>
          )}
        </View>

        <View style={{ paddingHorizontal: 24, paddingBottom: 16, gap: 14 }}>
          <Button title="Continue" size="lg" disabled={!doc} onPress={continueToLogin} />
          <Pressable onPress={() => router.push("/qr-scan")}>
            <Text style={{ textAlign: "center", fontWeight: "600", fontSize: 14, color: colors.text }}>Scan QR code instead</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
