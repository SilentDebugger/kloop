import { useEffect, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, radii } from "@kloop/shared";
import { api } from "../src/api";
import { haptics } from "../src/haptics";
import { useActiveWorkspace } from "../src/store/connection";
import { useComposerAttachments } from "../src/uploads";
import { Avatar, Button } from "../src/ui";
import { AttachmentTray } from "../src/ui/attachments";

type Target = { kind: "user"; id: string; name: string; email: string } | { kind: "guest"; name: string };

/**
 * Supporter-created request — logged for an existing user (walk-up, phone
 * call) or a guest who isn't in the user list. Native form sheet (Stack.Screen
 * options in app/_layout.tsx).
 *
 * Two states, per the design: picking a person (results live inside the FOR
 * card, problem card dimmed) → person collapses to a chip and the problem
 * card wakes up, CTA becomes "Create for {name}".
 */
export default function NewRequestScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const ws = useActiveWorkspace();

  const [query, setQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const titleRef = useRef<TextInput>(null);
  const att = useComposerAttachments();

  const { data } = useQuery({ queryKey: ["directory"], queryFn: () => api.directory(), staleTime: 5 * 60_000 });

  const q = query.trim().toLowerCase();
  const matches =
    q.length > 0 && !target
      ? (data?.users ?? [])
          .filter((u) => u.id !== ws?.user?.id && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)))
          .slice(0, 4)
      : [];

  const pick = (t: Target) => {
    haptics.select();
    setTarget(t);
  };

  // the problem card is disabled while picking — hand focus over once chosen
  useEffect(() => {
    if (target) setTimeout(() => titleRef.current?.focus(), 50);
  }, [target]);

  const create = useMutation({
    mutationFn: (t: Target) =>
      api.createRequest({
        title: title.trim(),
        body: details.trim(),
        channel: "mobile",
        attachmentIds: att.ids,
        onBehalf: t.kind === "user" ? { userId: t.id } : { guestName: t.name },
      }),
    onSuccess: (res) => {
      haptics.success();
      void qc.invalidateQueries({ queryKey: ["requests"] });
      router.back();
      router.push(`/request/${res.request.id}`);
    },
    onError: () => haptics.error(),
  });

  const firstName = target?.name.trim().split(/\s+/)[0] ?? "";
  const canCreate = !!target && title.trim().length >= 3 && !create.isPending && !att.uploading;
  const showResults = !target && q.length > 0;

  // ScrollView must be the direct child of the sheet (see resolve/[id].tsx).
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 20, paddingBottom: 34 }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 23, fontWeight: "800", color: colors.text, letterSpacing: -0.3 }}>New request</Text>
          <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 3 }}>
            For a colleague — or a guest without an account.
          </Text>
        </View>
        <Pressable
          hitSlop={8}
          onPress={() => router.back()}
          style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.chip, alignItems: "center", justifyContent: "center" }}
        >
          <SymbolView name={{ ios: "xmark", android: "close" }} size={12} weight="semibold" tintColor={colors.textSecondary} />
        </Pressable>
      </View>

      <Text style={sectionLabel}>For</Text>

      {target ? (
        /* 5b — chosen person collapses to a chip */
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: colors.mint,
            borderRadius: radii.lg,
            padding: 12,
          }}
        >
          {target.kind === "user" ? (
            <Avatar name={target.name} size={38} tint />
          ) : (
            <GuestCircle size={38} />
          )}
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontWeight: "700", fontSize: 15, color: colors.text }}>{target.name}</Text>
            <Text numberOfLines={1} style={{ fontSize: 12.5, color: colors.textSecondary, marginTop: 1 }}>
              {target.kind === "user" ? target.email : "Guest — tracked by name only"}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              haptics.select();
              setTarget(null);
              setQuery("");
            }}
            style={({ pressed }) => ({
              backgroundColor: colors.card,
              borderRadius: radii.pill,
              borderWidth: 1,
              borderColor: colors.border,
              paddingVertical: 7,
              paddingHorizontal: 14,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "700" }}>Change</Text>
          </Pressable>
        </View>
      ) : (
        /* 5a — search field; results live inside the field's card */
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: radii.lg,
            borderWidth: 1.5,
            borderColor: searchFocused ? colors.borderFocus : colors.border,
            overflow: "hidden",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 14 }}>
            <SymbolView name={{ ios: "magnifyingglass", android: "search" }} size={15} tintColor={colors.textFaint} />
            <TextInput
              autoFocus
              placeholder="Search people, or type a guest's name…"
              placeholderTextColor={colors.textFaint}
              value={query}
              onChangeText={setQuery}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              style={{ flex: 1, paddingVertical: 13, fontSize: 15, color: colors.text }}
            />
          </View>

          {showResults && (
            <>
              {matches.map((u) => (
                <Pressable
                  key={u.id}
                  onPress={() => pick({ kind: "user", id: u.id, name: u.name, email: u.email })}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    backgroundColor: pressed ? colors.surface : "transparent",
                  })}
                >
                  <Avatar name={u.name} size={34} tint />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontWeight: "700", fontSize: 14.5, color: colors.text }}>{u.name}</Text>
                    <Text numberOfLines={1} style={{ fontSize: 12.5, color: colors.textSecondary, marginTop: 1 }}>{u.email}</Text>
                  </View>
                  <SymbolView name={{ ios: "chevron.right", android: "chevron_right" }} size={12} tintColor={colors.textFaint} />
                </Pressable>
              ))}
              <Pressable
                onPress={() => pick({ kind: "guest", name: query.trim() })}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                  backgroundColor: pressed ? colors.surface : "transparent",
                })}
              >
                <GuestCircle size={34} dashed />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ fontWeight: "700", fontSize: 14.5, color: colors.primary }}>
                    Add "{query.trim()}" as a guest
                  </Text>
                  <Text style={{ fontSize: 12.5, color: colors.textSecondary, marginTop: 1 }}>
                    No account needed — just for tracking
                  </Text>
                </View>
              </Pressable>
            </>
          )}
        </View>
      )}

      <Text style={sectionLabel}>Problem</Text>

      {/* one card: title + details + attach row — dimmed until a person is chosen */}
      <View
        pointerEvents={target ? "auto" : "none"}
        style={{
          backgroundColor: colors.card,
          borderRadius: radii.lg,
          borderWidth: 1,
          borderColor: colors.border,
          opacity: target ? 1 : 0.55,
        }}
      >
        <TextInput
          ref={titleRef}
          placeholder="Scanner gun won't pair after battery swap…"
          placeholderTextColor={colors.textFaint}
          value={title}
          onChangeText={setTitle}
          style={{ paddingHorizontal: 16, paddingTop: 15, paddingBottom: 4, fontSize: 16, fontWeight: "600", color: colors.text }}
        />
        <TextInput
          multiline
          placeholder="Details (optional) — what was tried, error messages…"
          placeholderTextColor={colors.textFaint}
          value={details}
          onChangeText={setDetails}
          style={{
            paddingHorizontal: 16,
            paddingTop: 6,
            paddingBottom: 10,
            minHeight: 64,
            maxHeight: 140,
            fontSize: 14.5,
            lineHeight: 20,
            color: colors.text,
            textAlignVertical: "top",
          }}
        />

        <View style={{ paddingHorizontal: 10 }}>
          <AttachmentTray items={att.attachments} onRemove={att.remove} />
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, paddingTop: 8 }}>
          <AttachCircle
            icon={{ ios: "camera", android: "photo_camera" }}
            onPress={() => void att.attach("camera")}
          />
          <AttachCircle
            icon={att.recording ? { ios: "stop.fill", android: "stop" } : { ios: "mic", android: "mic" }}
            active={att.recording}
            onPress={() => void att.attach("voice")}
          />
          <AttachCircle
            icon={{ ios: "doc", android: "description" }}
            onPress={() => void att.attach("file")}
          />
          <View style={{ flex: 1 }} />
          {att.uploading ? (
            <ActivityIndicator size="small" color={colors.textFaint} />
          ) : (
            <Text style={{ fontSize: 12.5, color: colors.textFaint }}>Photo · Voice · File</Text>
          )}
        </View>

        {att.error ? (
          <Pressable onPress={att.dismissError} style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
            <Text style={{ color: colors.danger, fontSize: 12.5, fontWeight: "500" }}>{att.error} — tap to dismiss</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ marginTop: 22, gap: 12 }}>
        <Button
          size="lg"
          title={target ? `Create for ${firstName}` : "Create request"}
          disabled={!canCreate}
          loading={create.isPending || att.uploading}
          onPress={() => target && create.mutate(target)}
        />
        {create.isError ? (
          <Text style={{ textAlign: "center", fontSize: 13, color: colors.danger, fontWeight: "500" }}>
            Couldn't create the request — try again.
          </Text>
        ) : target ? (
          <Text style={{ textAlign: "center", fontSize: 13, color: colors.textSecondary }}>
            {target.kind === "user"
              ? `${firstName} gets notified and can follow the request`
              : `${firstName} is tracked by name — guests aren't notified`}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

const sectionLabel = {
  fontSize: 11,
  fontWeight: "600",
  letterSpacing: 1,
  color: colors.textSecondary,
  textTransform: "uppercase",
  marginTop: 18,
  marginBottom: 8,
} as const;

/** Guest avatar stand-in: ⊕ in a (dashed) circle, per the design. */
function GuestCircle({ size, dashed }: { size: number; dashed?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 1.5,
        borderStyle: dashed ? "dashed" : "solid",
        borderColor: dashed ? colors.textFaint : colors.mintStrong,
        backgroundColor: dashed ? "transparent" : colors.card,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <SymbolView
        name={{ ios: "plus", android: "add" }}
        size={size * 0.4}
        weight="medium"
        tintColor={dashed ? colors.textSecondary : colors.primary}
      />
    </View>
  );
}

/** Circular outline attach button (camera / mic / file) inside the problem card. */
function AttachCircle({
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
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        borderWidth: active ? 0 : 1,
        borderColor: colors.border,
        backgroundColor: active ? colors.danger : "transparent",
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <SymbolView name={icon} size={16} tintColor={active ? "#fff" : colors.text} />
    </Pressable>
  );
}
