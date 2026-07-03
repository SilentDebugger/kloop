import { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, radii, type MessageView, type RequestDetail } from "@kloop/shared";
import { api } from "../../src/api";
import { clockTime, sentLabel } from "../../src/format";
import { useActiveWorkspace } from "../../src/store/connection";
import { pickImage, uploadFile } from "../../src/uploads";
import { useVoiceNote } from "../../src/recorder";
import { Button, Card, Chip, SectionLabel, Spinner, StatusBadge } from "../../src/ui";
import { ResolveSheet } from "../../src/screens/ResolveSheet";

/** Request thread — requester confirm loop / supporter workbench in one route. */
export default function RequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ws = useActiveWorkspace();
  const user = ws?.user;

  const { data, isLoading } = useQuery({
    queryKey: ["request", id],
    queryFn: () => api.requestDetail(id),
    enabled: !!id,
    refetchInterval: 20_000,
  });

  if (isLoading || !data) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <Spinner />
      </SafeAreaView>
    );
  }

  const supporterView = user && user.role !== "requester" && data.request.author?.id !== user.id;
  return supporterView ? <Workbench detail={data} /> : <RequesterThread detail={data} />;
}

/* ===================================================================== */

function BackHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  const router = useRouter();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 8, paddingBottom: 10, paddingHorizontal: 16 }}>
      <Pressable
        onPress={() => router.back()}
        style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" }}
      >
        <Text style={{ fontSize: 18, color: colors.text }}>‹</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontWeight: "700", fontSize: 15, color: colors.text }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textSecondary }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

function RequesterThread({ detail }: { detail: RequestDetail }) {
  const { request, messages } = detail;
  const ws = useActiveWorkspace();
  const qc = useQueryClient();

  const confirm = useMutation({
    mutationFn: (fixed: boolean) => api.confirm(request.id, fixed),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["request", request.id] }),
  });
  const reopen = useMutation({
    mutationFn: () => api.reopen(request.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["request", request.id] }),
  });

  const reached = request.status === "solved" ? 2 : request.status === "handled" ? 1 : 0;
  const resolverName = request.claimer?.name ?? "Support";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <BackHeader title={request.title} subtitle={`Sent ${sentLabel(request.createdAt)}`} right={<StatusBadge status={request.status} />} />

        {/* status timeline */}
        <View style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
          <View style={{ height: 3, backgroundColor: colors.border, borderRadius: 2 }}>
            <View style={{ height: 3, width: `${(reached / 2) * 100}%`, backgroundColor: colors.primary, borderRadius: 2 }} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
            {["Sent", "Being handled", "Solved"].map((s, i) => (
              <Text key={s} style={{ fontSize: 12, fontWeight: "600", color: i <= reached ? colors.primary : colors.textFaint }}>
                {s}
              </Text>
            ))}
          </View>
        </View>

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, gap: 10 }}>
          {messages.map((m) => (
            <Bubble key={m.id} m={m} ownId={ws?.user?.id ?? ""} />
          ))}

          {request.confirmationState === "pending" && (
            <View style={{ backgroundColor: colors.mint, borderRadius: radii.lg, padding: 18, gap: 4 }}>
              <Text style={{ fontWeight: "800", fontSize: 17, color: colors.text }}>Did this fix it?</Text>
              <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                {request.autoAnswered && !request.claimer ? "kloop suggested this fix automatically." : `${resolverName} marked this as resolved.`}
              </Text>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                <Button title="Yes, it's fixed" style={{ flex: 1 }} loading={confirm.isPending} onPress={() => confirm.mutate(true)} />
                <Button title="Not yet" variant="outline" style={{ flex: 1 }} disabled={confirm.isPending} onPress={() => confirm.mutate(false)} />
              </View>
            </View>
          )}

          {request.status === "solved" && (
            <Pressable onPress={() => reopen.mutate()} disabled={reopen.isPending}>
              <Text style={{ textAlign: "center", fontSize: 13, fontWeight: "600", color: colors.textSecondary, textDecorationLine: "underline" }}>
                Something's still wrong — reopen
              </Text>
            </Pressable>
          )}
        </ScrollView>

        <Composer requestId={request.id} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ===================================================================== */

