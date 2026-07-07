import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { SymbolView } from "expo-symbols";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { autoAnswerSkipLabel, colors, docStateLabel, radii, type DeflectionSuggestion, type MessageView, type RequestDetail, type RequestSummary, type ResolutionView } from "@kloop/shared";
import { api } from "../../src/api";
import { clockTime, sentLabel } from "../../src/format";
import { haptics } from "../../src/haptics";
import { useActiveWorkspace } from "../../src/store/connection";
import { pickImage, uploadFile } from "../../src/uploads";
import { useVoiceNote } from "../../src/recorder";
import { AiGlyph, Button, Chip, GlassSurface, liquidGlass, Logo, SectionLabel, Spinner, StatusBadge } from "../../src/ui";
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
      <Pressable onPress={() => router.back()}>
        <GlassSurface interactive fallbackColor={colors.card} style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 18, color: colors.text }}>‹</Text>
        </GlassSurface>
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
 * Requests created before the title/body split store everything in the title,
 * so fall back to it: the thread should always open with the user's message.
 */
function originalMessage({ request, attachments }: RequestDetail): MessageView {
  return {
    id: "original",
    kind: "message",
    body: request.body.trim() || request.title,
    author: request.author ?? (request.guestName ? { id: "guest", name: request.guestName } : null),
    createdAt: request.createdAt,
    attachments,
  };
}

/**
 * Mounts children while `show` is true; when it flips false, fades them out
 * and collapses the freed space (LayoutAnimation) instead of snapping — the
 * "request received" intro melts away the moment a supporter claims.
 */
function FadeAway({ show, children }: { show: boolean; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(show);
  const opacity = useRef(new Animated.Value(show ? 1 : 0)).current;

  useEffect(() => {
    if (show && !mounted) {
      setMounted(true);
      opacity.setValue(1);
      return;
    }
    if (!show && mounted) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 420,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;
        LayoutAnimation.configureNext(
          LayoutAnimation.create(300, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity),
        );
        setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, mounted]);

  if (!mounted) return null;
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

/** "Request received" confirmation card — shown until a supporter (or the AI) takes over. */
function ReceivedCard({ requestId, orgName, hasImage }: { requestId: string; orgName: string; hasImage: boolean }) {
  const qc = useQueryClient();
  const [sending, setSending] = useState(false);

  const addScreenshot = async () => {
    try {
      const picked = await pickImage(false);
      if (!picked) return;
      setSending(true);
      const a = await uploadFile(picked);
      await api.postMessage(requestId, { body: "", kind: "message", attachmentIds: [a.id] });
      void qc.invalidateQueries({ queryKey: ["request", requestId] });
    } catch {
      // upload/post failed — the composer remains as the fallback path
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ backgroundColor: colors.card, borderRadius: radii.lg, padding: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Logo size={32} stroke={5.5} />
        <View>
          <Text style={{ fontWeight: "800", fontSize: 16, color: colors.text }}>Request received</Text>
          <Text style={{ fontSize: 12.5, color: colors.textSecondary, marginTop: 1 }}>{orgName} · automatic</Text>
        </View>
      </View>
      <Text style={{ fontSize: 14.5, lineHeight: 21, color: colors.text }}>
        You're in the queue. We'll notify you the moment someone picks this up —{" "}
        <Text style={{ fontWeight: "700" }}>usually within 15 minutes</Text> on weekdays.
      </Text>
      {!hasImage && (
        <Pressable
          onPress={() => void addScreenshot()}
          disabled={sending}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: colors.chip,
            borderRadius: radii.md,
            padding: 12,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <SymbolView name={{ ios: "camera", android: "photo_camera" }} size={17} tintColor={colors.textSecondary} />
          )}
          <Text style={{ flex: 1, fontSize: 13.5, color: colors.textSecondary, lineHeight: 19 }}>
            A screenshot of the error usually speeds things up.{" "}
            <Text style={{ color: colors.primary, fontWeight: "700" }}>Add one</Text>
          </Text>
        </Pressable>
      )}
    </View>
  );
}

/** Deflection suggestions inside the thread — the request might not need a human at all. */
function WhileYouWait({ suggestions }: { suggestions: DeflectionSuggestion[] }) {
  const router = useRouter();
  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 4 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary }} />
        <SectionLabel>While you wait — this might fix it</SectionLabel>
      </View>
      {suggestions.map((s) => (
        <Pressable
          key={s.id}
          onPress={() => router.push(`/article/${s.id}`)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: colors.card,
            borderRadius: radii.lg,
            padding: 14,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", fontSize: 15, color: colors.text, lineHeight: 20 }}>{s.title}</Text>
            <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 2 }}>
              {s.kb}
              {s.helpfulPercent != null ? ` · ${s.helpfulPercent}% found this helpful` : ""}
            </Text>
          </View>
          <SymbolView name={{ ios: "chevron.right", android: "chevron_right" }} size={13} tintColor={colors.textFaint} />
        </Pressable>
      ))}
    </View>
  );
}

