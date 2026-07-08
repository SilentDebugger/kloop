import { useEffect, useState, type ComponentProps } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SymbolView } from "expo-symbols";
import { colors, radii, type DocCaptureTopicView } from "@kloop/shared";
import { api } from "../src/api";
import { haptics } from "../src/haptics";
import { useDrafts } from "../src/store/drafts";
import { useComposerAttachments } from "../src/uploads";
import { AiGlyph, Button, Card, ErrorNote, GlassSurface, animateLayout } from "../src/ui";
import { AttachmentTray } from "../src/ui/attachments";

const KIND_BADGES: Record<string, { label: string; bg: string; fg: string }> = {
  "how-to": { label: "HOW-TO", bg: colors.mint, fg: colors.primary },
  onboarding: { label: "ONBOARDING", bg: colors.mint, fg: colors.primary },
  "good-to-know": { label: "GOOD TO KNOW", bg: colors.amberSoft, fg: colors.amber },
  other: { label: "NOTE", bg: colors.chip, fg: colors.textSecondary },
};

/**
 * Knowledge capture ("New doc") — reached via the native zoom morph from the
 * Knowledge tab's pill. One route, three phases: brain-dump capture → live
 * "structuring your notes" progress → draft cards to keep or discard.
 */
export default function NewDocScreen() {
  const router = useRouter();
  const text = useDrafts((s) => s.docCaptureText);
  const setText = useDrafts((s) => s.setDocCaptureText);
  const att = useComposerAttachments();

  const [captureId, setCaptureId] = useState<string | null>(null);
  // what fed the capture, remembered for the results subtitle
  const [sourceSummary, setSourceSummary] = useState("your notes");
  const [genError, setGenError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createDocCapture({ text, attachmentIds: att.ids }),
    onSuccess: (res) => {
      haptics.success();
      setSourceSummary(describeSources(text, att.attachments.map((a) => a.kind)));
      setText("");
      att.clear();
      setCaptureId(res.capture.id);
    },
    onError: () => haptics.error(),
  });

  const { data } = useQuery({
    queryKey: ["doc-capture", captureId],
    queryFn: () => api.docCapture(captureId!),
    enabled: !!captureId,
    refetchInterval: (query) => {
      const s = query.state.data?.capture.status;
      return s === "queued" || s === "reading" || s === "drafting" ? 1500 : false;
    },
  });
  const capture = data?.capture ?? null;

  // generation failed → return to the capture phase with the notes restored,
  // so a retry doesn't start from a blank screen
  useEffect(() => {
    if (capture?.status !== "failed") return;
    if (!text.trim() && capture.rawText) setText(capture.rawText);
    setGenError(capture.error ?? "Something went wrong — try again.");
    setCaptureId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture?.status]);

  const close = () => router.back();

  if (capture && capture.status === "ready") {
    return <ResultsPhase captureId={capture.id} topics={capture.topics} sourceSummary={sourceSummary} onDone={close} />;
  }
  if (captureId && (!capture || capture.status !== "failed")) {
    return (
      <GeneratingPhase
        capture={capture}
        onCancel={() => {
          if (captureId) void api.cancelDocCapture(captureId).catch(() => {});
          close();
        }}
      />
    );
  }

  const canSubmit = (text.trim().length > 0 || att.ids.length > 0) && !att.uploading && !att.recording;
  const thingCount = (text.trim() ? 1 : 0) + att.attachments.length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "bottom"]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8 }}>
        <Pressable onPress={close} hitSlop={8}>
          <GlassSurface interactive fallbackColor={colors.card} style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" }}>
            <SymbolView name={{ ios: "xmark", android: "close" }} size={13} weight="semibold" tintColor={colors.textSecondary} />
          </GlassSurface>
        </Pressable>
        {/* notes persist in the drafts store — closing already saves them */}
        <Pressable onPress={close} hitSlop={8}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: colors.textSecondary }}>Save for later</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16, flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5, marginTop: 14 }}>What did you learn?</Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginTop: 6 }}>
          Notes, sentences, voice, photos — in any order. No structure needed, that's our job. <Text style={{ color: colors.primary }}>✦</Text>
        </Text>

        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: radii.lg,
            padding: 16,
            marginTop: 16,
            flex: 1,
            minHeight: 220,
          }}
        >
          <TextInput
            multiline
            placeholder="– the guest wifi voucher printer is in room 2.14…"
            placeholderTextColor={colors.textFaint}
            value={text}
            onChangeText={setText}
            style={{ flex: 1, fontSize: 15, lineHeight: 22, color: colors.text, textAlignVertical: "top" }}
          />
          <AttachmentTray items={att.attachments} onRemove={att.remove} />
          {att.error ? (
            <Pressable onPress={att.dismissError} style={{ marginTop: 8 }}>
              <ErrorNote>{att.error}</ErrorNote>
            </Pressable>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
            <RoundAction icon={{ ios: "camera", android: "photo_camera" }} onPress={() => void att.attach("camera")} />
            <RoundAction
              icon={att.recording ? { ios: "stop.fill", android: "stop" } : { ios: "mic", android: "mic" }}
              active={att.recording}
              onPress={() => void att.attach("voice")}
            />
            <RoundAction icon={{ ios: "doc", android: "description" }} onPress={() => void att.attach("file")} />
            <View style={{ flex: 1 }} />
            {att.uploading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : thingCount > 0 ? (
              <Text style={{ fontSize: 13, color: colors.textSecondary }}>
                {thingCount} thing{thingCount === 1 ? "" : "s"} added
              </Text>
            ) : null}
          </View>
        </View>

        {create.isError ? (
          <View style={{ marginTop: 10 }}>
            <ErrorNote>{create.error instanceof Error ? create.error.message : "Couldn't start — try again."}</ErrorNote>
          </View>
        ) : null}
        {genError ? (
          <View style={{ marginTop: 10 }}>
            <ErrorNote>{genError}</ErrorNote>
          </View>
        ) : null}

        <View style={{ marginTop: 14 }}>
          <Button
            title="✦  Turn into drafts"
            size="lg"
            disabled={!canSubmit}
            loading={create.isPending}
            onPress={() => {
              setGenError(null);
              setCaptureId(null);
              create.mutate();
            }}
          />
          <Text style={{ fontSize: 12, color: colors.textFaint, textAlign: "center", marginTop: 10 }}>
            Might become more than one article — that's fine.
          </Text>
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function describeSources(text: string, kinds: string[]): string {
  const parts: string[] = [];
  if (text.trim()) parts.push("your notes");
  const audio = kinds.filter((k) => k === "audio").length;
  const images = kinds.filter((k) => k === "image").length;
  const files = kinds.filter((k) => k !== "audio" && k !== "image").length;
  if (audio > 0) parts.push(audio === 1 ? "one voice memo" : `${audio} voice memos`);
  if (images > 0) parts.push(images === 1 ? "a photo" : `${images} photos`);
  if (files > 0) parts.push(files === 1 ? "a file" : `${files} files`);
  if (parts.length === 0) return "your capture";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function RoundAction({
  icon,
  onPress,
  active,
}: {
  icon: ComponentProps<typeof SymbolView>["name"];
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: active ? colors.primary : colors.chip,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <SymbolView name={icon} size={17} tintColor={active ? "#fff" : colors.text} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Phase 7c — structuring your notes                                   */
/* ------------------------------------------------------------------ */
function GeneratingPhase({
  capture,
  onCancel,
}: {
  capture: { status: string; topics: DocCaptureTopicView[] } | null;
  onCancel: () => void;
}) {
  const topics = capture?.topics ?? [];
  const settled = topics.filter((t) => t.status !== "pending").length;
  const subtitle =
    topics.length > 0
      ? `Found ${topics.length} separate topic${topics.length === 1 ? "" : "s"} · drafting ${Math.min(settled + 1, topics.length)} of ${topics.length}`
      : "Reading your notes, voice memos and photos…";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "bottom"]}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
        <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center" }}>
          <AiGlyph state="working" size={30} />
        </View>
        <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text, marginTop: 22 }}>Structuring your notes…</Text>
        <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 6, textAlign: "center" }}>{subtitle}</Text>

        {topics.length > 0 && (
          <View style={{ alignSelf: "stretch", gap: 8, marginTop: 26 }}>
            {topics.map((t) => (
              <Card key={t.id} style={{ padding: 13, flexDirection: "row", alignItems: "center", gap: 10 }}>
                {t.status === "pending" ? (
                  <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.mintStrong }} />
                ) : (
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center" }}>
                    <SymbolView name={{ ios: "checkmark", android: "check" }} size={10} weight="bold" tintColor={colors.primary} />
                  </View>
                )}
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: "600", color: t.status === "pending" ? colors.textSecondary : colors.text }}>
                  {t.title}
                </Text>
              </Card>
            ))}
          </View>
        )}
      </View>

      <View style={{ alignItems: "center", paddingBottom: 18 }}>
        <Pressable onPress={onCancel} hitSlop={10}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.textSecondary }}>Cancel</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/* Phase 7d — draft cards: open, discard, send to review               */