function Workbench({ detail }: { detail: RequestDetail }) {
  const { request, messages } = detail;
  const ws = useActiveWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const [resolveOpen, setResolveOpen] = useState(false);

  const { data: precedents } = useQuery({
    queryKey: ["precedents", request.id],
    queryFn: () => api.precedents(request.id),
    staleTime: 5 * 60_000,
  });

  const claim = useMutation({
    mutationFn: () => api.claim(request.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["request", request.id] });
      void qc.invalidateQueries({ queryKey: ["requests"] });
    },
  });

  const similar = precedents?.similarSolved ?? [];
  const matched = precedents?.matchedArticles ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <BackHeader
          title={request.title}
          subtitle={`${request.ref} · ${request.author?.name ?? ""} · ${request.authorPastRequests ?? 1} past requests`}
          right={
            request.status === "open" && !request.claimedBy ? (
              <Button title="Claim" size="sm" variant="mint" loading={claim.isPending} onPress={() => claim.mutate()} />
            ) : (
              <StatusBadge status={request.status === "handled" ? "handled" : request.status} />
            )
          }
        />

        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, gap: 10 }}>
          {(similar.length > 0 || matched.length > 0) && (
            <View style={{ backgroundColor: colors.mint, borderRadius: radii.lg, padding: 14, gap: 8 }}>
              <SectionLabel color={colors.primary}>Precedents · {similar.length} similar solved</SectionLabel>
              {similar.length > 0 && (
                <Text style={{ fontSize: 14, color: colors.text, lineHeight: 19 }}>
                  {similar.map((s) => s.ref).join(", ")}
                  {similar[0]?.resolution?.summary ? ` — ${similar[0].resolution.summary.slice(0, 110)}` : ""}
                </Text>
              )}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                {matched.slice(0, 2).map((a) => (
                  <Pressable key={a.id} onPress={() => router.push(`/article/${a.id}`)} style={{ backgroundColor: colors.card, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>
                      {a.kb} · {a.title.length > 26 ? `${a.title.slice(0, 26)}…` : a.title}
                    </Text>
                  </Pressable>
                ))}
                {similar.slice(0, 1).map((s) => (
                  <Pressable key={s.id} onPress={() => router.push(`/request/${s.id}`)}>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>View {s.ref} ›</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {messages.map((m) => (
            <Bubble key={m.id} m={m} ownId={ws?.user?.id ?? ""} supporterView />
          ))}

          {request.status !== "solved" && (
            <Pressable
              onPress={() => (request.claimedBy ? setResolveOpen(true) : claim.mutate(undefined, { onSuccess: () => setResolveOpen(true) }))}
              style={{ alignSelf: "center", backgroundColor: colors.card, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20, marginTop: 6 }}
            >
              <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>✓ Mark resolved</Text>
            </Pressable>
          )}
          {request.confirmationState === "pending" && (
            <Text style={{ textAlign: "center", fontSize: 13, color: colors.textSecondary }}>
              Waiting for {request.author?.name ?? "the requester"} to confirm the fix.
            </Text>
          )}
        </ScrollView>

        <Composer requestId={request.id} supporter />
        <ResolveSheet
          open={resolveOpen}
          onClose={() => setResolveOpen(false)}
          requestId={request.id}
          onResolved={() => {
            setResolveOpen(false);
            void qc.invalidateQueries({ queryKey: ["request", request.id] });
            void qc.invalidateQueries({ queryKey: ["requests"] });
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ===================================================================== */

function Bubble({ m, ownId, supporterView }: { m: MessageView; ownId: string; supporterView?: boolean }) {
  const router = useRouter();
  if (m.kind === "system") {
    return <Text style={{ textAlign: "center", fontSize: 12, color: colors.textFaint, paddingVertical: 2 }}>{m.body}</Text>;
  }
  if (m.kind === "internal_note") {
    return (
      <View style={{ backgroundColor: colors.noteBg, borderRadius: radii.lg, padding: 14 }}>
        <SectionLabel color={colors.noteLabel}>Internal note</SectionLabel>
        <Text style={{ fontSize: 14, color: colors.text, lineHeight: 20, marginTop: 4 }}>{m.body}</Text>
        <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 5 }}>
          {m.author?.name} · {clockTime(m.createdAt)}
        </Text>
      </View>
    );
  }

  const own = m.author?.id === ownId;
  const meta = [
    m.author?.name ?? (m.kind === "auto_answer" ? "kloop" : "System"),
    clockTime(m.createdAt),
    m.fromAiDraft ? "from AI draft, edited" : null,
    m.kind === "auto_answer" ? "auto-answer" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View
      style={{
        backgroundColor: own ? colors.primary : colors.card,
        borderRadius: radii.lg,
        padding: 14,
        maxWidth: "92%",
        alignSelf: supporterView && own ? "flex-end" : "flex-start",
      }}
    >
      <Text style={{ fontSize: 15, lineHeight: 21, color: own ? "#fff" : colors.text }}>{m.body}</Text>
      {m.attachments && m.attachments.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {m.attachments.map((a) =>
            a.kind === "image" ? (
              <Image key={a.id} source={{ uri: api.attachmentRawUrl(a.id) }} style={{ width: 140, height: 100, borderRadius: 10 }} />
            ) : (
              <View key={a.id} style={{ backgroundColor: own ? "rgba(255,255,255,0.2)" : colors.chip, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 }}>
                <Text style={{ fontSize: 12, color: own ? "#fff" : colors.text }}>
                  {a.kind === "audio" ? "🎙 " : "📎 "}
                  {a.filename}
                </Text>
              </View>
            ),
          )}
        </View>
      )}
      {m.articleId ? (
        <Pressable onPress={() => router.push(`/article/${m.articleId}`)}>
          <Text style={{ fontSize: 13, fontWeight: "600", textDecorationLine: "underline", color: own ? "#fff" : colors.primary, marginTop: 6 }}>
            View the article ›
          </Text>
        </Pressable>
      ) : null}
      <Text style={{ fontSize: 12, color: own ? "rgba(255,255,255,0.7)" : colors.textSecondary, marginTop: 5 }}>{meta}</Text>
    </View>
  );
}

/* ===================================================================== */

function Composer({ requestId, supporter }: { requestId: string; supporter?: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const [fromDraft, setFromDraft] = useState(false);
  const [attachments, setAttachments] = useState<{ id: string; filename: string }[]>([]);
  const voice = useVoiceNote();

  const [draftWanted, setDraftWanted] = useState(false);
  const { data: draft, isFetching: draftLoading } = useQuery({
    queryKey: ["ai-draft", requestId],
    queryFn: () => api.aiDraft(requestId),
    enabled: !!supporter && draftWanted,
    staleTime: Infinity,
  });

  if (draftWanted && draft?.draft && !text && !fromDraft) {
    setText(draft.draft.body);
    setFromDraft(true);
  }

  const send = useMutation({
    mutationFn: () =>
      api.postMessage(requestId, {
        body: text.trim(),
        kind: note ? "internal_note" : "message",
        fromAiDraft: fromDraft,
        attachmentIds: attachments.map((a) => a.id),
      }),
    onSuccess: () => {
      setText("");
      setAttachments([]);
      setFromDraft(false);
      setNote(false);
      void qc.invalidateQueries({ queryKey: ["request", requestId] });
    },
  });

  const attach = async () => {
    try {
      const picked = await pickImage(false);
      if (picked) {
        const a = await uploadFile(picked);
        setAttachments((x) => [...x, { id: a.id, filename: a.filename }]);
      }
    } catch {
      /* ignore */
    }
  };

  const toggleVoice = async () => {
    if (voice.recording) {
      const noteFile = await voice.stop();
      if (noteFile) {
        try {
          const a = await uploadFile(noteFile);
          setAttachments((x) => [...x, { id: a.id, filename: a.filename }]);
        } catch {
          /* ignore */
        }
      }
    } else {
      await voice.start();
    }
  };

  const canSend = text.trim().length > 0 && !send.isPending;

  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 10, gap: 8 }}>
      {supporter && (
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 4 }}>
          <Chip
            label={draftLoading ? "Drafting…" : draft?.draft ? "✦ AI draft ready" : "✦ AI draft"}
            onPress={() => setDraftWanted(true)}
            style={{ backgroundColor: colors.mint }}
          />
          <Chip label="Internal note" active={note} onPress={() => setNote((n) => !n)} />
        </View>
      )}
      {attachments.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 4 }}>
          {attachments.map((a) => (
            <Pressable
              key={a.id}
              onPress={() => setAttachments((x) => x.filter((y) => y.id !== a.id))}
              style={{ backgroundColor: colors.mint, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12 }}
            >
              <Text style={{ color: colors.primary, fontSize: 12 }}>{a.filename} ✕</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
          backgroundColor: note ? colors.noteBg : colors.card,
          borderRadius: 26,
          padding: 8,
          shadowColor: "#1D1B16",
          shadowOpacity: 0.1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 3 },
          elevation: 4,
        }}
      >
        <Pressable onPress={() => void attach()} style={roundBtn(colors.chip)}>
          <Text style={{ fontSize: 17, color: colors.textSecondary }}>＋</Text>
        </Pressable>
        <Pressable onPress={() => void toggleVoice()} style={roundBtn(voice.recording ? colors.danger : colors.chip)}>
          <Text style={{ fontSize: 14, color: voice.recording ? "#fff" : colors.textSecondary }}>🎙</Text>
        </Pressable>
        <TextInput
          multiline
          placeholder={note ? "Internal note…" : "Reply…"}
          placeholderTextColor={colors.textFaint}
          value={text}
          onChangeText={setText}
          style={{ flex: 1, maxHeight: 120, fontSize: 15, color: colors.text, paddingVertical: 9, paddingHorizontal: 4 }}
        />
        <Pressable onPress={() => send.mutate()} disabled={!canSend} style={[roundBtn(colors.primary), { opacity: canSend ? 1 : 0.4 }]}>
          <Text style={{ fontSize: 16, color: "#fff" }}>↑</Text>
        </Pressable>
      </View>
    </View>
  );
}

function roundBtn(bg: string) {
  return { width: 40, height: 40, borderRadius: 20, backgroundColor: bg, alignItems: "center" as const, justifyContent: "center" as const };
}
