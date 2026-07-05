import type { ReactNode } from "react";
import {
  ActivityIndicator,
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
import { colors, radii } from "@kloop/shared";

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
  const bg =
    variant === "primary" ? colors.primary : variant === "secondary" ? colors.chip : variant === "mint" ? colors.mint : colors.card;
  const fg =
    variant === "primary" ? colors.onPrimary : variant === "danger" ? colors.danger : variant === "mint" ? colors.primary : colors.text;
  const pad = size === "sm" ? { paddingVertical: 7, paddingHorizontal: 14 } : size === "lg" ? { paddingVertical: 14, paddingHorizontal: 20 } : { paddingVertical: 11, paddingHorizontal: 18 };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radii.pill,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          ...(variant === "outline" || variant === "danger" ? { borderWidth: 1, borderColor: colors.border } : {}),
          ...pad,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={fg} /> : icon}
      <Text numberOfLines={1} style={{ color: fg, fontWeight: "600", fontSize: size === "sm" ? 13 : 15 }}>{title}</Text>
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
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        {
          backgroundColor: active ? colors.text : colors.chip,
          borderRadius: radii.pill,
          paddingVertical: 7,
          paddingHorizontal: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {icon}
      <Text style={{ color: active ? "#fff" : colors.text, fontSize: 13, fontWeight: "500" }}>{label}</Text>
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
    <View style={{ flexDirection: "row", backgroundColor: colors.chip, borderRadius: radii.pill, padding: 4, gap: 4, alignSelf: "flex-start" }}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
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
    </View>
  );
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
