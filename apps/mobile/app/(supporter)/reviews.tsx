import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, type ReviewListItem } from "@kloop/shared";
import { api } from "../../src/api";
import { timeAgo } from "../../src/format";
import { useActiveWorkspace } from "../../src/store/connection";
import { Button, Card, EmptyState, KindBadge, PageTitle, Segmented, Spinner } from "../../src/ui";

type Tab = "draft" | "update" | "merge";

/** Review inbox — Drafts / Updates / Merges. */
export default function ReviewsScreen() {
  const ws = useActiveWorkspace();
  const [tab, setTab] = useState<Tab>("draft");
  const { data: countsData } = useQuery({ queryKey: ["review-counts"], queryFn: () => api.reviewCounts() });
  const { data, isLoading } = useQuery({ queryKey: ["reviews", "list"], queryFn: () => api.reviews() });

  const counts = countsData?.counts;
  const items = data?.items ?? [];
  const byTab: Record<Tab, ReviewListItem[]> = {
    draft: items.filter((i) => i.kind === "draft"),
    update: items.filter((i) => i.kind === "update" || i.kind === "stale"),
    merge: items.filter((i) => i.kind === "merge"),
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        <View style={{ paddingTop: 8, paddingBottom: 12 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>{ws?.name}</Text>
          <PageTitle>Reviews</PageTitle>
        </View>

        <View style={{ paddingBottom: 12 }}>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "draft", label: `Drafts · ${counts?.draft ?? 0}` },
              { value: "update", label: `Updates · ${counts ? counts.update + counts.stale : 0}` },
              { value: "merge", label: `Merges · ${counts?.merge ?? 0}` },
            ]}
          />
        </View>

        {isLoading ? (
          <Spinner />
        ) : byTab[tab].length === 0 ? (
          <EmptyState title="Nothing to review" hint="New drafts, updates, and merge proposals land here." />
        ) : (
          <View style={{ gap: 10 }}>
            {byTab[tab].map((item) => (
              <ReviewCard key={item.id} item={item} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ReviewCard({ item }: { item: ReviewListItem }) {
  const router = useRouter();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["reviews"] });
    void qc.invalidateQueries({ queryKey: ["review-counts"] });
  };
  const approve = useMutation({ mutationFn: () => api.approveReview(item.id), onSuccess: invalidate });
  const reject = useMutation({ mutationFn: () => api.rejectReview(item.id), onSuccess: invalidate });

  const confidenceLabel = item.confidence >= 0.75 ? "high confidence" : item.confidence >= 0.45 ? "medium confidence" : "low confidence";
  const title = item.kind === "stale" ? `${item.kb} · ${item.title ?? "Article"}` : (item.title ?? "Untitled draft");
  const open = () => router.push(item.kind === "stale" ? `/article/${item.articleId}` : `/review/${item.id}`);

  return (
    <Card onPress={open} style={{ padding: 14, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <KindBadge kind={item.kind} />
        {/* long stale contexts truncate instead of overflowing the card */}
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, color: colors.textSecondary }}>
          {item.kind === "stale" ? (item.context ?? "flagged") : confidenceLabel}
        </Text>
      </View>
      <Text style={{ fontWeight: "700", fontSize: 15, color: colors.text, lineHeight: 20 }}>{title}</Text>
      <Text style={{ fontSize: 13, color: colors.textSecondary }}>
        {item.kind === "stale" ? (item.staleReason ?? "Needs a look") : (item.context ?? "")} · {timeAgo(item.createdAt)} ago
      </Text>

      {item.kind === "draft" ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <Button title="Approve" size="sm" style={{ flex: 1 }} loading={approve.isPending} onPress={() => approve.mutate()} />
          <Button title="Read" size="sm" variant="secondary" style={{ flex: 1 }} onPress={open} />
          <Button title="Reject" size="sm" variant="danger" style={{ flex: 1 }} loading={reject.isPending} onPress={() => reject.mutate()} />
        </View>
      ) : item.kind === "stale" ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
          <Button title="Review article ›" size="sm" variant="secondary" style={{ flex: 2 }} onPress={() => router.push(`/article/${item.articleId}`)} />
          <Button title="Looks fine" size="sm" variant="outline" style={{ flex: 1 }} loading={reject.isPending} onPress={() => reject.mutate()} />
        </View>
      ) : (
        <Button
          title={item.kind === "merge" ? "Review merge ›" : "Review update ›"}
          size="sm"
          variant="secondary"
          style={{ marginTop: 4 }}
          onPress={() => router.push(`/review/${item.id}`)}
        />
      )}
    </Card>
  );
}
