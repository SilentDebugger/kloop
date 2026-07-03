import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@kloop/shared";
import { api } from "../../src/api";
import { timeAgo } from "../../src/format";
import { Card, EmptyState, Input, PageTitle, SectionLabel, Spinner, StatusBadge } from "../../src/ui";

/** Global hybrid search — articles, requests, resolutions. */
export default function SearchScreen() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(id);
  }, [text]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: q.length >= 2,
    staleTime: 30_000,
  });

  const hasResults = data && (data.articles.length > 0 || data.requests.length > 0 || data.resolutions.length > 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingTop: 8, paddingBottom: 12 }}>
          <PageTitle>Search</PageTitle>
        </View>
        <Input
          autoFocus
          placeholder="Search everything — meaning, not just keywords…"
          value={text}
          onChangeText={setText}
          style={{ borderColor: "transparent" }}
        />

        {isFetching && <Spinner pad={20} />}
        {!q && !isFetching && <EmptyState title="Search the whole loop" hint="Articles, requests, and resolutions — hybrid semantic + keyword search." />}
        {q.length >= 2 && data && !hasResults && !isFetching && <EmptyState title="No matches" hint="Try different words — search also matches by meaning." />}

        {hasResults && (
          <View style={{ gap: 18, marginTop: 14 }}>
            {data.articles.length > 0 && (
              <View style={{ gap: 8 }}>
                <SectionLabel>Articles</SectionLabel>
                {data.articles.map((a) => (
                  <Card key={a.id} onPress={() => router.push(`/article/${a.id}`)} style={{ padding: 14 }}>
                    <Text style={{ fontWeight: "600", fontSize: 15, color: colors.text }}>{a.title}</Text>
                    <Text numberOfLines={1} style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
                      {a.kb}
                      {a.summary ? ` · ${a.summary}` : ""}
                    </Text>
                  </Card>
                ))}
              </View>
            )}
            {data.requests.length > 0 && (
              <View style={{ gap: 8 }}>
                <SectionLabel>Requests</SectionLabel>
                {data.requests.map((r) => (
                  <Card key={r.id} onPress={() => router.push(`/request/${r.id}`)} style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "600", fontSize: 15, color: colors.text }}>{r.title}</Text>
                      <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
                        {r.ref} · {timeAgo(r.createdAt)} ago
                      </Text>
                    </View>
                    <StatusBadge status={r.status} />
                  </Card>
                ))}
              </View>
            )}
            {data.resolutions.length > 0 && (
              <View style={{ gap: 8 }}>
                <SectionLabel>Resolutions</SectionLabel>
                {data.resolutions.map((r) => (
                  <Card key={r.id} onPress={() => router.push(`/request/${r.requestId}`)} style={{ padding: 14 }}>
                    <Text style={{ fontSize: 14, color: colors.text, lineHeight: 19 }}>{r.summary}</Text>
                    <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>Resolution · {timeAgo(r.createdAt)} ago</Text>
                  </Card>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
