import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { SymbolView } from "expo-symbols";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, radii, type MessageView, type RequestDetail, type RequestSummary, type ResolutionView } from "@kloop/shared";
import { api } from "../../src/api";
import { clockTime, sentLabel } from "../../src/format";
import { useActiveWorkspace } from "../../src/store/connection";
import { pickImage, uploadFile } from "../../src/uploads";
import { useVoiceNote } from "../../src/recorder";
import { Button, Chip, SectionLabel, Spinner, StatusBadge } from "../../src/ui";
import { AttachmentTray, RemoteAttachments, type LocalAttachment } from "../../src/ui/attachments";

/** Request thread — requester confirm loop / supporter workbench in one route. */
export default function RequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ws = useActiveWorkspace();
  const user = ws?.user;
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["request", id],
    queryFn: () => api.requestDetail(id),
    enabled: !!id,
    refetchInterval: 20_000,
  });

  const supporterView = user && user.role !== "requester" && data?.request.author?.id !== user.id;

  // Fetching the detail marks the request read on the server, but no SSE event
  // reaches this very client — patch the cached lists so row + tab badges
  // clear the moment the thread opens instead of on the next refetch.
  useEffect(() => {
    if (!data) return;
    const flag = supporterView ? "unreadForSupporter" : "unreadForRequester";
    qc.setQueriesData<{ requests: RequestSummary[] }>({ queryKey: ["requests"] }, (old) =>
      old ? { ...old, requests: old.requests.map((r) => (r.id === data.request.id ? { ...r, [flag]: false } : r)) } : old,
    );
  }, [data, supporterView, qc]);

  // One SafeAreaView for both the loading and loaded states — remounting it
  // between them produces a one-frame layout jump under the status bar.
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      {!data ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Spinner pad={0} />
        </View>
      ) : supporterView ? (
        <Workbench detail={data} />
      ) : (
        <RequesterThread detail={data} />
      )}
    </SafeAreaView>
  );
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

/**
 * Keeps a chat ScrollView pinned to the bottom (WhatsApp-style): opens at the
 * end, follows new messages and keyboard resizes while the user is near the
 * bottom, and leaves them alone while they read history further up.
 *
 * `ready` stays false until the first scroll-to-end has been applied; the
 * caller keeps the list invisible until then, so the user never sees the
 * pre-scroll frame at the top (which read as a jitter when opening a chat).
 */
function useStickyScroll() {
  const ref = useRef<ScrollView>(null);
  const stick = useRef(true);
  const first = useRef(true);
  const [ready, setReady] = useState(false);
  return {
    ready,
    handlers: {
      ref,
      scrollEventThrottle: 32,
      onScroll: (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        stick.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
      },
      onContentSizeChange: () => {
        if (stick.current) ref.current?.scrollToEnd({ animated: !first.current });
        if (first.current) {
          first.current = false;
          // reveal one frame later, once the non-animated jump has been applied
          requestAnimationFrame(() => setReady(true));
        }
      },
      onLayout: () => {
        if (stick.current && !first.current) ref.current?.scrollToEnd({ animated: false });
      },
    },
  };
}

/**
 * What was sent when the request was created, rendered like a chat message —
 * the intake photo / voice note would otherwise be invisible in the thread.
 */
function originalMessage({ request, attachments }: RequestDetail): MessageView | null {
  if (!request.body.trim() && attachments.length === 0) return null;
  return {
    id: "original",
    kind: "message",
    body: request.body,
    author: request.author ?? (request.guestName ? { id: "guest", name: request.guestName } : null),
    createdAt: request.createdAt,
    attachments,
  };
}

function RequesterThread({ detail }: { detail: RequestDetail }) {
  const { request, messages } = detail;
  const ws = useActiveWorkspace();
  const qc = useQueryClient();
  const sticky = useStickyScroll();
  const [composerH, setComposerH] = useState(80);

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

      <View style={{ flex: 1 }}>
        <ScrollView
          {...sticky.handlers}
          style={{ flex: 1, opacity: sticky.ready ? 1 : 0 }}
          keyboardDismissMode="interactive"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: composerH + 12, gap: 10 }}
        >
          {[originalMessage(detail), ...messages].map(
            (m) => m && <Bubble key={m.id} m={m} ownId={ws?.user?.id ?? ""} />,
          )}

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

        <Composer requestId={request.id} onHeightChange={setComposerH} />
      </View>
    </KeyboardAvoidingView>
  );
}