/* ------------------------------------------------------------------ */
function ResultsPhase({
  captureId,
  topics,
  sourceSummary,
  onDone,
}: {
  captureId: string;
  topics: DocCaptureTopicView[];
  sourceSummary: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const [discarded, setDiscarded] = useState<Set<string>>(new Set());

  const drafts = topics.filter((t) => t.status === "drafted" && t.articleId);
  const covered = topics.filter((t) => t.status === "covered");
  const kept = drafts.filter((t) => !discarded.has(t.articleId!));

  const submit = useMutation({
    mutationFn: () => api.submitDocCapture(captureId, [...discarded]),
    onSuccess: () => {
      haptics.success();
      void qc.invalidateQueries({ queryKey: ["reviews"] });
      void qc.invalidateQueries({ queryKey: ["review-counts"] });
      void qc.invalidateQueries({ queryKey: ["articles"] });
      onDone();
    },
    onError: () => haptics.error(),
  });

  const toggleDiscard = (articleId: string) => {
    animateLayout();
    setDiscarded((prev) => {
      const next = new Set(prev);
      if (next.has(articleId)) next.delete(articleId);
      else next.add(articleId);
      return next;
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "bottom"]}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
        <Pressable onPress={onDone} hitSlop={8} style={{ alignSelf: "flex-start" }}>
          <GlassSurface interactive fallbackColor={colors.card} style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" }}>
            <SymbolView name={{ ios: "xmark", android: "close" }} size={13} weight="semibold" tintColor={colors.textSecondary} />
          </GlassSurface>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 140 }}>
        <Text style={{ fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.5, marginTop: 12 }}>
          <Text style={{ color: colors.primary }}>✦ </Text>
          {drafts.length} draft{drafts.length === 1 ? "" : "s"} ready
        </Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginTop: 6 }}>
          From {sourceSummary}. Skim, tweak, or toss.
        </Text>

        <View style={{ gap: 12, marginTop: 18 }}>
          {drafts.map((t) => {
            const badge = KIND_BADGES[t.kind] ?? KIND_BADGES.other;
            const isDiscarded = discarded.has(t.articleId!);
            return (
              <Card key={t.id} style={{ padding: 14, opacity: isDiscarded ? 0.45 : 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ backgroundColor: badge.bg, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 8 }}>
                    <Text style={{ color: badge.fg, fontSize: 11, fontWeight: "700", letterSpacing: 0.4 }}>{badge.label}</Text>
                  </View>
                  <Text style={{ fontSize: 12, color: colors.textFaint }}>{t.sourceHint}</Text>
                </View>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text, marginTop: 10, lineHeight: 21 }}>{t.title}</Text>
                {t.summary ? (
                  <Text style={{ fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginTop: 4 }}>{t.summary}</Text>
                ) : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 }}>
                  {isDiscarded ? (
                    <Button title="Keep it" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => toggleDiscard(t.articleId!)} />
                  ) : (
                    <>
                      <Button title="Open & edit" variant="secondary" size="sm" style={{ flex: 1 }} onPress={() => router.push(`/article/${t.articleId}`)} />
                      <Pressable onPress={() => toggleDiscard(t.articleId!)} hitSlop={8} style={{ paddingHorizontal: 10 }}>
                        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.danger }}>Discard</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </Card>
            );
          })}

          {covered.map((t) => (
            <View key={t.id} style={{ backgroundColor: colors.surface, borderRadius: radii.lg, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
              <SymbolView name={{ ios: "checkmark.circle.fill", android: "check_circle" }} size={18} tintColor={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>{t.title}</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>
                  Already covered by {t.coveredByLabel ?? "an existing article"} — no new doc needed.
                </Text>
              </View>
            </View>
          ))}

          {drafts.length === 0 && covered.length === 0 && (
            <ErrorNote>Nothing documentable came out of this capture — the notes are saved.</ErrorNote>
          )}
        </View>
      </ScrollView>

      <View style={{ position: "absolute", bottom: 20, left: 16, right: 16, alignItems: "center", gap: 10 }}>
        <Button
          title={
            kept.length > 0
              ? `Send ${kept.length === drafts.length ? `all ${kept.length}` : String(kept.length)} to review`
              : "Discard all & close"
          }
          size="lg"
          style={{ alignSelf: "stretch" }}
          loading={submit.isPending}
          onPress={() => submit.mutate()}
        />
        <Text style={{ fontSize: 12, color: colors.textFaint }}>Nothing publishes without the usual review step.</Text>
      </View>
    </SafeAreaView>
  );
}
