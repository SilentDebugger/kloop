import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, type RequestSummary } from "@kloop/shared";
import { api } from "../../src/api";
import { timeAgo } from "../../src/format";
import { useActiveWorkspace } from "../../src/store/connection";
import { Avatar, Button, Card, Chip, EmptyState, PageTitle, ReplyPreview, Segmented, Spinner, StatusLine } from "../../src/ui";

type Scope = "unassigned" | "mine" | "ai" | "all";

/** Open requests the AI is currently handling (answered, unclaimed, awaiting the user). */
function isAiHandled(r: RequestSummary): boolean {
  return r.autoAnswered && !r.claimedBy && r.status !== "solved";
}

/** Queue — filters, claim, unread; the supporter home. */
export default function QueueScreen() {
  const router = useRouter();
  const ws = useActiveWorkspace();
  const [scope, setScope] = useState<Scope>("unassigned");
  const [tag, setTag] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["requests", "queue"],
    queryFn: () => api.requests({ view: "queue" }),
    refetchInterval: 30_000,
  });

  const all = data?.requests ?? [];
  const open = all.filter((r) => r.status !== "solved");
  // AI-handled requests get their own segment so "Unassigned" means "needs a human"
  const ai = open.filter(isAiHandled);
  const unassigned = open.filter((r) => !r.claimedBy && !isAiHandled(r));
  const mine = open.filter((r) => r.claimedBy === ws?.user?.id);
  const scoped = scope === "unassigned" ? unassigned : scope === "mine" ? mine : scope === "ai" ? ai : all;
  const rows = tag ? scoped.filter((r) => r.tags.includes(tag)) : scoped;
  const allTags = [...new Set(open.flatMap((r) => r.tags))].slice(0, 10);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", paddingTop: 8, paddingBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>{ws?.name}</Text>
            <PageTitle>Queue</PageTitle>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            {/* log a request for a user or guest */}
            <Pressable
              onPress={() => router.push("/new-request")}
              style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center" }}
            >
              <SymbolView name={{ ios: "plus", android: "add" }} size={17} weight="semibold" tintColor={colors.primary} />
            </Pressable>
            <Pressable onPress={() => router.push("/settings")}>
              <Avatar name={ws?.user?.name} size={38} tint />
            </Pressable>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
          <Segmented<Scope>
            value={scope}
            onChange={setScope}
            options={[
              { value: "unassigned", label: `Unassigned · ${unassigned.length}` },
              { value: "mine", label: `Mine · ${mine.length}` },
              { value: "ai", label: `✦ AI · ${ai.length}` },
              { value: "all", label: "All" },
            ]}
          />
        </ScrollView>

        {allTags.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 12 }}>
            {allTags.map((tg) => (
              <Chip key={tg} label={tg} active={tag === tg} onPress={() => setTag(tag === tg ? null : tg)} />
            ))}
          </ScrollView>
        )}

        {isLoading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <EmptyState
            title={scope === "ai" ? "AI has nothing in flight" : "Queue is clear"}
            hint={scope === "ai" ? "Auto-answered requests awaiting the user will show here." : "No requests to handle right now."}
          />
        ) : (
          <View style={{ gap: 10 }}>
            {rows.map((r) => (
              <QueueCard key={r.id} r={r} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function QueueCard({ r }: { r: RequestSummary }) {
  const router = useRouter();
  const qc = useQueryClient();
  const claim = useMutation({
    mutationFn: () => api.claim(r.id),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["requests"] });
      router.push(`/request/${res.request.id}`);
    },
  });

  const requesterName = r.author?.name ?? (r.guestName ? `${r.guestName} (guest)` : "Guest");
  const meta = r.status === "handled" ? `updated ${timeAgo(r.lastActivityAt)} ago` : `received ${timeAgo(r.createdAt)} ago`;
  const flags = [
    r.autoAnswered && r.escalated ? "auto-answer didn't help" : null,
    r.channel === "email" ? "via email-in" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card onPress={() => router.push(`/request/${r.id}`)} style={{ padding: 14, gap: 10 }}>
      <View>
        <StatusLine status={r.status === "handled" ? "handled" : "open"} meta={meta} />
        <Text style={{ fontWeight: "700", fontSize: 16, color: colors.text, marginTop: 6, lineHeight: 21 }}>{r.title}</Text>
        {flags ? <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>{flags}</Text> : null}
        {r.body ? <ReplyPreview name={requesterName} body={r.body} unread={r.unreadForSupporter} /> : null}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {r.tags.slice(0, 3).map((tg) => (
          <View key={tg} style={{ backgroundColor: colors.chip, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: "500" }}>{tg}</Text>
          </View>
        ))}
        {isAiHandled(r) && r.confirmationState === "pending" && (
          <View style={{ backgroundColor: colors.mint, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>✦ Auto-answered</Text>
          </View>
        )}
        {r.escalated && (
          <View style={{ backgroundColor: colors.amberSoft, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 12, color: colors.amber, fontWeight: "600" }}>Escalated</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        {!r.claimedBy ? (
          <Button title="Claim" size="sm" variant="mint" loading={claim.isPending} onPress={() => claim.mutate()} />
        ) : (
          <Text style={{ fontSize: 12, color: colors.textFaint, fontWeight: "500" }}>{r.claimer?.name ?? "claimed"}</Text>
        )}
      </View>
    </Card>
  );
}
