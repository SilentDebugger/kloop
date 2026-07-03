import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors, type RequestSummary } from "@kloop/shared";
import { api } from "../../src/api";
import { sentLabel, timeAgo } from "../../src/format";
import { Card, EmptyState, PageTitle, SectionLabel, Spinner, StatusBadge } from "../../src/ui";

/** My requests — minimal status only, per the mockup. */
export default function MyRequestsScreen() {
  const { data, isLoading, refetch } = useQuery({ queryKey: ["requests", "mine"], queryFn: () => api.requests() });

  const open = (data?.requests ?? []).filter((r) => r.status !== "solved");
  const solved = (data?.requests ?? []).filter((r) => r.status === "solved");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        onScrollBeginDrag={() => void refetch()}
      >
        <View style={{ paddingTop: 8, paddingBottom: 14 }}>
          <PageTitle>My requests</PageTitle>
        </View>

        {isLoading ? (
          <Spinner />
        ) : open.length === 0 && solved.length === 0 ? (
          <EmptyState title="Nothing here yet" hint="When you ask for help, your requests and their status show up here." />
        ) : (
          <View style={{ gap: 10 }}>
            {open.length > 0 && (
              <View style={{ paddingHorizontal: 4 }}>
                <SectionLabel>Open</SectionLabel>
              </View>
            )}
            {open.map((r) => (
              <Row key={r.id} r={r} />
            ))}
            {solved.length > 0 && (
              <View style={{ paddingHorizontal: 4, paddingTop: 14 }}>
                <SectionLabel>Solved</SectionLabel>
              </View>
            )}
            {solved.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ r }: { r: RequestSummary }) {
  const router = useRouter();
  const sub =
    r.status === "solved"
      ? r.selfSolvedArticleId
        ? `Self-solved ${timeAgo(r.solvedAt)} ago · from suggested article`
        : r.confirmationState === "confirmed"
          ? `Solved ${timeAgo(r.solvedAt)} ago · you confirmed the fix`
          : `Solved ${timeAgo(r.solvedAt)} ago`
      : `Sent ${sentLabel(r.createdAt)}${r.unreadForRequester ? " · new reply" : ""}`;

  return (
    <Card onPress={() => router.push(`/request/${r.id}`)} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: r.unreadForRequester ? "800" : "600", fontSize: 15, color: colors.text, lineHeight: 20 }}>{r.title}</Text>
        <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>{sub}</Text>
      </View>
      <StatusBadge status={r.status} />
    </Card>
  );
}
