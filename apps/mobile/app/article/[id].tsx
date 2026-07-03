import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { colors, radii, type ArticleBlockView } from "@kloop/shared";
import { api } from "../../src/api";
import { timeAgo } from "../../src/format";
import { useDrafts } from "../../src/store/drafts";
import { Button, Card, Chip, SectionLabel, Spinner } from "../../src/ui";
import { MarkdownLite } from "../../src/ui/MarkdownLite";

const blockLabels: Record<string, string> = {
  symptoms: "Symptoms",
  environment: "Environment",
  resolution: "Resolution steps",
  notes: "Notes",
};

/**
 * Article view. With ?answer=1 it becomes the "Suggested answer" screen:
 * bottom bar offers "This solved it" / "Still need help — send my request".
 */
export default function ArticleScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; answer?: string; draftTitle?: string }>();
  const answerMode = params.answer === "1";
  const draftTitle = params.draftTitle ?? "";
  const { setComposerText } = useDrafts();
  const [feedback, setFeedback] = useState<boolean | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["article", params.id],
    queryFn: () => api.article(params.id),
    enabled: !!params.id,
  });

  useEffect(() => {
    if (data?.redirectTo) router.replace(`/article/${data.redirectTo}`);
  }, [data?.redirectTo, router]);

  const solved = useMutation({
    mutationFn: () => api.selfSolve({ title: draftTitle || `Self-solved via ${data?.article.kb}`, articleId: params.id }),
    onSuccess: (res) => {
      setComposerText("");
      router.replace(`/request/${res.request.id}`);
    },
  });
  const escalate = useMutation({
    mutationFn: () => api.createRequest({ title: draftTitle, channel: "mobile" }),
    onSuccess: (res) => {
      setComposerText("");
      router.replace(`/request/${res.request.id}`);
    },
  });

  if (isLoading || !data || data.redirectTo) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <Spinner />
      </SafeAreaView>
    );
  }

  const { article, blocks } = data;
  const total = article.helpfulCount + article.notHelpfulCount;
  const pct = total > 0 ? Math.round((article.helpfulCount / total) * 100) : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: answerMode ? 170 : 60 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 8, paddingBottom: 8 }}>
          <Pressable
            onPress={() => router.back()}
            style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ fontSize: 18, color: colors.text }}>‹</Text>
          </Pressable>
          <Text style={{ fontWeight: "700", fontSize: 16, color: colors.text }}>{answerMode ? "Suggested answer" : article.kb}</Text>
        </View>

        <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text, letterSpacing: -0.4, lineHeight: 30, marginTop: 8 }}>
          {article.title}
        </Text>
        <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 4, marginBottom: 14 }}>
          {article.kb} · Updated {timeAgo(article.updatedAt)} ago{pct != null ? ` · ${pct}% found this helpful` : ""}
        </Text>

        <View style={{ gap: 10 }}>
          {blocks.map((b: ArticleBlockView) =>
            b.kind === "notes" ? (
              <View key={b.id} style={{ backgroundColor: colors.chip, borderRadius: radii.md, padding: 14 }}>
                <MarkdownLite text={b.contentMd} size={14} />
              </View>
            ) : (
              <Card key={b.id} style={{ padding: 14 }}>
                <SectionLabel>{blockLabels[b.kind] ?? b.kind}</SectionLabel>
                {b.conditionText ? (
                  <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 13, marginTop: 3 }}>If: {b.conditionText}</Text>
                ) : null}
                <View style={{ marginTop: 6 }}>
                  <MarkdownLite text={b.contentMd} />
                </View>
              </Card>
            ),
          )}
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 18 }}>
          <Text style={{ fontSize: 14, color: colors.textSecondary }}>Was this helpful?</Text>
          <Chip
            label="Yes"
            active={feedback === true}
            onPress={() => {
              setFeedback(true);
              void api.articleFeedback(params.id, true).catch(() => {});
            }}
          />
          <Chip
            label="No"
            active={feedback === false}
            onPress={() => {
              setFeedback(false);
              void api.articleFeedback(params.id, false).catch(() => {});
            }}
          />
        </View>
      </ScrollView>

      {answerMode && (
        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 28, gap: 12, backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
          <Button title="This solved it" size="lg" loading={solved.isPending} onPress={() => solved.mutate()} />
          {draftTitle ? (
            <Pressable onPress={() => escalate.mutate()} disabled={escalate.isPending}>
              <Text style={{ textAlign: "center", fontWeight: "600", fontSize: 14, color: colors.text }}>
                Still need help — send my request
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </SafeAreaView>
  );
}
