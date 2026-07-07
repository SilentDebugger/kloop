import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, radii } from "@kloop/shared";
import { api } from "../../src/api";
import { haptics } from "../../src/haptics";
import { Button, Card, GlassSurface, SectionLabel, Spinner } from "../../src/ui";
import { MarkdownLite } from "../../src/ui/MarkdownLite";

type BlockShape = { id?: string; kind: string; conditionText: string | null; contentMd: string };
const kindLabels: Record<string, string> = {
  symptoms: "Symptoms",
  environment: "Environment",
  resolution: "Resolution steps",
  notes: "Notes",
};

/** Draft / update / merge review — provenance, blocks, approve / reject. */
export default function ReviewDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["reviews", "detail", id],
    queryFn: () => api.review(id),
    enabled: !!id,
  });

  const done = () => {
    void qc.invalidateQueries({ queryKey: ["reviews"] });
    void qc.invalidateQueries({ queryKey: ["review-counts"] });
    void qc.invalidateQueries({ queryKey: ["articles"] });
    router.back();
  };
  const approve = useMutation({
    mutationFn: () => api.approveReview(id),
    onSuccess: () => {
      haptics.success();
      done();
    },
    onError: () => haptics.error(),
  });
  const reject = useMutation({
    mutationFn: () => api.rejectReview(id),
    onSuccess: () => {
      haptics.warning();
      done();
    },
    onError: () => haptics.error(),
  });

  if (isLoading || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <Spinner />
      </SafeAreaView>
    );
  }

  const payload = data as Record<string, any>;
  const item = payload.item as { kind: string; confidence: number; context: string | null };
  const isMerge = item.kind === "merge";

  const confidenceLabel = item.confidence >= 0.75 ? "high confidence" : item.confidence >= 0.45 ? "medium confidence" : "low confidence";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 8, paddingBottom: 10 }}>
          <Pressable onPress={() => router.back()}>
            <GlassSurface interactive fallbackColor={colors.card} style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 18, color: colors.text }}>‹</Text>
            </GlassSurface>
          </Pressable>
          <View>
            <Text style={{ fontWeight: "700", fontSize: 15, color: colors.text }}>
              {isMerge
                ? `Merge · ${payload.articleA?.kb ?? "?"} + ${payload.articleB?.kb ?? "?"}`
                : `${item.kind === "draft" ? "Draft" : "Update"} · ${payload.article?.kb ?? ""}`}
            </Text>
            <Text style={{ fontSize: 12, color: colors.textSecondary }}>{confidenceLabel}</Text>
          </View>
        </View>

        {isMerge ? <MergeBody payload={payload} /> : <DraftBody reviewId={id} payload={payload} onDone={done} />}
      </ScrollView>

      {/* merge titles are similar lengths — equal halves keep both on one line */}
      <View style={{ position: "absolute", bottom: 24, left: 16, right: 16, flexDirection: "row", gap: 10 }}>
        <Button
          title={isMerge ? "Keep separate" : "Reject"}
          variant="danger"
          style={{ flex: 1 }}
          loading={reject.isPending}
          onPress={() => reject.mutate()}
        />
        <Button
          title={isMerge ? "Approve merge" : "Approve & publish"}
          style={{ flex: isMerge ? 1 : 2 }}
          loading={approve.isPending}
          onPress={() => approve.mutate()}
        />
      </View>
    </SafeAreaView>
  );
}

