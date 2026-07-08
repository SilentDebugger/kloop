import { useEffect, useRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import Svg, { Circle } from "react-native-svg";
import { SymbolView } from "expo-symbols";
import { colors, radii, type DocState } from "@kloop/shared";
import { haptics } from "../haptics";
import { GlassSurface } from "./glass";

export { GlassSurface, liquidGlass } from "./glass";

/* ------------------------------------------------------------------ */
/* Logo — the ring mark                                                */
/* ------------------------------------------------------------------ */
export function Logo({ size = 28, stroke = 4.5, color = colors.primary }: { size?: number; stroke?: number; color?: string }) {
  const r = (32 - stroke) / 2 - 3;
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Circle cx={16} cy={16} r={r} fill="none" stroke={color} strokeWidth={stroke} />
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */
type ButtonVariant = "primary" | "secondary" | "outline" | "danger" | "mint";

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  size = "md",
  style,
  icon,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  size?: "sm" | "md" | "lg";
  style?: StyleProp<ViewStyle>;
  icon?: ReactNode;
}) {
  const press = onPress
    ? () => {
        haptics.tap();
        onPress();
      }
    : undefined;
  const fg =
    variant === "primary" ? colors.onPrimary : variant === "danger" ? colors.danger : variant === "mint" ? colors.primary : colors.text;
  const pad = size === "sm" ? { paddingVertical: 7, paddingHorizontal: 14 } : size === "lg" ? { paddingVertical: 14, paddingHorizontal: 20 } : { paddingVertical: 11, paddingHorizontal: 18 };

  // cross-fades label <-> spinner in place instead of inserting one next to
  // the label, which used to shift the text sideways whenever `loading` flipped
  const labelOpacity = useRef(new Animated.Value(loading ? 0 : 1)).current;
  const spinnerOpacity = useRef(new Animated.Value(loading ? 1 : 0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(labelOpacity, { toValue: loading ? 0 : 1, duration: 160, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(spinnerOpacity, { toValue: loading ? 1 : 0, duration: 160, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, [loading, labelOpacity, spinnerOpacity]);

  const inner = (
    <View>
      <Animated.View style={{ flexDirection: "row", alignItems: "center", gap: 8, opacity: labelOpacity }}>
        {icon}
        <Text numberOfLines={1} style={{ color: fg, fontWeight: "600", fontSize: size === "sm" ? 13 : 15 }}>{title}</Text>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, alignItems: "center", justifyContent: "center", opacity: spinnerOpacity }}
      >
        <ActivityIndicator size="small" color={fg} />
      </Animated.View>
    </View>
  );
  const shape: ViewStyle = {
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    ...pad,
  };

  // secondary/outline have no meaningful background of their own — Liquid Glass
  if (variant === "secondary" || variant === "outline") {
    return (
      <Pressable
        onPress={press}
        disabled={disabled || loading}
        style={({ pressed }) => [{ borderRadius: radii.pill, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}
      >
        <GlassSurface interactive fallbackColor={variant === "secondary" ? colors.chip : colors.card} style={shape}>
          {inner}
        </GlassSurface>
      </Pressable>
    );
  }

  const bg = variant === "primary" ? colors.primary : variant === "mint" ? colors.mint : colors.card;
  return (
    <Pressable
      onPress={press}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          ...shape,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          ...(variant === "danger" ? { borderWidth: 1, borderColor: colors.border } : {}),
        },
        style,
      ]}
    >
      {inner}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */
export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  const base: ViewStyle = {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    shadowColor: "#1D1B16",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  };
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [base, { opacity: pressed ? 0.92 : 1 }, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}

/* ------------------------------------------------------------------ */
/* Chips & badges                                                      */
/* ------------------------------------------------------------------ */
export function Chip({
  label,
  onPress,
  active,
  icon,
  style,
}: {
  label: string;
  onPress?: () => void;
  active?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              haptics.select();
              onPress();
            }
          : undefined
      }
      disabled={!onPress}
      style={({ pressed }) => [{ borderRadius: radii.pill, opacity: pressed ? 0.85 : 1 }, style]}
    >
      <GlassSurface
        interactive={!!onPress}
        fallbackColor={colors.chip}
        tintColor={active ? colors.text : undefined}
        style={{
          borderRadius: radii.pill,
          paddingVertical: 7,
          paddingHorizontal: 14,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          flexGrow: 1,
        }}
      >
        {icon}
        <Text style={{ color: active ? "#fff" : colors.text, fontSize: 13, fontWeight: "500" }}>{label}</Text>
      </GlassSurface>
    </Pressable>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    open: { label: "Open", bg: colors.chip, fg: colors.textSecondary },
    handled: { label: "Being handled", bg: colors.mint, fg: colors.primary },
    solved: { label: "Solved", bg: colors.mint, fg: colors.primary },
  };
  const m = map[status] ?? { label: status, bg: colors.chip, fg: colors.textSecondary };
  return (
    <View style={{ backgroundColor: m.bg, borderRadius: radii.pill, paddingVertical: 4, paddingHorizontal: 12 }}>
      <Text style={{ color: m.fg, fontSize: 12, fontWeight: "600" }}>{m.label}</Text>
    </View>
  );
}

/** open/handled status line — "● Being handled · updated 5m ago" */
export function StatusLine({ status, meta }: { status: "open" | "handled"; meta: string }) {
  const handled = status === "handled";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {handled ? (
        <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.primary }} />
      ) : (
        <View style={{ width: 7, height: 7, borderRadius: 3.5, borderWidth: 1.5, borderColor: colors.textFaint }} />
      )}
      <Text style={{ fontSize: 13, fontWeight: "700", color: handled ? colors.primary : colors.textSecondary }}>
        {handled ? "Being handled" : "Open"}
      </Text>
      <Text style={{ fontSize: 13, color: colors.textSecondary }}>· {meta}</Text>
    </View>
  );
}

