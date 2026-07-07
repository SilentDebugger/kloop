import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors, type RequestSummary } from "@kloop/shared";
import { api } from "../../src/api";
import { dateLabel, timeAgo } from "../../src/format";
import { Card, Divider, EmptyState, GroupedCard, PageTitle, PastRow, ReplyPreview, SectionLabel, Spinner, StatusLine } from "../../src/ui";

/** My requests — status-first cards up top, quiet history below. */
export default function MyRequestsScreen() {
  const { data, isLoading, refetch } = useQuery({ queryKey: ["requests", "mine"], queryFn: () => api.requests() });

  const open = (data?.requests ?? []).filter((r) => r.status !== "solved");
  const solved = (data?.requests ?? []).filter((r) => r.status === "solved");
  const waiting = open.filter((r) => r.unreadForRequester).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        onScrollBeginDrag={() => void refetch()}
      >
        <View style={{ paddingTop: 8, paddingBottom: 16 }}>
          <PageTitle>My requests</PageTitle>
          {open.length > 0 && (
            <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 3 }}>
              {open.length} open
              {waiting > 0 ? ` · ${waiting} repl${waiting > 1 ? "ies" : "y"} waiting for you` : ""}
            </Text>
          )}
        </View>

        {isLoading ? (
          <Spinner />
        ) : open.length === 0 && solved.length === 0 ? (
          <EmptyState title="Nothing here yet" hint="When you ask for help, your requests and their status show up here." />
        ) : (
          <>
            {open.length > 0 && (
              <View style={{ gap: 10 }}>
                {open.map((r) => (
                  <OpenCard key={r.id} r={r} />
                ))}
              </View>
            )}

            {solved.length > 0 && (
              <View style={{ marginTop: open.length > 0 ? 22 : 0 }}>
                <View style={{ paddingHorizontal: 4, paddingBottom: 8 }}>
                  <SectionLabel>Past</SectionLabel>
                </View>
                <GroupedCard>
                  {solved.map((r, i) => (
                    <PastGroupRow key={r.id} r={r} first={i === 0} />
                  ))}
                </GroupedCard>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function OpenCard({ r }: { r: RequestSummary }) {
  const router = useRouter();
  const meta = r.status === "handled" ? `updated ${timeAgo(r.lastActivityAt)} ago` : "waiting for a supporter";

  return (
    <Card onPress={() => router.push(`/request/${r.id}`)} style={{ padding: 14 }}>
      <StatusLine status={r.status === "handled" ? "handled" : "open"} meta={meta} />
      <Text style={{ fontWeight: "800", fontSize: 16, color: colors.text, marginTop: 6, lineHeight: 21 }}>{r.title}</Text>
      {r.lastMessage && (
        <ReplyPreview
          name={r.lastMessage.fromAi ? "kloop" : (r.lastMessage.authorName ?? "Reply")}
          body={r.lastMessage.body}
          unread={r.unreadForRequester}
        />
      )}
    </Card>
  );
}

function PastGroupRow({ r, first }: { r: RequestSummary; first: boolean }) {
  const router = useRouter();
  const subtitle = r.selfSolvedArticleId ? `Self-solved ${dateLabel(r.solvedAt)}` : `Solved ${dateLabel(r.solvedAt)}`;
  return (
    <View>
      {!first && <Divider />}
      <PastRow title={r.title} subtitle={subtitle} onPress={() => router.push(`/request/${r.id}`)} />
    </View>
  );
}