function RequesterThread({ detail }: { detail: RequestDetail }) {
  const { request, messages } = detail;
  const ws = useActiveWorkspace();
  const qc = useQueryClient();
  const sticky = useStickyScroll();
  const [composerH, setComposerH] = useState(80);

  const confirm = useMutation({
    mutationFn: (fixed: boolean) => api.confirm(request.id, fixed),
    onSuccess: (_res, fixed) => {
      if (fixed) haptics.success();
      void qc.invalidateQueries({ queryKey: ["request", request.id] });
    },
  });
  const reopen = useMutation({
    mutationFn: () => api.reopen(request.id),
    onSuccess: () => {
      haptics.warning();
      void qc.invalidateQueries({ queryKey: ["request", request.id] });
    },
  });

  const reached = request.status === "solved" ? 2 : request.status === "handled" ? 1 : 0;
  const resolverName = request.claimer?.name ?? "Support";

  // fresh unclaimed request → intro card + article suggestions, both of which
  // fade away the moment a supporter (or the AI) takes over. On-behalf
  // requests are claimed at creation, so they never see this state.
  const waiting = request.status === "open" && !request.claimedBy && !request.autoAnswered;
  const { data: deflectData } = useQuery({
    queryKey: ["thread-deflect", request.id],
    queryFn: () => api.deflect((request.body.trim() || request.title).slice(0, 4000)),
    enabled: waiting,
    staleTime: Infinity,
  });
  const suggestions = (deflectData?.suggestions ?? []).slice(0, 2);
  const hasImage =
    detail.attachments.some((a) => a.kind === "image") ||
    messages.some((m) => (m.attachments ?? []).some((a) => a.kind === "image"));

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

          <FadeAway show={waiting}>
            <View style={{ gap: 10 }}>
              <ReceivedCard requestId={request.id} orgName={ws?.name ?? "Support"} hasImage={hasImage} />
              {suggestions.length > 0 && <WhileYouWait suggestions={suggestions} />}
            </View>
          </FadeAway>

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
      haptics.success();
      void qc.invalidateQueries({ queryKey: ["request", request.id] });
      void qc.invalidateQueries({ queryKey: ["requests"] });
    },
    onError: () => haptics.error(),
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
          {detail.autoAnswerSkip && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radii.md, paddingVertical: 10, paddingHorizontal: 14 }}>
              <Text style={{ fontSize: 13, color: colors.textSecondary }}>✦</Text>
              <Text style={{ flex: 1, fontSize: 13, fontWeight: "500", color: colors.textSecondary, lineHeight: 18 }}>
                {autoAnswerSkipLabel(detail.autoAnswerSkip)}
              </Text>
              {detail.autoAnswerSkip.articleId && (
                <Pressable onPress={() => router.push(`/article/${detail.autoAnswerSkip!.articleId}`)}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>View ›</Text>
                </Pressable>
              )}
            </View>
          )}

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
            <>
              <ResolutionCard r={resolutions[0]} />
              <DocStatusLine r={resolutions[0]} />
            </>
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

