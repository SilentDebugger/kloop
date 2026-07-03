import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { colors, radii, type DeflectionSuggestion } from "@kloop/shared";
import { api } from "../../src/api";
import { useDrafts } from "../../src/store/drafts";
import { useActiveWorkspace } from "../../src/store/connection";
import { useVoiceNote } from "../../src/recorder";
import { pickImage, uploadFile } from "../../src/uploads";
import { Avatar, Button, Card, Chip, Logo, SectionLabel, Spinner } from "../../src/ui";

/** Home — the one-box composer with live deflection ("What's not working?"). */
export default function HomeScreen() {
  const router = useRouter();
  const ws = useActiveWorkspace();
  const { composerText, setComposerText, queue, dequeue } = useDrafts();
  const [text, setText] = useState(composerText);
  const [debounced, setDebounced] = useState("");
  const [attachments, setAttachments] = useState<{ id: string; filename: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const voice = useVoiceNote();
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    setComposerText(text);
    const id = setTimeout(() => setDebounced(text.trim()), 450);
    return () => clearTimeout(id);
  }, [text, setComposerText]);

  const { data: deflect, isFetching } = useQuery({
    queryKey: ["deflect", debounced],
    queryFn: () => api.deflect(debounced),
    enabled: debounced.length >= 8,
    staleTime: 30_000,
  });

  const send = useMutation({
    mutationFn: () => api.createRequest({ title: text.trim(), channel: "mobile", attachmentIds: attachments.map((a) => a.id) }),
    onSuccess: (res) => {
      setText("");
      setComposerText("");
      setAttachments([]);
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

  const attach = async (kind: "camera" | "photo" | "voice") => {
    try {
      if (kind === "voice") {
        if (voice.recording) {
          const note = await voice.stop();
          if (note) {
            setUploading(true);
            const a = await uploadFile(note);
            setAttachments((x) => [...x, { id: a.id, filename: a.filename }]);
          }
        } else {
          await voice.start();
        }
        return;
      }
      const picked = await pickImage(kind === "camera");
      if (picked) {
        setUploading(true);
        const a = await uploadFile(picked);
        setAttachments((x) => [...x, { id: a.id, filename: a.filename }]);
      }
    } catch {
      /* upload failed — keep composing */
    } finally {
      setUploading(false);
    }
  };

  const suggestions = deflect?.suggestions ?? [];
  const canSend = text.trim().length >= 3 && !send.isPending;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}>
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
            {attachments.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {attachments.map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={() => setAttachments((x) => x.filter((y) => y.id !== a.id))}
                    style={{ backgroundColor: colors.mint, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 }}
                  >
                    <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "500" }}>{a.filename} ✕</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Chip label="Camera" onPress={() => void attach("camera")} />
              <Chip label="Photo" onPress={() => void attach("photo")} />
              <Chip label={voice.recording ? "Stop ●" : "Voice"} active={voice.recording} onPress={() => void attach("voice")} />
              <View style={{ flex: 1 }} />
              <Button title="Send" size="sm" disabled={!canSend} loading={send.isPending || uploading} onPress={() => send.mutate()} />
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
  if (s.kind === "article") {
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
  return (
    <Card style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginLeft: 5 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: "600", fontSize: 15, color: colors.text, lineHeight: 20 }}>"{s.title}" — solved</Text>
        <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
          Similar request{s.resolutionMinutes != null ? ` · resolved in ${s.resolutionMinutes} min` : ""}
        </Text>
      </View>
    </Card>
  );
}
