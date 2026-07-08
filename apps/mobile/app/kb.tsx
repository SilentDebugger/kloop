import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@kloop/shared";
import { api } from "../src/api";
import { timeAgo } from "../src/format";
import { useComposerAttachments } from "../src/uploads";
import { Card, Chip, EmptyState, GlassSurface, Input, PageTitle, Spinner } from "../src/ui";
import { AttachChips, AttachmentTray } from "../src/ui/attachments";

/**
 * KB browser — published articles with tag facets. Typing (or attaching a
 * photo / voice memo) switches to hybrid semantic search over the same docs.
 */
export default function KbScreen() {
  const router = useRouter();
  const [tag, setTag] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const att = useComposerAttachments();

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  const searching = q.length >= 2 || att.ids.length > 0;

  const { data, isLoading } = useQuery({
    queryKey: ["articles", tag ?? ""],
    queryFn: () => api.articles(tag ? { tag } : {}),
  });
  const { data: found, isFetching: searchLoading } = useQuery({
    queryKey: ["search", q, att.ids.join(",")],
    queryFn: () => api.search(q, att.ids),
    enabled: searching,
    staleTime: 30_000,
    refetchInterval: (query) => ((query.state.data?.pendingAttachments ?? 0) > 0 ? 3000 : false),
  });

  const browse = data?.articles ?? [];
  const loading = searching ? searchLoading || att.uploading || (found?.pendingAttachments ?? 0) > 0 : isLoading;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 8, paddingBottom: 12 }}>
          <Pressable onPress={() => router.back()}>
            <GlassSurface interactive fallbackColor={colors.card} style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontSize: 18, color: colors.text }}>‹</Text>
            </GlassSurface>
          </Pressable>
          <PageTitle>Knowledge base</PageTitle>
        </View>

        <Input placeholder="Search articles — text, photo, or voice…" value={search} onChangeText={setSearch} style={{ borderColor: "transparent" }} />
        <View style={{ marginTop: 10, gap: 10 }}>
          <AttachmentTray items={att.attachments} onRemove={att.remove} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <AttachChips recording={att.recording} attach={att.attach} error={att.error} onDismissError={att.dismissError} />
          </View>
        </View>

        {!searching && (data?.tags?.length ?? 0) > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 12 }}>
            {(data!.tags as { tag: string; n: number }[]).slice(0, 12).map((tg) => (
              <Chip key={tg.tag} label={tg.tag} active={tag === tg.tag} onPress={() => setTag(tag === tg.tag ? null : tg.tag)} />
            ))}
          </ScrollView>
        )}

        {loading ? (
          <Spinner />
        ) : searching ? (
          (found?.articles.length ?? 0) === 0 ? (
            <EmptyState title="No matches" hint="Try different words — search also matches by meaning." />
          ) : (
            <View style={{ gap: 10, marginTop: 12 }}>
              {found!.articles.map((a) => (
                <Card key={a.id} onPress={() => router.push(`/article/${a.id}`)} style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "600", fontSize: 15, color: colors.text, lineHeight: 20 }}>{a.title}</Text>
                    <Text numberOfLines={1} style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
                      {a.kb}
                      {a.summary ? ` · ${a.summary}` : ""}
                    </Text>
                  </View>
                  <Text style={{ color: colors.textFaint, fontSize: 18 }}>›</Text>
                </Card>
              ))}
            </View>
          )
        ) : browse.length === 0 ? (
          <EmptyState title="No articles yet" hint="Solved requests become living documentation here." />
        ) : (
          <View style={{ gap: 10, marginTop: 4 }}>
            {browse.map((a) => {
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
