import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, radii } from "@kloop/shared";
import { api } from "../../src/api";
import { useVoiceNote } from "../../src/recorder";
import { pickImage, uploadFile } from "../../src/uploads";
import { Button, Chip, Logo, SectionLabel } from "../../src/ui";
import { AttachmentTray, type LocalAttachment } from "../../src/ui/attachments";

/**
 * Resolution capture — "How did you fix it?" (<30s). Presented as a native
 * form sheet (see the Stack.Screen options in app/_layout.tsx), so the slide,
 * backdrop, and grabber all come from the system.
 */
export default function ResolveScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const [text, setText] = useState("");
  const [linked, setLinked] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const voice = useVoiceNote();

  const { data: similar } = useQuery({
    queryKey: ["similar-resolutions", id],
    queryFn: () => api.similarResolutions(id),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });

  const resolve = useMutation({
    mutationFn: (skip: boolean) =>
      api.resolve(id, {
        rawCaptureText: skip ? undefined : text.trim() || undefined,
        captureKind: attachments.length > 0 ? "mixed" : "text",
        linkedResolutionId: linked,
        attachmentIds: attachments.map((a) => a.id),
        skipCapture: skip && !text.trim() && !linked && attachments.length === 0,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["request", id] });
      void qc.invalidateQueries({ queryKey: ["requests"] });
      router.back();
    },
  });

  const attach = async (kind: "photo" | "voice") => {
    try {
      if (kind === "voice") {
        if (voice.recording) {
          const note = await voice.stop();
          if (note) {
            const a = await uploadFile(note);
            setAttachments((x) => [...x, { id: a.id, filename: a.filename, kind: "audio", localUri: note.uri, durationMs: note.durationMs }]);
          }
        } else {
          await voice.start();
        }
        return;
      }
      const picked = await pickImage(false);
      if (picked) {
        const a = await uploadFile(picked);
        setAttachments((x) => [...x, { id: a.id, filename: a.filename, kind: a.kind, localUri: picked.uri }]);
      }
    } catch {
      /* ignore */
    }
  };

  // The ScrollView must be the direct child of the sheet: RNS form sheets
  // size a descendant ScrollView natively, but the lookup only checks direct
  // children — wrapped in a View it ends up laid out offscreen (invisible).
  // See software-mansion/react-native-screens#3634. No KeyboardAvoidingView
  // either: the native sheet raises itself above the keyboard.
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 20, paddingBottom: 34 }}
    >
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>How did you fix it?</Text>
      <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 3, marginBottom: 12 }}>
        Rough is fine — kloop structures it afterwards.
      </Text>

      <TextInput
        multiline
        autoFocus
        placeholder="Re-installed the VPN profile from Self Service, restarted the client…"
        placeholderTextColor={colors.textFaint}
        value={text}
        onChangeText={setText}
        style={{
          backgroundColor: colors.card,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          minHeight: 110,
          maxHeight: 180,
          padding: 14,
          fontSize: 15,
          color: colors.text,
          textAlignVertical: "top",
        }}
      />

      <View style={{ marginTop: 8 }}>
        <AttachmentTray items={attachments} onRemove={(rid) => setAttachments((x) => x.filter((y) => y.id !== rid))} />
      </View>

      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <Chip
          label={voice.recording ? "Stop" : "Voice"}
          active={voice.recording}
          icon={
            <SymbolView
              name={voice.recording ? { ios: "stop.fill", android: "stop" } : { ios: "mic.fill", android: "mic" }}
              size={13}
              tintColor={voice.recording ? "#fff" : colors.text}
            />
          }
          onPress={() => void attach("voice")}
          style={{ flex: 1, justifyContent: "center" }}
        />
        <Chip
          label="Photo"
          icon={<SymbolView name={{ ios: "photo", android: "image" }} size={13} tintColor={colors.text} />}
          onPress={() => void attach("photo")}
          style={{ flex: 1, justifyContent: "center" }}
        />
        <Chip
          label="Log"
          icon={<SymbolView name={{ ios: "apple.terminal", android: "terminal" }} size={13} tintColor={colors.text} />}
          onPress={() => void attach("photo")}
          style={{ flex: 1, justifyContent: "center" }}
        />
      </View>

      {(similar?.resolutions.length ?? 0) > 0 && (
        <View style={{ marginTop: 18, gap: 8 }}>
          <SectionLabel>Same as last time?</SectionLabel>
          {similar!.resolutions.slice(0, 3).map((r) => {
            const active = linked === r.id;
            return (
              <Pressable
                key={r.id}
                onPress={() => setLinked(active ? null : r.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  backgroundColor: colors.mint,
                  borderRadius: radii.md,
                  borderWidth: active ? 2 : 0,
                  borderColor: colors.primary,
                  padding: 12,
                }}
              >
                <Logo size={20} stroke={4.5} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontWeight: "600", fontSize: 14, color: colors.text }}>
                    {r.ref} · {r.requestTitle}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textSecondary }}>
                    {r.supporterName ? `Solved by ${r.supporterName}` : "Solved"} · tap to link
                  </Text>
                </View>
                <Text style={{ color: colors.textFaint }}>›</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={{ flexDirection: "row", gap: 10, marginTop: 20 }}>
        <Button title="Skip" variant="secondary" style={{ flex: 1 }} disabled={resolve.isPending} onPress={() => resolve.mutate(true)} />
        <Button title="Done — resolve" style={{ flex: 2 }} loading={resolve.isPending} onPress={() => resolve.mutate(false)} />
      </View>
    </ScrollView>
  );
}
