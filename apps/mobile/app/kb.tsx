import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@kloop/shared";
import { api } from "../src/api";
import { timeAgo } from "../src/format";
import { Card, Chip, EmptyState, Input, PageTitle, Spinner } from "../src/ui";

/** KB browser — published articles, tag facets, text filter. */
export default function KbScreen() {
  const router = useRouter();
  const [tag, setTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["articles", tag ?? ""],
    queryFn: () => api.articles(tag ? { tag } : {}),
  });

  const needle = search.trim().toLowerCase();
  const articles = (data?.articles ?? []).filter(
    (a) => !needle || a.title.toLowerCase().includes(needle) || a.summary.toLowerCase().includes(needle),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 8, paddingBottom: 12 }}>
          <Pressable onPress={() => router.back()} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ fontSize: 18, color: colors.text }}>‹</Text>
          </Pressable>
          <PageTitle>Knowledge base</PageTitle>
        </View>

        <Input placeholder="Search articles…" value={search} onChangeText={setSearch} style={{ borderColor: "transparent" }} />

        {(data?.tags?.length ?? 0) > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 12 }}>
            {(data!.tags as { tag: string; n: number }[]).slice(0, 12).map((tg) => (
              <Chip key={tg.tag} label={tg.tag} active={tag === tg.tag} onPress={() => setTag(tag === tg.tag ? null : tg.tag)} />
            ))}
          </ScrollView>
        )}

        {isLoading ? (
          <Spinner />
        ) : articles.length === 0 ? (
          <EmptyState title="No articles yet" hint="Solved requests become living documentation here." />
        ) : (
          <View style={{ gap: 10, marginTop: 4 }}>
            {articles.map((a) => {
              const total = a.helpfulCount + a.notHelpfulCount;
              const pct = total > 0 ? ` · ${Math.round((a.helpfulCount / total) * 100)}% helpful` : "";
              return (
                <Card key={a.id} onPress={() => router.push(`/article/${a.id}`)} style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "600", fontSize: 15, color: colors.text, lineHeight: 20 }}>{a.title}</Text>
                    <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
                      {a.kb} · updated {timeAgo(a.updatedAt)} ago{pct}
                    </Text>
                  </View>
                  <Text style={{ color: colors.textFaint, fontSize: 18 }}>›</Text>
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
