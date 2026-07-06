import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { colors } from "@kloop/shared";
import { api } from "../api";
import { unregisterPush } from "../push";
import { useConnection } from "../store/connection";
import { Avatar, Button, Card, PageTitle, SectionLabel } from "../ui";

// keys must match PREF_BY_TYPE in apps/server/src/lib/notify.ts
const NOTIFICATION_PREFS: { key: string; label: string; supporterOnly?: boolean }[] = [
  { key: "replies", label: "Replies" },
  { key: "statusChanges", label: "Status changes" },
  { key: "reviewItems", label: "Review items", supporterOnly: true },
];

/** Settings — profile, notification toggles, workspaces, sign out. */
export function SettingsScreen() {
  const router = useRouter();
  const { workspaces, activeIndex, setActive, setUser, signOutActive } = useConnection();
  const ws = workspaces[activeIndex];
  const user = ws?.user;

  const updatePrefs = useMutation({
    mutationFn: (prefs: Record<string, boolean>) => api.updateProfile({ notificationPrefs: prefs }),
    onSuccess: (res) => setUser(res.user),
  });

  const signOut = async () => {
    await unregisterPush(); // while the session is still valid
    await api.logout().catch(() => {});
    signOutActive();
    router.replace("/login");
  };

  if (!user || !ws) return null;
  const prefs = user.notificationPrefs ?? {};

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 10 }}>
        <View style={{ paddingTop: 8, paddingBottom: 8 }}>
          <PageTitle>Settings</PageTitle>
        </View>

        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
          <Avatar name={user.name} size={44} tint />
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", fontSize: 15, color: colors.text }}>{user.name}</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary, textTransform: "capitalize" }}>
              {user.role} · {user.email}
            </Text>
          </View>
        </Card>

        <View style={{ paddingHorizontal: 4, paddingTop: 14, paddingBottom: 4 }}>
          <SectionLabel>Notifications</SectionLabel>
        </View>
        <Card>
          {NOTIFICATION_PREFS.filter((p) => !p.supporterOnly || user.role !== "requester").map((p, i, arr) => (
            <View
              key={p.key}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: i < arr.length - 1 ? 1 : 0,
                borderBottomColor: colors.border,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: "500", color: colors.text }}>{p.label}</Text>
              <Switch
                value={prefs[p.key] !== false}
                onValueChange={(v) => updatePrefs.mutate({ ...prefs, [p.key]: v })}
                trackColor={{ true: colors.primary, false: colors.border }}
                thumbColor="#fff"
              />
            </View>
          ))}
        </Card>

        <View style={{ paddingHorizontal: 4, paddingTop: 14, paddingBottom: 4 }}>
          <SectionLabel>Workspaces</SectionLabel>
        </View>
        <Card>
          {workspaces.map((w, i) => (
            <Pressable
              key={`${w.origin}-${w.slug}`}
              onPress={() => {
                if (i !== activeIndex) {
                  setActive(i);
                  const nextUser = workspaces[i]?.user;
                  router.replace(!workspaces[i]?.token ? "/login" : nextUser?.role === "requester" ? "/(requester)" : "/(supporter)/queue");
                }
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                paddingHorizontal: 16,
                paddingVertical: 12,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: colors.mintStrong, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: colors.primary, fontWeight: "700" }}>{w.name[0]?.toUpperCase()}</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: "500", color: colors.text }}>{w.name}</Text>
              {i === activeIndex && (
                <View style={{ backgroundColor: colors.mint, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 }}>
                  <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "600" }}>Active</Text>
                </View>
              )}
            </Pressable>
          ))}
          <Pressable
            onPress={() => router.push("/connect")}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 9,
                borderWidth: 1.5,
                borderStyle: "dashed",
                borderColor: colors.textFaint,
              }}
            />
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.primary }}>Add a workspace…</Text>
          </Pressable>
        </Card>

        <Card style={{ marginTop: 14 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              paddingVertical: 13,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: "500", color: colors.text }}>Language</Text>
            <Text style={{ fontSize: 14, color: colors.textSecondary }}>English ›</Text>
          </View>
          <Pressable onPress={() => void signOut()} style={{ paddingHorizontal: 16, paddingVertical: 13 }}>
            <Text style={{ fontSize: 15, fontWeight: "500", color: colors.danger }}>Sign out</Text>
          </Pressable>
        </Card>

        {user.role !== "requester" && (
          <View style={{ marginTop: 14 }}>
            <Button title="Knowledge base" variant="secondary" onPress={() => router.push("/kb")} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
