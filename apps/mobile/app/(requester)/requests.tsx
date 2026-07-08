import { useState } from "react";
import { LayoutAnimation, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useQuery } from "@tanstack/react-query";
import { colors, type RequestSummary } from "@kloop/shared";
import { api } from "../../src/api";
import { dateLabel, timeAgo } from "../../src/format";
import { Card, Divider, EmptyState, GroupedCard, PageTitle, PastRow, ReplyPreview, SectionLabel, Spinner } from "../../src/ui";

/** rows shown before a "Show N more" toggle appears — keeps the quiet groups short by default */
const VISIBLE = 4;

/** My requests — attention-first: unread replies and active work up top, quiet groups collapsed below. */
export default function MyRequestsScreen() {
  const { data, isLoading, refetch } = useQuery({ queryKey: ["requests", "mine"], queryFn: () => api.requests() });

  const requests = data?.requests ?? [];
  const open = requests.filter((r) => r.status !== "solved");
  const attention = open.filter((r) => r.unreadForRequester);
  const handled = open.filter((r) => r.status === "handled" && !r.unreadForRequester);
  const waiting = open.filter((r) => r.status === "open" && !r.unreadForRequester);
  const past = requests.filter((r) => r.status === "solved");

  const empty = !isLoading && requests.length === 0;

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
              {attention.length > 0 ? ` · ${attention.length} repl${attention.length > 1 ? "ies" : "y"} waiting for you` : ""}
            </Text>
          )}
        </View>

        {isLoading ? (
          <Spinner />
        ) : empty ? (
          <EmptyState title="Nothing here yet" hint="When you ask for help, your requests and their status show up here." />
        ) : (
          <>
            {attention.length > 0 && (
              <View style={{ gap: 10 }}>
                <SectionHeader label="Needs your attention" count={attention.length} dot />
                {attention.map((r) => (
                  <AttentionCard key={r.id} r={r} />
                ))}
              </View>
            )}

            {handled.length > 0 && (
              <View style={{ gap: 10, marginTop: attention.length > 0 ? 22 : 0 }}>
                <SectionHeader label="Being handled" count={handled.length} />
                {handled.map((r) => (
                  <HandledCard key={r.id} r={r} />
                ))}
              </View>
            )}

            {waiting.length > 0 && (
              <View style={{ marginTop: attention.length > 0 || handled.length > 0 ? 22 : 0 }}>
                <SectionHeader label="Waiting for a supporter" hint="no action needed" />
                <CollapsibleGroup items={waiting}>
                  {(r, i) => <WaitingRow key={r.id} r={r} first={i === 0} />}
                </CollapsibleGroup>
              </View>
            )}

            {past.length > 0 && (
              <View style={{ marginTop: attention.length > 0 || handled.length > 0 || waiting.length > 0 ? 22 : 0 }}>
                <SectionHeader label="Past" count={past.length} />
                <CollapsibleGroup items={past}>
                  {(r, i) => <PastGroupRow key={r.id} r={r} first={i === 0} />}
                </CollapsibleGroup>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ label, count, hint, dot }: { label: string; count?: number; hint?: string; dot?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 4, paddingBottom: 8, gap: 6 }}>
      {dot && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />}
      <SectionLabel>
        {label}
        {count != null ? ` · ${count}` : ""}
      </SectionLabel>
      {hint ? (
        <Text style={{ marginLeft: "auto", fontSize: 11, fontWeight: "600", color: colors.textFaint, textTransform: "uppercase", letterSpacing: 0.4 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Highlighted card for an unread reply — thin tinted border, unread dot, reply preview. */
function AttentionCard({ r }: { r: RequestSummary }) {
  const router = useRouter();
  return (
    <Card onPress={() => router.push(`/request/${r.id}`)} style={{ padding: 14, borderWidth: 1.5, borderColor: `${colors.primary}40` }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 12, fontWeight: "700", color: colors.primary }}>New reply · {timeAgo(r.lastActivityAt)}</Text>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />
      </View>
      <Text style={{ fontWeight: "800", fontSize: 16, color: colors.text, marginTop: 6, lineHeight: 21 }}>{r.title}</Text>
      {r.lastMessage && (
        <ReplyPreview name={r.lastMessage.fromAi ? "kloop" : (r.lastMessage.authorName ?? "Reply")} body={r.lastMessage.body} />
      )}
    </Card>
  );
}

/** Quiet card for open requests a supporter has already claimed — no unread reply, nothing urgent to read. */
function HandledCard({ r }: { r: RequestSummary }) {
  const router = useRouter();
  return (
    <Card onPress={() => router.push(`/request/${r.id}`)} style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontWeight: "700", fontSize: 15, color: colors.text }}>
          {r.title}
        </Text>
        <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>A supporter is on it · updated {timeAgo(r.lastActivityAt)} ago</Text>
      </View>
      <SymbolView name={{ ios: "chevron.right", android: "chevron_right" }} size={13} tintColor={colors.textFaint} />
    </Card>
  );
}

/** Compact row for requests still waiting on a supporter — hollow dot, title, timestamp, nothing to act on. */
function WaitingRow({ r, first }: { r: RequestSummary; first: boolean }) {
  const router = useRouter();
  return (
    <View>
      {!first && <Divider />}
      <Pressable
        onPress={() => router.push(`/request/${r.id}`)}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ width: 7, height: 7, borderRadius: 3.5, borderWidth: 1.5, borderColor: colors.textFaint }} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: "600", color: colors.text }}>
          {r.title}
        </Text>
        <Text style={{ fontSize: 12, color: colors.textFaint }}>{timeAgo(r.lastActivityAt)}</Text>
      </Pressable>
    </View>
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

/**
 * Wraps a `GroupedCard` list, showing only the first `VISIBLE` rows with a
 * "Show N more" toggle at the bottom; expanding/collapsing animates via
 * `LayoutAnimation` instead of snapping the list open.
 */
function CollapsibleGroup<T extends { id: string }>({ items, children }: { items: T[]; children: (item: T, index: number) => React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = items.length - VISIBLE;
  const shown = expanded || hiddenCount <= 0 ? items : items.slice(0, VISIBLE);

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(260, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
    setExpanded((e) => !e);
  };

  return (
    <GroupedCard>
      {shown.map((item, i) => children(item, i))}
      {hiddenCount > 0 && (
        <View>
          <Divider />
          <Pressable onPress={toggle} style={({ pressed }) => ({ paddingVertical: 12, alignItems: "center", opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.primary }}>{expanded ? "Show less" : `Show ${hiddenCount} more`}</Text>
          </Pressable>
        </View>
      )}
    </GroupedCard>
  );
}
