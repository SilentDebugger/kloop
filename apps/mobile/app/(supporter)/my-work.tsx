import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors, type RequestSummary } from "@kloop/shared";
import { api } from "../../src/api";
import { dateLabel, timeAgo } from "../../src/format";
import { useActiveWorkspace } from "../../src/store/connection";
import { Card, Chip, Divider, EmptyState, GroupedCard, PageTitle, PastRow, ReplyPreview, SectionLabel, Spinner, StatusLine } from "../../src/ui";

/** The requester a row belongs to (guests count too) — used for the person filter. */
function requesterName(r: RequestSummary): string | null {
  return r.author?.name ?? (r.guestName ? `${r.guestName} (guest)` : null);
}

/** My work — claimed requests, waiting-on-confirmation, recently solved. Filterable by person. */
export default function MyWorkScreen() {
  const ws = useActiveWorkspace();
  const [person, setPerson] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["requests", "my-work"], queryFn: () => api.requests({ view: "queue" }) });

  const mine = (data?.requests ?? []).filter((r) => r.claimedBy === ws?.user?.id);
  const people = [...new Set(mine.map(requesterName).filter(Boolean) as string[])].sort();
  const shown = person ? mine.filter((r) => requesterName(r) === person) : mine;
  const active = shown.filter((r) => r.status !== "solved" && r.confirmationState !== "pending");
  const waiting = shown.filter((r) => r.confirmationState === "pending");
  const solved = shown.filter((r) => r.status === "solved").slice(0, 15);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        <View style={{ paddingTop: 8, paddingBottom: 14 }}>
          <PageTitle>My work</PageTitle>
        </View>
        {people.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 14 }}>
            {people.map((p) => (
              <Chip key={p} label={p} active={person === p} onPress={() => setPerson(person === p ? null : p)} />
            ))}
          </ScrollView>
        )}
        {isLoading ? (
          <Spinner />
        ) : mine.length === 0 ? (
          <EmptyState title="Nothing claimed yet" hint="Claim requests from the queue and they'll show up here." />
        ) : shown.length === 0 ? (
          <EmptyState title="Nothing for this person" hint="They have no requests in your claimed work." />
        ) : (
          <View style={{ gap: 22 }}>
            {active.length > 0 && <ActiveGroup label={`Handling · ${active.length}`} rows={active} />}
            {waiting.length > 0 && <ActiveGroup label={`Waiting for confirmation · ${waiting.length}`} rows={waiting} waitingOnConfirmation />}
            {solved.length > 0 && <PastGroup rows={solved} />}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ActiveGroup({ label, rows, waitingOnConfirmation }: { label: string; rows: RequestSummary[]; waitingOnConfirmation?: boolean }) {
  const router = useRouter();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ paddingHorizontal: 4 }}>
        <SectionLabel>{label}</SectionLabel>
      </View>
      <View style={{ gap: 10 }}>
        {rows.map((r) => {
          const meta = waitingOnConfirmation ? "awaiting confirmation" : `updated ${timeAgo(r.lastActivityAt)} ago`;
          return (
            <Card key={r.id} onPress={() => router.push(`/request/${r.id}`)} style={{ padding: 14 }}>
              <StatusLine status="handled" meta={meta} />
              <Text
                style={{ fontWeight: r.unreadForSupporter ? "800" : "700", fontSize: 16, color: colors.text, marginTop: 6, lineHeight: 21 }}
              >
                {r.title}
              </Text>
              <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
                {r.ref} · {requesterName(r) ?? ""}
              </Text>
              {r.lastMessage && (
                <ReplyPreview
                  name={r.lastMessage.fromAi ? "kloop" : (r.lastMessage.authorName ?? "Reply")}
                  body={r.lastMessage.body}
                  unread={r.unreadForSupporter}
                />
              )}
            </Card>
          );
        })}
      </View>
    </View>
  );
}

function PastGroup({ rows }: { rows: RequestSummary[] }) {
  const router = useRouter();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ paddingHorizontal: 4 }}>
        <SectionLabel>Recently solved</SectionLabel>
      </View>
      <GroupedCard>
        {rows.map((r, i) => (
          <View key={r.id}>
            {i > 0 && <Divider />}
            <PastRow
              title={r.title}
              subtitle={`Solved ${dateLabel(r.solvedAt)} · ${requesterName(r) ?? ""}`}
              onPress={() => router.push(`/request/${r.id}`)}
            />
          </View>
        ))}
      </GroupedCard>
    </View>
  );
}