/** inline preview of the latest reply — avatar + "Name: "snippet…"" + optional unread dot */
export function ReplyPreview({ name, body, unread }: { name: string; body: string; unread?: boolean }) {
  const snippet = body.length > 64 ? `${body.slice(0, 64).trim()}…` : body;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 }}>
      <Avatar name={name} size={26} tint />
      <Text style={{ flex: 1, fontSize: 13, color: colors.textSecondary, lineHeight: 18 }} numberOfLines={1}>
        <Text style={{ color: colors.text, fontWeight: "700" }}>{name}: </Text>"{snippet}"
      </Text>
      {unread && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />}
    </View>
  );
}

/** flat white container for grouped rows (e.g. past/solved history), dividers drawn by the caller */
export function GroupedCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: colors.card, borderRadius: radii.lg, paddingHorizontal: 14 }, style]}>{children}</View>;
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}

/** compact "past" row inside a GroupedCard — checkmark + title/subtitle + chevron */
export function PastRow({ title, subtitle, onPress }: { title: string; subtitle: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, opacity: pressed ? 0.6 : 1 })}
    >
      <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.mint, alignItems: "center", justifyContent: "center" }}>
        <SymbolView name={{ ios: "checkmark", android: "check" }} size={13} weight="bold" tintColor={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{title}</Text>
        <Text style={{ fontSize: 13, color: colors.textSecondary, marginTop: 1 }}>{subtitle}</Text>
      </View>
      <SymbolView name={{ ios: "chevron.right", android: "chevron_right" }} size={13} tintColor={colors.textFaint} />
    </Pressable>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  const map: Record<string, { label: string; bg: string; fg: string }> = {
    draft: { label: "NEW DRAFT", bg: colors.mint, fg: colors.primary },
    update: { label: "UPDATE", bg: colors.mint, fg: colors.primary },
    merge: { label: "MERGE", bg: colors.chip, fg: colors.textSecondary },
    stale: { label: "STALE DOC", bg: colors.amberSoft, fg: colors.amber },
  };
  const m = map[kind] ?? { label: kind.toUpperCase(), bg: colors.chip, fg: colors.textSecondary };
  return (
    <View style={{ backgroundColor: m.bg, borderRadius: 6, paddingVertical: 2, paddingHorizontal: 8, alignSelf: "flex-start" }}>
      <Text style={{ color: m.fg, fontSize: 11, fontWeight: "700", letterSpacing: 0.4 }}>{m.label}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */
export function Input(props: TextInputProps & { style?: StyleProp<ViewStyle> }) {
  return (
    <TextInput
      placeholderTextColor={colors.textFaint}
      {...props}
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          paddingVertical: 13,
          paddingHorizontal: 16,
          fontSize: 15,
          color: colors.text,
        },
        props.style as object,
      ]}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */
export function SectionLabel({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <Text style={{ fontSize: 11, fontWeight: "600", letterSpacing: 1, color: color ?? colors.textSecondary, textTransform: "uppercase" }}>
      {children}
    </Text>
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <Text style={{ fontSize: 28, fontWeight: "800", color: colors.text, letterSpacing: -0.5 }}>{children}</Text>;
}

export function Avatar({ name, size = 36, tint }: { name?: string | null; size?: number; tint?: boolean }) {
  const initials = (name ?? "?")
    .trim()
    .split(/\s+/)
    .map((p, i, a) => (i === 0 || i === a.length - 1 ? (p[0] ?? "") : ""))
    .join("")
    .toUpperCase();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tint ? colors.mintStrong : colors.chip,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: size * 0.36, fontWeight: "600", color: tint ? colors.primary : colors.textSecondary }}>{initials}</Text>
    </View>
  );
}

