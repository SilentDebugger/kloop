import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { SymbolView } from "expo-symbols";
import { Link, useFocusEffect, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { colors, radii, type DeflectionSuggestion } from "@kloop/shared";
import { api } from "../../src/api";
import { haptics } from "../../src/haptics";
import { useDrafts } from "../../src/store/drafts";
import { useActiveWorkspace } from "../../src/store/connection";
import { useComposerAttachments } from "../../src/uploads";
import { Card, Logo, SectionLabel, Spinner } from "../../src/ui";
import { AttachmentTray } from "../../src/ui/attachments";
import { encodePendingAttachments } from "../../src/pendingRequest";

/** Home — forest hero + floating one-box composer with live deflection. */
export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // light status bar only while this (dark-hero) screen is focused
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
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

  const { data: mine } = useQuery({ queryKey: ["requests", "mine"], queryFn: () => api.requests(), staleTime: 30_000 });
  const { data: recent } = useQuery({
    queryKey: ["articles", "home"],
    queryFn: () => api.articles({ limit: "4" }),
    staleTime: 5 * 60_000,
  });

  // Navigating (rather than creating the request first) is what lets the
  // native zoom transition run off this tap: the thread mounts instantly
  // with the draft, and creates the request itself (see request/[id].tsx) —
  // the composer only has to snapshot + clear its own state here.
  const draft = text.trim();
  const attachmentsParam = encodePendingAttachments(att.attachments);
  const canSend = draft.length >= 3 && !att.uploading;
  const clearComposer = () => {
    setText("");
    setComposerText("");
    att.clear();
  };

  // background sync of offline-queued drafts
  useEffect(() => {
    for (const queued of queue) {
      api
        .createRequest({ title: queued.title, channel: "mobile" })
        .then(() => dequeue(queued.localId))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const suggestions = deflect?.suggestions ?? [];
  const openRequests = (mine?.requests ?? []).filter((r) => r.status !== "solved");
  const replyWaiting = openRequests.filter((r) => r.unreadForRequester).length;
  const articles = recent?.articles ?? [];

  // While the keyboard is up, the suggestion list sits underneath it — the
  // user has no idea deflection found anything. Surface the state inside the
  // always-visible composer card instead; tapping drops the keyboard so the
  // suggestions right below come into view.
  const keyboardUp = useKeyboardVisible();
  const searching = isFetching && suggestions.length === 0;
  const showHint = keyboardUp && (suggestions.length > 0 || (searching && (debounced.length >= 8 || att.ids.length > 0)));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {focused && <StatusBar style="light" />}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          {/* forest fill behind the iOS overscroll bounce */}
          <View style={{ position: "absolute", top: -600, left: 0, right: 0, height: 600, backgroundColor: colors.forest }} />

          {/* hero */}
          <View
            style={{
              backgroundColor: colors.forest,
              borderBottomLeftRadius: 34,
              borderBottomRightRadius: 34,
              paddingTop: insets.top + 10,
              paddingHorizontal: 22,
              paddingBottom: 72,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Logo size={26} color="#fff" />
              <Text style={{ fontWeight: "700", fontSize: 16, color: "#fff", flex: 1 }}>{ws?.name ?? "kloop"}</Text>
              <Pressable onPress={() => router.push("/(requester)/settings")}>
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    backgroundColor: "rgba(255,255,255,0.18)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>
                    {(ws?.user?.name ?? "?")
                      .split(/\s+/)
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </Text>
                </View>
              </Pressable>
            </View>

            <Text style={{ fontSize: 34, lineHeight: 40, fontWeight: "800", color: "#fff", letterSpacing: -0.6, marginTop: 26, maxWidth: 280 }}>
              Something not working?
            </Text>
            <Text style={{ fontSize: 15, lineHeight: 21, color: "rgba(255,255,255,0.72)", marginTop: 8, marginBottom: 4, maxWidth: 320 }}>
              Tell us in one message. Most issues are solved without waiting.
            </Text>
          </View>

          {/* composer card floats between hero and content */}
          <View
            style={{
              marginTop: -52,
              marginHorizontal: 16,
              backgroundColor: colors.card,
              borderRadius: 24,
              padding: 16,
              gap: 12,
              shadowColor: "#1D1B16",
              shadowOpacity: 0.1,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
              elevation: 6,
            }}
          >
            <TextInput
              ref={inputRef}
              multiline
              placeholder="Type what's wrong…"
              placeholderTextColor={colors.textFaint}
              value={text}
              onChangeText={setText}
              style={{ minHeight: 56, fontSize: 16, color: colors.text, textAlignVertical: "top" }}
            />
            <AttachmentTray items={att.attachments} onRemove={att.remove} />
            {att.error ? (
              <Pressable
                onPress={att.dismissError}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  alignSelf: "flex-start",
                  gap: 6,
                  backgroundColor: "rgba(200,60,50,0.12)",
                  borderRadius: 999,
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                }}
              >
                <Text numberOfLines={1} style={{ color: colors.danger, fontSize: 12, fontWeight: "600", maxWidth: 240 }}>{att.error}</Text>
                <SymbolView name={{ ios: "xmark", android: "close" }} size={10} weight="bold" tintColor={colors.danger} />
              </Pressable>
            ) : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <RoundAction icon={{ ios: "camera", android: "photo_camera" }} onPress={() => void att.attach("camera")} />
              <RoundAction icon={{ ios: "photo", android: "image" }} onPress={() => void att.attach("photo")} />
              <RoundAction
                icon={att.recording ? { ios: "stop.fill", android: "stop" } : { ios: "mic", android: "mic" }}
                active={att.recording}
                onPress={() => void att.attach("voice")}
              />
              <View style={{ flex: 1 }} />
              <Link
                href={{ pathname: "/request/[id]", params: { id: "pending", draft, attachments: attachmentsParam } }}
                asChild
              >
                <Pressable
                  onPress={() => {
                    haptics.tap();
                    clearComposer();
                  }}
                  disabled={!canSend}
                  style={{
                    height: 40,
                    paddingHorizontal: 24,
                    borderRadius: 999,
                    backgroundColor: canSend ? colors.primary : colors.sage,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Link.AppleZoom>
                    <View>
                      {att.uploading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Send</Text>
                      )}
                    </View>
                  </Link.AppleZoom>
                </Pressable>
              </Link>
            </View>
            {showHint && (
              <DeflectionHint
                searching={searching}
                count={suggestions.length}
                onPress={() => Keyboard.dismiss()}
              />
            )}
          </View>

          <View style={{ paddingHorizontal: 16 }}>
            {queue.length > 0 && (
              <View style={{ backgroundColor: colors.amberSoft, borderRadius: radii.md, padding: 12, marginTop: 12 }}>
                <Text style={{ color: colors.amber, fontSize: 13, fontWeight: "500" }}>
                  {queue.length} draft{queue.length > 1 ? "s" : ""} queued offline — will send when you're back online.
                </Text>
              </View>
            )}

            {/* live deflection */}
            {isFetching && suggestions.length === 0 && <Spinner pad={20} />}
            {suggestions.length > 0 && (
              <View style={{ marginTop: 20, gap: 10 }}>
                <View style={{ paddingHorizontal: 4 }}>
                  <SectionLabel>This might solve it</SectionLabel>
                </View>
                {suggestions.map((s) => (
                  <SuggestionCard key={`${s.kind}-${s.id}`} s={s} draftTitle={text.trim()} />
                ))}
              </View>
            )}

            {/* browse + my requests */}
            <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
              <Card onPress={() => router.push("/kb")} style={{ flex: 1, padding: 16, gap: 10 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: colors.mint,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Logo size={22} stroke={5} />
                </View>
                <View>
                  <Text style={{ fontWeight: "700", fontSize: 15, color: colors.text }}>Browse help articles</Text>
                  <Text style={{ fontSize: 12.5, color: colors.textSecondary, marginTop: 3, lineHeight: 17 }}>
                    Step-by-step fixes, searchable
                  </Text>
                </View>
              </Card>
              <Card onPress={() => router.push("/(requester)/requests")} style={{ flex: 1, padding: 16, gap: 10 }}>
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: colors.chip,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontWeight: "800", fontSize: 16, color: colors.text }}>{openRequests.length}</Text>
                </View>
                <View>
                  <Text style={{ fontWeight: "700", fontSize: 15, color: colors.text }}>My open requests</Text>
                  <Text style={{ fontSize: 12.5, color: colors.textSecondary, marginTop: 3, lineHeight: 17 }}>
                    {replyWaiting > 0
                      ? `${replyWaiting} repl${replyWaiting === 1 ? "y" : "ies"} waiting for you`
                      : openRequests.length > 0
                        ? "We're on it"
                        : "Nothing open right now"}
                  </Text>
                </View>
              </Card>
            </View>

            {/* recently fixed */}
            {articles.length > 0 && (
              <View style={{ marginTop: 24, gap: 8 }}>
                <View style={{ paddingHorizontal: 4, marginBottom: 2 }}>
                  <SectionLabel>Fixed recently at {ws?.name ?? "your team"}</SectionLabel>
                </View>
                {articles.map((a) => (
                  <Pressable
                    key={a.id}
                    onPress={() => router.push({ pathname: "/article/[id]", params: { id: a.id } })}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      backgroundColor: colors.card,
                      borderRadius: 16,
                      paddingVertical: 14,
                      paddingHorizontal: 14,
                    }}
                  >
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontWeight: "600", color: colors.text }}>
                      {a.title}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.textSecondary }}>
                      {a.solveCount > 0 ? `${a.solveCount}× solved` : "self-serve"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

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

/**
 * Inline strip at the bottom of the composer card, shown only while the
 * keyboard hides the suggestion list below: pulses while deflection searches,
 * then announces how many known fixes matched. Tapping dismisses the keyboard
 * so the suggestions scroll into view.
 */
function DeflectionHint({ searching, count, onPress }: { searching: boolean; count: number; onPress: () => void }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    if (searching) loop.start();
    else pulse.setValue(1);
    return () => loop.stop();
  }, [searching, pulse]);

  // animate the strip in/out so it doesn't pop while the user types
  useEffect(() => {
    LayoutAnimation.configureNext(LayoutAnimation.create(200, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
  }, [searching, count]);

  return (
    <Pressable
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      disabled={searching}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: colors.mint,
        borderRadius: radii.md,
        paddingVertical: 10,
        paddingHorizontal: 12,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {searching ? (
        <Animated.Text style={{ opacity: pulse, fontSize: 14, color: colors.primary }}>✦</Animated.Text>
      ) : (
        <Text style={{ fontSize: 14, color: colors.primary }}>✦</Text>
      )}
      <Text style={{ flex: 1, fontSize: 13, fontWeight: "600", color: colors.primary }}>
        {searching
          ? "Looking for a known fix…"
          : `${count === 1 ? "A known fix" : `${count} known fixes`} might solve this — take a look`}
      </Text>
      {!searching && (
        <SymbolView name={{ ios: "chevron.down", android: "keyboard_arrow_down" }} size={12} weight="semibold" tintColor={colors.primary} />
      )}
    </Pressable>
  );
}

/** Circular light action button in the composer (camera / photo / mic). */
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
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: active ? colors.primary : colors.chip,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <SymbolView name={icon} size={16} tintColor={active ? "#fff" : colors.text} />
    </Pressable>
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
