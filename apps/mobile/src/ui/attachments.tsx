import { useState } from "react";
import { Image, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { AudioModule, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { colors } from "@kloop/shared";

/** An uploaded attachment still held in the composer (local file for previews). */
export type LocalAttachment = {
  id: string;
  filename: string;
  kind: string; // image | audio | file
  localUri: string;
  durationMs?: number;
};

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Pending-attachment previews above the composer: image thumbnails (tap →
 * fullscreen) and playable voice-note chips. Removal only via the ✕ badge.
 */
export function AttachmentTray({ items, onRemove }: { items: LocalAttachment[]; onRemove: (id: string) => void }) {
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  if (items.length === 0) return null;

  const images = items.filter((a) => a.kind === "image");
  const others = items.filter((a) => a.kind !== "image");

  return (
    <View style={{ gap: 8 }}>
      {images.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 4, paddingTop: 6 }}>
          {images.map((a) => (
            <View key={a.id}>
              <Pressable onPress={() => setViewerUri(a.localUri)}>
                <Image source={{ uri: a.localUri }} style={{ width: 64, height: 64, borderRadius: 12, backgroundColor: colors.chip }} />
              </Pressable>
              <RemoveBadge onPress={() => onRemove(a.id)} />
            </View>
          ))}
        </ScrollView>
      )}
      {others.map((a) =>
        a.kind === "audio" ? (
          <AudioChip key={a.id} uri={a.localUri} durationMs={a.durationMs} onRemove={() => onRemove(a.id)} />
        ) : (
          <View
            key={a.id}
            style={{ flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", backgroundColor: colors.mint, borderRadius: 999, paddingVertical: 6, paddingLeft: 12, paddingRight: 6, marginHorizontal: 4 }}
          >
            <SymbolView name={{ ios: "paperclip", android: "attach_file" }} size={13} tintColor={colors.primary} />
            <Text numberOfLines={1} style={{ color: colors.primary, fontSize: 13, maxWidth: 180 }}>{a.filename}</Text>
            <RemoveCircle onPress={() => onRemove(a.id)} />
          </View>
        ),
      )}

      <ImageViewer uri={viewerUri} onClose={() => setViewerUri(null)} />
    </View>
  );
}

/** ✕ badge overlapping a thumbnail's top-right corner. */
function RemoveBadge({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{
        position: "absolute",
        top: -6,
        right: -6,
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: colors.text,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: colors.card,
      }}
    >
      <SymbolView name={{ ios: "xmark", android: "close" }} size={10} weight="bold" tintColor="#fff" />
    </Pressable>
  );
}

function RemoveCircle({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(29,27,22,0.12)", alignItems: "center", justifyContent: "center" }}
    >
      <SymbolView name={{ ios: "xmark", android: "close" }} size={10} weight="bold" tintColor={colors.primary} />
    </Pressable>
  );
}

/**
 * Voice note player: play/pause + live position, WhatsApp-style. Used in the
 * composer tray (with onRemove) and inside chat bubbles (onDark = own bubble).
 */
export function AudioChip({
  uri,
  durationMs,
  onRemove,
  onDark,
}: {
  uri: string;
  durationMs?: number;
  onRemove?: () => void;
  onDark?: boolean;
}) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const totalMs = status.duration > 0 ? status.duration * 1000 : (durationMs ?? 0);
  const label = status.playing ? formatDuration(status.currentTime * 1000) : formatDuration(totalMs);

  const bg = onDark ? "rgba(255,255,255,0.2)" : colors.mint;
  const fg = onDark ? "#fff" : colors.primary;
  const btnBg = onDark ? "#fff" : colors.primary;
  const btnFg = onDark ? colors.primary : "#fff";

  const toggle = () => {
    if (status.playing) {
      player.pause();
      return;
    }
    // the recorder leaves the session in record mode; also make sure the
    // hardware mute switch doesn't silence playback
    void AudioModule.setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    // replay from the start once it finished
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.05)) {
      player.seekTo(0);
    }
    player.play();
  };

  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 10, alignSelf: "flex-start", backgroundColor: bg, borderRadius: 999, paddingVertical: 5, paddingLeft: 6, paddingRight: onRemove ? 6 : 14, marginHorizontal: onRemove ? 4 : 0 }}
    >
      <Pressable
        onPress={toggle}
        hitSlop={6}
        style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: btnBg, alignItems: "center", justifyContent: "center" }}
      >
        <SymbolView
          name={status.playing ? { ios: "pause.fill", android: "pause" } : { ios: "play.fill", android: "play_arrow" }}
          size={12}
          tintColor={btnFg}
        />
      </Pressable>
      <SymbolView name={{ ios: "waveform", android: "graphic_eq" }} size={16} tintColor={fg} />
      <Text style={{ color: fg, fontSize: 13, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{label}</Text>
      {onRemove && <RemoveCircle onPress={onRemove} />}
    </View>
  );
}

/** Minimal fullscreen image viewer: black backdrop, fade in, tap or ✕ to close. */
export function ImageViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!uri} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {uri && (
          <Pressable style={{ flex: 1 }} onPress={onClose}>
            <Image source={{ uri }} style={{ flex: 1 }} resizeMode="contain" />
          </Pressable>
        )}
        <Pressable
          onPress={onClose}
          hitSlop={10}
          style={{
            position: "absolute",
            top: Math.max(insets.top, 16),
            right: 16,
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: "rgba(255,255,255,0.18)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <SymbolView name={{ ios: "xmark", android: "close" }} size={15} weight="semibold" tintColor="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}
