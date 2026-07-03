import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, type RequestSummary } from "@kloop/shared";
import { api } from "../../src/api";
import { timeAgo } from "../../src/format";
import { useActiveWorkspace } from "../../src/store/connection";
import { Avatar, Button, Card, Chip, EmptyState, PageTitle, Segmented, Spinner } from "../../src/ui";

type Scope = "unassigned" | "mine" | "all";

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
  const unassigned = open.filter((r) => !r.claimedBy);
  const mine = open.filter((r) => r.claimedBy === ws?.user?.id);
  const scoped = scope === "unassigned" ? unassigned : scope === "mine" ? mine : all;
  const rows = tag ? scoped.filter((r) => r.tags.includes(tag)) : scoped;
  const allTags = [...new Set(open.flatMap((r) => r.tags))].slice(0, 10);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", paddingTop: 8, paddingBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>{ws?.name}</Text>
            <PageTitle>Queue</PageTitle>
          </View>
          <Pressable onPress={() => router.push("/settings")}>
            <Avatar name={ws?.user?.name} size={38} tint />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
          <Segmented<Scope>
            value={scope}
            onChange={setScope}
            options={[
              { value: "unassigned", label: `Unassigned · ${unassigned.length}` },
              { value: "mine", label: `Mine · ${mine.length}` },
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
          <EmptyState title="Queue is clear" hint="No requests to handle right now." />
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

  const sub = [
    r.author?.name,
    r.autoAnswered && r.escalated ? "auto-answer didn't help" : null,
    r.channel === "email" ? "via email-in" : null,
    r.body ? `"${r.body.slice(0, 50)}${r.body.length > 50 ? "…" : ""}"` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Card onPress={() => router.push(`/request/${r.id}`)} style={{ padding: 14, gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {r.unreadForSupporter && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 }} />}
        <View style={{ flex: 1 }}>
          <Text style={{ fontWeight: "700", fontSize: 15, color: colors.text, lineHeight: 20 }}>{r.title}</Text>
          <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2, lineHeight: 18 }}>{sub}</Text>
        </View>
        <Text style={{ fontSize: 12, color: colors.textFaint }}>{timeAgo(r.createdAt)}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {r.tags.slice(0, 3).map((tg) => (
          <View key={tg} style={{ backgroundColor: colors.chip, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 12, color: colors.textSecondary, fontWeight: "500" }}>{tg}</Text>
          </View>
        ))}
        {r.escalated && (
          <View style={{ backgroundColor: colors.mint, borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 }}>
            <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>Escalated</Text>
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