function DraftBody({ reviewId, payload, onDone }: { reviewId: string; payload: Record<string, any>; onDone: () => void }) {
  const proposed = payload.proposed as { title: string; summary: string; blocks: BlockShape[] };
  const sources = (payload.sources ?? []) as string[];
  const similar = (payload.similarArticles ?? []) as { id: string; kb: string; title: string; summary: string; similarity: number | null }[];
  return (
    <View style={{ gap: 10 }}>
      {sources.length > 0 && (
        <View style={{ backgroundColor: colors.mint, borderRadius: radii.lg, padding: 14, gap: 8 }}>
          <SectionLabel color={colors.primary}>Sources</SectionLabel>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {sources.map((s) => (
              <View key={s} style={{ backgroundColor: colors.card, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}>
                <Text style={{ fontWeight: "600", fontSize: 13, color: colors.text }}>{s}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <Text style={{ fontSize: 23, fontWeight: "800", color: colors.text, lineHeight: 29, marginTop: 6 }}>{proposed.title}</Text>
      {proposed.summary ? <Text style={{ fontSize: 14, color: colors.textSecondary }}>{proposed.summary}</Text> : null}

      {proposed.blocks.map((b, i) => (
        <Card key={i} style={{ padding: 14 }}>
          <SectionLabel>{kindLabels[b.kind] ?? b.kind}</SectionLabel>
          {b.conditionText ? <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 13, marginTop: 3 }}>If: {b.conditionText}</Text> : null}
          <View style={{ marginTop: 6 }}>
            <MarkdownLite text={b.contentMd} />
          </View>
        </Card>
      ))}

      {similar.length > 0 && <SimilarArticles reviewId={reviewId} similar={similar} onDone={onDone} />}
    </View>
  );
}

/** Near-duplicate warning: merge the draft into an existing doc instead of publishing both. */
function SimilarArticles({
  reviewId,
  similar,
  onDone,
}: {
  reviewId: string;
  similar: { id: string; kb: string; title: string; summary: string; similarity: number | null }[];
  onDone: () => void;
}) {
  const [mergingId, setMergingId] = useState<string | null>(null);
  const merge = useMutation({
    mutationFn: (articleId: string) => api.reviewMergeInto(reviewId, articleId),
    onSuccess: () => {
      haptics.success();
      Alert.alert("Merge proposed", "A merge proposal was created — you'll find it in the Merges tab.");
      onDone();
    },
    onError: (err) => {
      haptics.error();
      setMergingId(null);
      Alert.alert("Couldn't propose merge", err instanceof Error ? err.message : "Something went wrong.");
    },
  });

  const confirm = (a: { id: string; kb: string; title: string }) => {
    Alert.alert(
      `Merge into ${a.kb}?`,
      `kloop will combine this draft with "${a.title}" into one merge proposal for review. ${a.kb} keeps its number.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Propose merge",
          onPress: () => {
            setMergingId(a.id);
            merge.mutate(a.id);
          },
        },
      ],
    );
  };

  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radii.lg, padding: 14, gap: 10, marginTop: 4 }}>
      <SectionLabel>Similar existing articles</SectionLabel>
      <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: -4 }}>
        Covers the same ground? Merge instead of publishing a duplicate.
      </Text>
      {similar.map((a) => (
        <View key={a.id} style={{ backgroundColor: colors.card, borderRadius: radii.md, padding: 12, gap: 8 }}>
          <View>
            <Text style={{ fontWeight: "600", fontSize: 14, color: colors.text }}>
              {a.kb} · {a.title}
            </Text>
            {a.summary ? (
              <Text numberOfLines={2} style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                {a.summary}
              </Text>
            ) : null}
            {a.similarity != null ? (
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600", marginTop: 2 }}>
                {Math.round(a.similarity * 100)}% similar
              </Text>
            ) : null}
          </View>
          <Button
            title={`Merge into ${a.kb}`}
            size="sm"
            variant="secondary"
            loading={merge.isPending && mergingId === a.id}
            disabled={merge.isPending}
            onPress={() => confirm(a)}
          />
        </View>
      ))}
    </View>
  );
}

function MergeBody({ payload }: { payload: Record<string, any> }) {
  const proposal = payload.mergeCandidate?.proposal as
    | { mergedTitle: string; rationale: string; blocks: { kind: string; conditionText?: string | null; contentMd: string; origin?: string }[] }
    | null;
  return (
    <View style={{ gap: 10 }}>
      {proposal?.rationale ? (
        <View style={{ backgroundColor: colors.mint, borderRadius: radii.lg, padding: 14, gap: 4 }}>
          <SectionLabel color={colors.primary}>Why merge these?</SectionLabel>
          <Text style={{ fontSize: 14, color: colors.text, lineHeight: 20 }}>{proposal.rationale}</Text>
        </View>
      ) : null}

      {[payload.articleA, payload.articleB].map(
        (a: { kb: string; title: string; blocks: BlockShape[] } | null, idx: number) =>
          a && (
            <View key={idx} style={{ backgroundColor: colors.surface, borderRadius: radii.lg, padding: 14, gap: 8 }}>
              <Text style={{ fontWeight: "700", fontSize: 14, color: colors.text }}>
                {a.kb} · {a.title}
              </Text>
              {a.blocks.map((b, i) => (
                <View key={i} style={{ backgroundColor: colors.background, borderRadius: radii.md, padding: 10 }}>
                  <SectionLabel>{kindLabels[b.kind] ?? b.kind}</SectionLabel>
                  <View style={{ marginTop: 4 }}>
                    <MarkdownLite text={b.contentMd} size={13} />
                  </View>
                </View>
              ))}
            </View>
          ),
      )}

      {proposal && (
        <View style={{ backgroundColor: colors.card, borderRadius: radii.lg, padding: 14, gap: 8, borderWidth: 2, borderColor: colors.primary }}>
          <Text style={{ fontWeight: "700", fontSize: 14, color: colors.text }}>Proposed · {proposal.mergedTitle}</Text>
          {proposal.blocks.map((b, i) => (
            <View key={i} style={{ backgroundColor: colors.background, borderRadius: radii.md, padding: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <SectionLabel>{kindLabels[b.kind] ?? b.kind}</SectionLabel>
                {b.origin ? <Text style={{ fontSize: 10, fontWeight: "700", color: colors.textFaint, textTransform: "uppercase" }}>{b.origin}</Text> : null}
              </View>
              {b.conditionText ? <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 12, marginTop: 2 }}>If: {b.conditionText}</Text> : null}
              <View style={{ marginTop: 4 }}>
                <MarkdownLite text={b.contentMd} size={13} />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
