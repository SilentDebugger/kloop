import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { colors, radii } from "@kloop/shared";
import { api } from "../src/api";
import { useActiveWorkspace } from "../src/store/connection";
import { useComposerAttachments } from "../src/uploads";
import { Avatar, Button, SectionLabel } from "../src/ui";
import { AttachChips, AttachmentTray } from "../src/ui/attachments";

type Target = { kind: "user"; id: string; name: string; email: string } | { kind: "guest"; name: string };

/**
 * Supporter-created request — logged for an existing user (walk-up, phone
 * call) or a guest who isn't in the user list. Same native form sheet as the
 * resolve capture (Stack.Screen options in app/_layout.tsx).
 */
export default function NewRequestScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const ws = useActiveWorkspace();

  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const att = useComposerAttachments();

  const { data } = useQuery({ queryKey: ["directory"], queryFn: () => api.directory(), staleTime: 5 * 60_000 });

  const q = query.trim().toLowerCase();
  const matches =
    q.length > 0 && !target
      ? (data?.users ?? [])
          .filter((u) => u.id !== ws?.user?.id && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)))
          .slice(0, 4)
      : [];

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
      void qc.invalidateQueries({ queryKey: ["requests"] });
      router.back();
      router.push(`/request/${res.request.id}`);
    },
  });

  const canCreate = !!target && title.trim().length >= 3 && !create.isPending && !att.uploading;

  // ScrollView must be the direct child of the sheet (see resolve/[id].tsx).
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      style={{ backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 20, paddingBottom: 34 }}
    >
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.text }}>New request</Text>
      <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 3, marginBottom: 16 }}>
        Log an issue for a user — or a guest who isn't in kloop.
      </Text>

      <SectionLabel>Who is it for?</SectionLabel>
      {target ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            backgroundColor: colors.mint,
            borderRadius: radii.md,
            padding: 12,
            marginTop: 8,
          }}
        >
          {target.kind === "user" ? (
            <Avatar name={target.name} size={34} tint />
          ) : (
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.card, alignItems: "center", justifyContent: "center" }}>
              <SymbolView name={{ ios: "person.fill.questionmark", android: "person_add" }} size={16} tintColor={colors.primary} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontWeight: "700", fontSize: 15, color: colors.text }}>{target.name}</Text>
            <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textSecondary }}>
              {target.kind === "user" ? target.email : "Guest — tracked by name only"}
            </Text>
          </View>
          <Pressable
            hitSlop={8}
            onPress={() => {
              setTarget(null);
              setQuery("");
            }}
            style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(29,27,22,0.12)", alignItems: "center", justifyContent: "center" }}
          >
            <SymbolView name={{ ios: "xmark", android: "close" }} size={11} weight="bold" tintColor={colors.primary} />
          </Pressable>
        </View>
      ) : (
        <View style={{ marginTop: 8, gap: 8 }}>
          <TextInput
            autoFocus
            placeholder="Search people, or type a guest's name…"
            placeholderTextColor={colors.textFaint}
            value={query}
            onChangeText={setQuery}
            style={{
              backgroundColor: colors.card,
              borderRadius: radii.md,
              borderWidth: 1,
              borderColor: colors.border,
              paddingVertical: 12,
              paddingHorizontal: 14,
              fontSize: 15,
              color: colors.text,
            }}
          />
          {matches.map((u) => (
            <Pressable
              key={u.id}
              onPress={() => setTarget({ kind: "user", id: u.id, name: u.name, email: u.email })}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card, borderRadius: radii.md, padding: 12 }}
            >
              <Avatar name={u.name} size={34} tint />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontWeight: "600", fontSize: 14, color: colors.text }}>{u.name}</Text>
                <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textSecondary }}>{u.email}</Text>
              </View>
              <Text style={{ color: colors.textFaint }}>›</Text>
            </Pressable>
          ))}
          {q.length > 0 && (
            <Pressable
              onPress={() => setTarget({ kind: "guest", name: query.trim() })}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                backgroundColor: colors.card,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: colors.border,
                borderStyle: "dashed",
                padding: 12,
              }}
            >
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.chip, alignItems: "center", justifyContent: "center" }}>
                <SymbolView name={{ ios: "person.fill.questionmark", android: "person_add" }} size={16} tintColor={colors.textSecondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontWeight: "600", fontSize: 14, color: colors.text }}>
                  Add "{query.trim()}" as guest
                </Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary }}>No account needed — for your own tracking</Text>
              </View>
            </Pressable>
          )}
        </View>
      )}

      <View style={{ marginTop: 18 }}>
        <SectionLabel>What's the problem?</SectionLabel>
      </View>
      <TextInput
        placeholder="Scanner gun won't pair after battery swap…"
        placeholderTextColor={colors.textFaint}
        value={title}
        onChangeText={setTitle}
        style={{
          backgroundColor: colors.card,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          paddingVertical: 12,
          paddingHorizontal: 14,
          fontSize: 15,
          color: colors.text,
          marginTop: 8,
        }}
      />
      <TextInput
        multiline
        placeholder="Details (optional)"
        placeholderTextColor={colors.textFaint}
        value={details}
        onChangeText={setDetails}
        style={{
          backgroundColor: colors.card,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          minHeight: 80,
          maxHeight: 140,
          padding: 14,
          fontSize: 15,
          color: colors.text,
          textAlignVertical: "top",
          marginTop: 8,
        }}
      />

      <View style={{ marginTop: 8 }}>
        <AttachmentTray items={att.attachments} onRemove={att.remove} />
      </View>

      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <AttachChips recording={att.recording} attach={att.attach} chipStyle={{ flex: 1, justifyContent: "center" }} />
      </View>

      <View style={{ marginTop: 20 }}>
        <Button
          title="Create request"
          disabled={!canCreate}
          loading={create.isPending || att.uploading}
          onPress={() => target && create.mutate(target)}
        />
      </View>
    </ScrollView>
  );
}