/* ===================================================================== */

function Workbench({ detail }: { detail: RequestDetail }) {
  const { request, messages, resolutions } = detail;
  const ws = useActiveWorkspace();
  const qc = useQueryClient();
  const router = useRouter();
  const sticky = useStickyScroll();
  const [composerH, setComposerH] = useState(120);

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
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
      <BackHeader
        title={request.title}
        subtitle={
          request.author
            ? `${request.ref} · ${request.author.name} · ${request.authorPastRequests ?? 1} past requests`
            : `${request.ref} · ${request.guestName ?? "Guest"} · guest`
        }
        right={
          request.status === "open" && !request.claimedBy ? (
            <Button title="Claim" size="sm" variant="mint" loading={claim.isPending} onPress={() => claim.mutate()} />
          ) : (
            <StatusBadge status={request.status === "handled" ? "handled" : request.status} />
          )
        }
      />

      <View style={{ flex: 1 }}>
        <ScrollView
          {...sticky.handlers}
          style={{ flex: 1, opacity: sticky.ready ? 1 : 0 }}
          keyboardDismissMode="interactive"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: composerH + 12, gap: 10 }}
        >
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

          {[originalMessage(detail), ...messages].map(
            (m) => m && <Bubble key={m.id} m={m} ownId={ws?.user?.id ?? ""} />,
          )}

          {/* once resolved, the capture replaces the "Mark resolved" button */}
          {resolutions[0] && (request.confirmationState === "pending" || request.status === "solved") && (
            <ResolutionCard r={resolutions[0]} />
          )}
          {request.status !== "solved" && request.confirmationState !== "pending" && (
            <Pressable
              onPress={() =>
                request.claimedBy
                  ? router.push(`/resolve/${request.id}`)
                  : claim.mutate(undefined, { onSuccess: () => router.push(`/resolve/${request.id}`) })
              }
              style={{ alignSelf: "center", backgroundColor: colors.card, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 20, marginTop: 6 }}
            >
              <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 14 }}>✓ Mark resolved</Text>
            </Pressable>
          )}
          {request.confirmationState === "pending" && (
            <Text style={{ textAlign: "center", fontSize: 13, color: colors.textSecondary }}>
              Waiting for {request.author?.name ?? request.guestName ?? "the requester"} to confirm the fix.
            </Text>
          )}
        </ScrollView>

        <Composer requestId={request.id} supporter onHeightChange={setComposerH} />
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * What the supporter captured when resolving — raw text plus any photos,
 * voice notes, or files. Shown in the workbench thread while the requester
 * confirms (and after), where the "Mark resolved" button used to be.
 */
function ResolutionCard({ r }: { r: ResolutionView }) {
  const text = r.rawCaptureText.trim() || r.structuredSummary;

  return (
    <View style={{ backgroundColor: colors.mint, borderRadius: radii.lg, padding: 14, gap: 8 }}>
      <SectionLabel color={colors.primary}>✓ How it was fixed</SectionLabel>
      {text ? <Text style={{ fontSize: 15, lineHeight: 21, color: colors.text }}>{text}</Text> : null}
      <RemoteAttachments items={r.attachments} />
      <Text style={{ fontSize: 12, color: colors.textSecondary }}>
        {r.supporterName ?? "Support"} · {clockTime(r.createdAt)}
      </Text>
    </View>
  );
}

/* ===================================================================== */

function Bubble({ m, ownId }: { m: MessageView; ownId: string }) {
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
    own ? null : (m.author?.name ?? (m.kind === "auto_answer" ? "kloop" : "System")),
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
        borderRadius: radii.bubble,
        borderBottomRightRadius: own ? 6 : radii.bubble,
        borderBottomLeftRadius: own ? radii.bubble : 6,
        padding: 12,
        maxWidth: "85%",
        alignSelf: own ? "flex-end" : "flex-start",
      }}
    >
      {m.body ? <Text style={{ fontSize: 15, lineHeight: 21, color: own ? "#fff" : colors.text }}>{m.body}</Text> : null}
      <RemoteAttachments items={m.attachments} onDark={own} style={{ marginTop: m.body ? 8 : 0 }} />
      {m.articleId ? (
        <Pressable onPress={() => router.push(`/article/${m.articleId}`)}>
          <Text style={{ fontSize: 13, fontWeight: "600", textDecorationLine: "underline", color: own ? "#fff" : colors.primary, marginTop: 6 }}>
            View the article ›
          </Text>
        </Pressable>
      ) : null}
      <Text style={{ fontSize: 11, color: own ? "rgba(255,255,255,0.7)" : colors.textSecondary, marginTop: 4, textAlign: own ? "right" : "left" }}>{meta}</Text>
    </View>
  );
}

