import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors, type RequestSummary } from "@kloop/shared";
import { api } from "../../src/api";
import { timeAgo } from "../../src/format";
import { useActiveWorkspace } from "../../src/store/connection";
import { Card, EmptyState, PageTitle, SectionLabel, Spinner, StatusBadge } from "../../src/ui";

/** My work — claimed requests, waiting-on-confirmation, recently solved. */
export default function MyWorkScreen() {
  const ws = useActiveWorkspace();
  const { data, isLoading } = useQuery({ queryKey: ["requests", "my-work"], queryFn: () => api.requests({ view: "queue" }) });

  const mine = (data?.requests ?? []).filter((r) => r.claimedBy === ws?.user?.id);
  const active = mine.filter((r) => r.status !== "solved" && r.confirmationState !== "pending");
  const waiting = mine.filter((r) => r.confirmationState === "pending");
  const solved = mine.filter((r) => r.status === "solved").slice(0, 15);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}>
        <View style={{ paddingTop: 8, paddingBottom: 14 }}>
          <PageTitle>My work</PageTitle>
        </View>
        {isLoading ? (
          <Spinner />
        ) : mine.length === 0 ? (
          <EmptyState title="Nothing claimed yet" hint="Claim requests from the queue and they'll show up here." />
        ) : (
          <View style={{ gap: 18 }}>
            {active.length > 0 && <Group label={`Handling · ${active.length}`} rows={active} />}
            {waiting.length > 0 && <Group label={`Waiting for confirmation · ${waiting.length}`} rows={waiting} />}
            {solved.length > 0 && <Group label="Recently solved" rows={solved} />}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ label, rows }: { label: string; rows: RequestSummary[] }) {
  const router = useRouter();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ paddingHorizontal: 4 }}>
        <SectionLabel>{label}</SectionLabel>
      </View>
      {rows.map((r) => (
        <Card key={r.id} onPress={() => router.push(`/request/${r.id}`)} style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: r.unreadForSupporter ? "800" : "600", fontSize: 15, color: colors.text, lineHeight: 20 }}>{r.title}</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
              {r.ref} · {r.author?.name ?? ""} · {timeAgo(r.lastActivityAt)} ago
            </Text>
          </View>
          <StatusBadge status={r.status} />
        </Card>
      ))}
    </View>
  );
}
