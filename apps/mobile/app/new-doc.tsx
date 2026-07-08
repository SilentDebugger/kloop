import type { ComponentProps } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { SymbolView } from "expo-symbols";
import { colors, radii } from "@kloop/shared";
import { api } from "../src/api";
import { haptics } from "../src/haptics";
import { useSetActiveDocCapture } from "../src/docCapture";
import { useDrafts } from "../src/store/drafts";
import { useComposerAttachments } from "../src/uploads";
import { Button, ErrorNote, GlassSurface } from "../src/ui";
import { AttachmentTray } from "../src/ui/attachments";

/**
 * Knowledge capture ("New doc") — reached via the native zoom morph from the
 * Knowledge tab's pill. Capture only: "Turn into drafts" starts generation,
 * morphs this screen away and presents the doc-capture sheet, which tracks
 * progress and shows the results (and can be dismissed/reopened freely).
 */
export default function NewDocScreen() {
  const router = useRouter();
  const text = useDrafts((s) => s.docCaptureText);
  const setText = useDrafts((s) => s.setDocCaptureText);
  const setActive = useSetActiveDocCapture();
  const att = useComposerAttachments();

  const create = useMutation({
    mutationFn: () => api.createDocCapture({ text, attachmentIds: att.ids }),
    onSuccess: (res) => {
      haptics.success();
      setText("");
      att.clear();
      // seed the shared active-capture cache so the pill flips instantly
      setActive(res.capture);
      // play the zoom morph out first, then slide the progress sheet up.
      // A timer, not InteractionManager: native screen transitions aren't RN
      // interactions, so runAfterInteractions fires immediately mid-morph
      router.back();
      setTimeout(() => router.push(`/doc-capture/${res.capture.id}`), 450);
    },
    onError: () => haptics.error(),
  });

  const close = () => router.back();

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
        <View style={{ marginTop: 14 }}>
          <Button
            title="✦  Turn into drafts"
            size="lg"
            disabled={!canSubmit}
            loading={create.isPending}
            onPress={() => create.mutate()}
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