/* ===================================================================== */

function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

function Composer({
  requestId,
  supporter,
  onHeightChange,
}: {
  requestId: string;
  supporter?: boolean;
  onHeightChange?: (h: number) => void;
}) {
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const keyboardUp = useKeyboardVisible();
  const [text, setText] = useState("");
  const [note, setNote] = useState(false);
  const [fromDraft, setFromDraft] = useState(false);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
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
    setUploadError(null);
    try {
      const picked = await pickImage(false);
      if (!picked) return;
      setUploading(true);
      const a = await uploadFile(picked);
      setAttachments((x) => [...x, { id: a.id, filename: a.filename, kind: a.kind, localUri: picked.uri }]);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed — try again.");
    } finally {
      setUploading(false);
    }
  };

  const toggleVoice = async () => {
    setUploadError(null);
    if (voice.recording) {
      const noteFile = await voice.stop();
      if (noteFile) {
        setUploading(true);
        try {
          const a = await uploadFile(noteFile);
          setAttachments((x) => [...x, { id: a.id, filename: a.filename, kind: "audio", localUri: noteFile.uri, durationMs: noteFile.durationMs }]);
        } catch (e) {
          setUploadError(e instanceof Error ? e.message : "Upload failed — try again.");
        } finally {
          setUploading(false);
        }
      }
    } else {
      const ok = await voice.start();
      if (!ok) setUploadError("Couldn't start recording — check the microphone permission.");
    }
  };

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !send.isPending && !uploading;

  return (
    <BlurView
      intensity={40}
      tint="extraLight"
      onLayout={(e) => onHeightChange?.(e.nativeEvent.layout.height)}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: keyboardUp ? 8 : Math.max(insets.bottom, 12),
        gap: 8,
        backgroundColor: "rgba(244, 242, 236, 0.72)",
      }}
    >
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
      <AttachmentTray items={attachments} onRemove={(id) => setAttachments((x) => x.filter((y) => y.id !== id))} />
      {uploadError && (
        <Text style={{ color: colors.danger, fontSize: 12, paddingHorizontal: 6 }}>{uploadError}</Text>
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
        <Pressable onPress={() => void attach()} disabled={uploading} style={roundBtn(colors.chip)}>
          {uploading ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <SymbolView name={{ ios: "plus", android: "add" }} size={18} tintColor={colors.textSecondary} />
          )}
        </Pressable>
        <Pressable onPress={() => void toggleVoice()} style={roundBtn(voice.recording ? colors.danger : colors.chip)}>
          <SymbolView name={{ ios: "mic.fill", android: "mic" }} size={17} tintColor={voice.recording ? "#fff" : colors.textSecondary} />
        </Pressable>
        {/* auto-grows natively while typing; the explicit height when empty
            forces the snap back to one line after send (Fabric doesn't
            re-measure on programmatic clear) */}
        <TextInput
          multiline
          placeholder={note ? "Internal note…" : "Reply…"}
          placeholderTextColor={colors.textFaint}
          value={text}
          onChangeText={setText}
          style={{
            flex: 1,
            height: text.length === 0 ? 40 : undefined,
            minHeight: 40,
            maxHeight: 120,
            fontSize: 15,
            lineHeight: 20,
            color: colors.text,
            paddingVertical: 10,
            paddingHorizontal: 4,
          }}
        />
        <Pressable onPress={() => send.mutate()} disabled={!canSend} style={[roundBtn(colors.primary), { opacity: canSend ? 1 : 0.4 }]}>
          <SymbolView name={{ ios: "arrow.up", android: "arrow_upward" }} size={18} weight="semibold" tintColor="#fff" />
        </Pressable>
      </View>
    </BlurView>
  );
}

function roundBtn(bg: string) {
  return { width: 40, height: 40, borderRadius: 20, backgroundColor: bg, alignItems: "center" as const, justifyContent: "center" as const };
}