/**
 * What the AI is doing with this capture — the strip under the resolution
 * card that removes the post-resolve blind spot. Pulses while working,
 * settles into the outcome (+ link) once the pipeline decided.
 */
function DocStatusLine({ r }: { r: ResolutionView }) {
  const router = useRouter();
  const link =
    r.docState === "already_documented" && r.articleId
      ? { label: "View ›", go: () => router.push(`/article/${r.articleId}`) }
      : r.docState === "drafted"
        ? { label: "Review ›", go: () => router.push("/(supporter)/reviews") }
        : null;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderRadius: radii.md, paddingVertical: 10, paddingHorizontal: 14 }}>
      <AiGlyph state={r.docState} />
      <Text style={{ flex: 1, fontSize: 13, fontWeight: "500", color: colors.textSecondary, lineHeight: 18 }}>
        {r.docNote ?? docStateLabel(r.docState)}
      </Text>
      {link && (
        <Pressable onPress={link.go} hitSlop={8}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>{link.label}</Text>
        </Pressable>
      )}
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

  // every tap generates a fresh draft from the current thread
  const draft = useMutation({
    mutationFn: () => api.aiDraft(requestId),
    onSuccess: (res) => {
      if (res.draft) {
        setText(res.draft.body);
        setFromDraft(true);
      }
    },
  });

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
    onError: () => haptics.error(),
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
    <ComposerBar
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
      }}
    >
      {supporter && (
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 4 }}>
          <Chip
            label={draft.isPending ? "Drafting…" : fromDraft ? "✦ Redraft" : "✦ AI draft"}
            onPress={() => !draft.isPending && draft.mutate()}
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
        <Pressable
          onPress={() => {
            haptics.tap();
            void attach();
          }}
          disabled={uploading}
        >
          <GlassSurface interactive fallbackColor={colors.chip} style={roundBtn()}>
            {uploading ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <SymbolView name={{ ios: "plus", android: "add" }} size={18} tintColor={colors.textSecondary} />
            )}
          </GlassSurface>
        </Pressable>
        <Pressable
          onPress={() => {
            haptics.tap();
            void toggleVoice();
          }}
        >
          <GlassSurface
            interactive
            fallbackColor={colors.chip}
            tintColor={voice.recording ? colors.danger : undefined}
            style={roundBtn()}
          >
            <SymbolView name={{ ios: "mic.fill", android: "mic" }} size={17} tintColor={voice.recording ? "#fff" : colors.textSecondary} />
          </GlassSurface>
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
        <Pressable
          onPress={() => {
            haptics.tap();
            send.mutate();
          }}
          disabled={!canSend}
          style={[roundBtn(), { backgroundColor: colors.primary, opacity: canSend ? 1 : 0.4 }]}
        >
          <SymbolView name={{ ios: "arrow.up", android: "arrow_upward" }} size={18} weight="semibold" tintColor="#fff" />
        </Pressable>
      </View>
    </ComposerBar>
  );
}

/** Floating input bar: Liquid Glass on iOS 26+, classic material blur below. */
function ComposerBar({ children, style, onLayout }: { children: React.ReactNode; style: ViewStyle; onLayout: ViewProps["onLayout"] }) {
  if (liquidGlass) {
    return (
      <GlassSurface fallbackColor="transparent" style={style} onLayout={onLayout}>
        {children}
      </GlassSurface>
    );
  }
  return (
    <BlurView intensity={40} tint="extraLight" onLayout={onLayout} style={[style, { backgroundColor: "rgba(244, 242, 236, 0.72)" }]}>
      {children}
    </BlurView>
  );
}

function roundBtn() {
  return { width: 40, height: 40, borderRadius: 20, alignItems: "center" as const, justifyContent: "center" as const };
}
