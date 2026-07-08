import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SymbolView } from "expo-symbols";
import { colors, radii, type DocCaptureTopicView, type DocCaptureView } from "@kloop/shared";
import { api } from "../../src/api";
import { haptics } from "../../src/haptics";
import { captureSheet, describeCaptureSources, useActiveDocCapture, useSetActiveDocCapture } from "../../src/docCapture";
import { useDrafts } from "../../src/store/drafts";
import { AiGlyph, Button, Card, ErrorNote, animateLayout } from "../../src/ui";

const KIND_BADGES: Record<string, { label: string; bg: string; fg: string }> = {
  "how-to": { label: "HOW-TO", bg: colors.mint, fg: colors.primary },
  onboarding: { label: "ONBOARDING", bg: colors.mint, fg: colors.primary },
  "good-to-know": { label: "GOOD TO KNOW", bg: colors.amberSoft, fg: colors.amber },
  other: { label: "NOTE", bg: colors.chip, fg: colors.textSecondary },
};

/**
 * Live view of one knowledge capture, presented as a native bottom sheet (see
 * app/_layout.tsx — half-height detent, grabber, swipe-to-dismiss). Closing it
 * never stops anything: generation continues server-side and the sheet can be
 * reopened from the Knowledge tab pill, the app-wide watcher, or the
 * completion push. Backed by the shared /captures/active query, so it always
 * shows the live state no matter how it was opened.
 */
export default function DocCaptureSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const setActive = useSetActiveDocCapture();
  const docText = useDrafts((s) => s.docCaptureText);
  const setDocText = useDrafts((s) => s.setDocCaptureText);

  const { data } = useActiveDocCapture();
  const active = data?.capture ?? null;
  // only render the capture this sheet was opened for — anything else means
  // it was finished or superseded elsewhere
  const capture = active && active.id === id ? active : null;
  const closedRef = useRef(false);

  const close = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    if (router.canGoBack()) router.back();
  };

  // tell the watcher / foreground push handler the sheet is on screen
  useEffect(() => {
    captureSheet.setPresented(true);
    return () => captureSheet.setPresented(false);
  }, []);

  // capture finished or acknowledged elsewhere — nothing to show here
  useEffect(() => {
    if (data && !capture) close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, capture]);

  const acknowledge = useMutation({
    // cancel doubles as "acknowledge" — it takes the capture out of the
    // active slot so the pill and watcher stop resurfacing it
    mutationFn: () => api.cancelDocCapture(id!),
    onSettled: () => setActive(null),
  });

  if (capture?.status === "ready") {
    return <ResultsPhase capture={capture} onDone={close} />;
  }

  if (capture?.status === "failed") {
    return (
      <FailedPhase
        message={capture.error ?? "Something went wrong — try again."}
        onRetry={() => {
          if (!docText.trim() && capture.rawText) setDocText(capture.rawText);
          acknowledge.mutate();
          close();
          setTimeout(() => router.push("/new-doc"), 450);
        }}
      />
    );
  }

  return (
    <GeneratingPhase
      capture={capture}
      onHide={close}
      onCancel={() => {
        acknowledge.mutate();
        close();
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Structuring your notes — live progress ticks                        */
/* ------------------------------------------------------------------ */
function GeneratingPhase({
  capture,
  onHide,
  onCancel,
}: {
  capture: DocCaptureView | null;
  onHide: () => void;
  onCancel: () => void;
}) {
  const topics = capture?.topics ?? [];
  const settled = topics.filter((t) => t.status !== "pending").length;
  const subtitle =
    topics.length > 0
      ? `Found ${topics.length} separate topic${topics.length === 1 ? "" : "s"} · drafting ${Math.min(settled + 1, topics.length)} of ${topics.length}`
      : "Reading your notes, voice memos and photos…";

  // The ScrollView must be the sheet's direct child — RNS form sheets only
  // find a descendant ScrollView for native sizing on direct children.
  return (
    <ScrollView
      style={{ backgroundColor: colors.surface }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 26, paddingBottom: 24 }}
    >
      <View style={{ alignItems: "center" }}>
        <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center" }}>
          <AiGlyph state="working" size={26} />
        </View>
        <Text style={{ fontSize: 20, fontWeight: "800", color: colors.text, marginTop: 16 }}>Structuring your notes…</Text>
        <Text style={{ fontSize: 14, color: colors.textSecondary, marginTop: 5, textAlign: "center" }}>{subtitle}</Text>
      </View>

      {topics.length > 0 && (
        <View style={{ gap: 8, marginTop: 22 }}>
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

      <View style={{ flex: 1 }} />

      <Button title="Hide — keep working" variant="secondary" size="lg" style={{ marginTop: 24 }} onPress={onHide} />
      <Text style={{ fontSize: 12, color: colors.textFaint, textAlign: "center", marginTop: 10 }}>
        We'll pop back up when the drafts are ready.
      </Text>
      <Pressable onPress={onCancel} hitSlop={10} style={{ alignSelf: "center", marginTop: 14 }}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.danger }}>Cancel this capture</Text>
      </Pressable>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Generation failed — hand the notes back for another go              */
/* ------------------------------------------------------------------ */
function FailedPhase({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <ScrollView
      style={{ backgroundColor: colors.surface }}
      contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 26, paddingBottom: 24 }}
    >
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: 68, height: 68, borderRadius: 34, backgroundColor: colors.amberSoft, alignItems: "center", justifyContent: "center" }}>
          <SymbolView name={{ ios: "exclamationmark.triangle", android: "warning" }} size={26} tintColor={colors.amber} />
        </View>
        <Text style={{ fontSize: 20, fontWeight: "800", color: colors.text, marginTop: 16, textAlign: "center" }}>
          That didn't work
        </Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginTop: 6, textAlign: "center" }}>{message}</Text>
      </View>
      <Button title="Edit notes & retry" size="lg" style={{ marginTop: 24 }} onPress={onRetry} />
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Draft cards: open, discard, send to review                          */
/* ------------------------------------------------------------------ */
function ResultsPhase({ capture, onDone }: { capture: DocCaptureView; onDone: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const setActive = useSetActiveDocCapture();
  const [discarded, setDiscarded] = useState<Set<string>>(new Set());

  const topics = capture.topics;
  const drafts = topics.filter((t) => t.status === "drafted" && t.articleId);
  const covered = topics.filter((t) => t.status === "covered");
  const kept = drafts.filter((t) => !discarded.has(t.articleId!));

  const submit = useMutation({
    mutationFn: () => api.submitDocCapture(capture.id, [...discarded]),
    onSuccess: () => {
      haptics.success();
      setActive(null);
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
    <ScrollView style={{ backgroundColor: colors.surface }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 24 }}>
      <Text style={{ fontSize: 24, fontWeight: "800", color: colors.text, letterSpacing: -0.5 }}>
        <Text style={{ color: colors.primary }}>✦ </Text>
        {drafts.length} draft{drafts.length === 1 ? "" : "s"} ready
      </Text>
      <Text style={{ fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginTop: 6 }}>
        From {describeCaptureSources(capture)}. Skim, tweak, or toss.
      </Text>

      <View style={{ gap: 12, marginTop: 16 }}>
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
          <View key={t.id} style={{ backgroundColor: colors.background, borderRadius: radii.lg, padding: 14, flexDirection: "row", alignItems: "center", gap: 10 }}>
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

      <View style={{ marginTop: 22, alignItems: "center", gap: 10 }}>
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
    </ScrollView>
  );
}