export function Spinner({ pad = 48 }: { pad?: number }) {
  return (
    <View style={{ paddingVertical: pad, alignItems: "center" }}>
      <ActivityIndicator size="small" color={colors.primary} />
    </View>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={{ alignItems: "center", paddingVertical: 56, gap: 8 }}>
      <Logo size={34} stroke={4} />
      <Text style={{ fontWeight: "600", fontSize: 15, color: colors.text, marginTop: 6 }}>{title}</Text>
      {hint ? (
        <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign: "center", maxWidth: 280 }}>{hint}</Text>
      ) : null}
    </View>
  );
}

/**
 * Standard "content appeared/disappeared in place" transition. Call right
 * before the state change that adds/removes views so the next layout pass
 * cross-fades instead of snapping.
 */
export function animateLayout(duration = 220): void {
  LayoutAnimation.configureNext(LayoutAnimation.create(duration, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
}

/** Fades + slides its children up into place on mount — for results appearing (found-workspace card, etc.). */
export function Reveal({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [anim]);
  return (
    <Animated.View
      style={[
        { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.dangerSoft, borderRadius: radii.md, padding: 12 }}>
      <Text style={{ color: colors.danger, fontSize: 13, fontWeight: "500" }}>{children}</Text>
    </View>
  );
}

/** segmented pill control */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <GlassSurface
      fallbackColor={colors.chip}
      style={{ flexDirection: "row", borderRadius: radii.pill, padding: 4, gap: 4, alignSelf: "flex-start" }}
    >
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => {
            if (o.value !== value) haptics.select();
            onChange(o.value);
          }}
          style={{
            backgroundColor: o.value === value ? colors.card : "transparent",
            borderRadius: radii.pill,
            paddingVertical: 6,
            paddingHorizontal: 14,
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: o.value === value ? colors.text : colors.textSecondary }}>{o.label}</Text>
        </Pressable>
      ))}
    </GlassSurface>
  );
}

/**
 * Documentation-pipeline glyph: a softly pulsing sparkle while the AI is
 * writing, a settled SF Symbol once it decided. Shared by the AI activity
 * feed and the thread status line.
 */
export function AiGlyph({ state, size = 15 }: { state: DocState; size?: number }) {
  if (state === "working") return <PulsingSparkle size={size} />;
  const map = {
    waiting_confirmation: { ios: "hourglass", android: "hourglass_empty", tint: colors.textSecondary },
    drafted: { ios: "doc.badge.plus", android: "note_add", tint: colors.primary },
    already_documented: { ios: "checkmark.circle.fill", android: "check_circle", tint: colors.primary },
    covered_by_draft: { ios: "doc.on.doc", android: "file_copy", tint: colors.textSecondary },
    skipped: { ios: "minus.circle", android: "do_not_disturb_on", tint: colors.textFaint },
    failed: { ios: "exclamationmark.circle.fill", android: "error", tint: colors.amber },
  } as const;
  const m = map[state];
  return <SymbolView name={{ ios: m.ios, android: m.android }} size={size} tintColor={m.tint} />;
}

function PulsingSparkle({ size }: { size: number }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 750, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.Text style={{ opacity, fontSize: size, color: colors.primary }}>✦</Animated.Text>;
}

export function CountBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <View
      style={{
        backgroundColor: colors.primary,
        borderRadius: 9,
        minWidth: 18,
        height: 18,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 4,
      }}
    >
      <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{n > 99 ? "99+" : n}</Text>
    </View>
  );
}

export const screen = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  pad: { paddingHorizontal: 16 },
});
