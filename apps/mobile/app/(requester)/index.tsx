import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { colors, radii, type DeflectionSuggestion } from "@kloop/shared";
import { api } from "../../src/api";
import { useDrafts } from "../../src/store/drafts";
import { useActiveWorkspace } from "../../src/store/connection";
import { useComposerAttachments } from "../../src/uploads";
import { Avatar, Card, Logo, SectionLabel, Spinner } from "../../src/ui";
import { AttachChips, AttachmentTray } from "../../src/ui/attachments";

/** Home — the one-box composer with live deflection ("What's not working?"). */
export default function HomeScreen() {
  const router = useRouter();
  const ws = useActiveWorkspace();
  const { composerText, setComposerText, queue, dequeue } = useDrafts();
  const [text, setText] = useState(composerText);
  const [debounced, setDebounced] = useState("");
  const att = useComposerAttachments();
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    setComposerText(text);
    const id = setTimeout(() => setDebounced(text.trim()), 450);
    return () => clearTimeout(id);
  }, [text, setComposerText]);

  // attachments deflect too (photo of an error screen, voice note); their
  // OCR/transcription lands async, so re-ask while the server reports pending
  const { data: deflect, isFetching } = useQuery({
    queryKey: ["deflect", debounced, att.ids.join(",")],
    queryFn: () => api.deflect(debounced, att.ids),
    enabled: debounced.length >= 8 || att.ids.length > 0,
    staleTime: 30_000,
    refetchInterval: (q) => ((q.state.data?.pendingAttachments ?? 0) > 0 ? 3000 : false),
  });

  const send = useMutation({
    mutationFn: () => api.createRequest({ title: text.trim(), channel: "mobile", attachmentIds: att.ids }),
    onSuccess: (res) => {
      setText("");
      setComposerText("");
      att.clear();
      router.push(`/request/${res.request.id}`);
    },
    onError: () => {
      // offline: queue the draft and sync later
      useDrafts.getState().enqueue(text.trim());
      setText("");
      setComposerText("");
    },
  });

  // background sync of offline-queued drafts
  useEffect(() => {
    for (const draft of queue) {
      api
        .createRequest({ title: draft.title, channel: "mobile" })
        .then(() => dequeue(draft.localId))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suggestions = deflect?.suggestions ?? [];
  const canSend = text.trim().length >= 3 && !send.isPending && !att.uploading;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
          {/* header: org + avatar */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 }}>
            <Logo size={26} />
            <Text style={{ fontWeight: "700", fontSize: 16, color: colors.text, flex: 1 }}>{ws?.name ?? "kloop"}</Text>
            <Pressable onPress={() => router.push("/(requester)/settings")}>
              <Avatar name={ws?.user?.name} size={36} tint />
            </Pressable>
          </View>

          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5, marginTop: 8, marginBottom: 14 }}>
            What's not working?
          </Text>

          {/* composer card */}
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: radii.lg,
              borderWidth: 2,
              borderColor: colors.primary,
              padding: 14,
              gap: 12,
            }}
          >
            <TextInput
              ref={inputRef}
              multiline
              placeholder="Describe the problem…"
              placeholderTextColor={colors.textFaint}
              value={text}
              onChangeText={setText}
              style={{ minHeight: 64, fontSize: 16, color: colors.text, textAlignVertical: "top" }}
            />
            <AttachmentTray items={att.attachments} onRemove={att.remove} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <AttachChips recording={att.recording} attach={att.attach} />
              <View style={{ flex: 1 }} />
              {/* same round submit as the chat composer — the chips need the width */}
              <Pressable
                onPress={() => send.mutate()}
                disabled={!canSend}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: colors.primary,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: canSend ? 1 : 0.4,
                }}
              >
                {send.isPending || att.uploading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <SymbolView name={{ ios: "arrow.up", android: "arrow_upward" }} size={17} weight="semibold" tintColor="#fff" />
                )}
              </Pressable>
            </View>
          </View>

          {queue.length > 0 && (
            <View style={{ backgroundColor: colors.amberSoft, borderRadius: radii.md, padding: 12, marginTop: 10 }}>
              <Text style={{ color: colors.amber, fontSize: 13, fontWeight: "500" }}>
                {queue.length} draft{queue.length > 1 ? "s" : ""} queued offline — will send when you're back online.
              </Text>
            </View>
          )}

          {/* live deflection */}
          {isFetching && suggestions.length === 0 && <Spinner pad={20} />}
          {suggestions.length > 0 && (
            <View style={{ marginTop: 24, gap: 10 }}>
              <View style={{ paddingHorizontal: 4 }}>
                <SectionLabel>This might solve it</SectionLabel>
              </View>
              {suggestions.map((s) => (
                <SuggestionCard key={`${s.kind}-${s.id}`} s={s} draftTitle={text.trim()} />
              ))}
            </View>
          )}

          <Pressable onPress={() => router.push("/kb")} style={{ marginTop: 28 }}>
            <Text style={{ textAlign: "center", color: colors.primary, fontWeight: "600", fontSize: 14 }}>Browse help articles →</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SuggestionCard({ s, draftTitle }: { s: DeflectionSuggestion; draftTitle: string }) {
  const router = useRouter();
  return (
    <Card
      onPress={() => router.push({ pathname: "/article/[id]", params: { id: s.id, draftTitle, answer: "1" } })}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}
    >
      <Logo size={22} stroke={4.5} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "600", fontSize: 15, color: colors.text, lineHeight: 20 }}>{s.title}</Text>
        <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
          Article{s.helpfulPercent != null ? ` · ${s.helpfulPercent}% found this helpful` : ""}
        </Text>
      </View>
      <Text style={{ color: colors.textFaint, fontSize: 18 }}>›</Text>
    </Card>
  );
}
