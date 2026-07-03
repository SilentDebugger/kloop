import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { colors, radii } from "@kloop/shared";
import { api } from "../api";
import { useVoiceNote } from "../recorder";
import { pickImage, uploadFile } from "../uploads";
import { Button, Chip, Logo, SectionLabel } from "../ui";

/** Resolution capture bottom sheet — "How did you fix it?" (<30s). */
export function ResolveSheet({
  open,
  onClose,
  requestId,
  onResolved,
}: {
  open: boolean;
  onClose: () => void;
  requestId: string;
  onResolved: () => void;
}) {
  const [text, setText] = useState("");
  const [linked, setLinked] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<{ id: string; filename: string }[]>([]);
  const voice = useVoiceNote();

  const { data: similar } = useQuery({
    queryKey: ["similar-resolutions", requestId],
    queryFn: () => api.similarResolutions(requestId),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const resolve = useMutation({
    mutationFn: (skip: boolean) =>
      api.resolve(requestId, {
        rawCaptureText: skip ? undefined : text.trim() || undefined,
        captureKind: attachments.length > 0 ? "mixed" : "text",
        linkedResolutionId: linked,
        attachmentIds: attachments.map((a) => a.id),
        skipCapture: skip && !text.trim() && !linked && attachments.length === 0,
      }),
    onSuccess: onResolved,
  });

  const attach = async (kind: "photo" | "voice") => {
    try {
      if (kind === "voice") {
        if (voice.recording) {
          const note = await voice.stop();
          if (note) {
            const a = await uploadFile(note);
            setAttachments((x) => [...x, { id: a.id, filename: a.filename }]);
          }
        } else {
          await voice.start();
        }
        return;
      }
      const picked = await pickImage(false);
      if (picked) {
        const a = await uploadFile(picked);
        setAttachments((x) => [...x, { id: a.id, filename: a.filename }]);
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(29,27,22,0.4)" }} onPress={onClose} />
      <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, maxHeight: "85%" }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 14 }} />
        <ScrollView keyboardShouldPersistTaps="handled">
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
              padding: 14,
              fontSize: 15,
              color: colors.text,
              textAlignVertical: "top",
            }}
          />

          {attachments.length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
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

          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <Chip label={voice.recording ? "● Stop" : "● Voice"} active={voice.recording} onPress={() => void attach("voice")} style={{ flex: 1, justifyContent: "center" }} />
            <Chip label="▢ Photo" onPress={() => void attach("photo")} style={{ flex: 1, justifyContent: "center" }} />
            <Chip label=">_ Log" onPress={() => void attach("photo")} style={{ flex: 1, justifyContent: "center" }} />
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
      </View>
    </Modal>
  );
}
