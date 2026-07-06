import type { ComponentType, ReactNode } from "react";
import { View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";

/**
 * Apple Liquid Glass (iOS 26+) with a flat fallback.
 *
 * The require is guarded so the JS bundle keeps working on a dev client that
 * was built before expo-glass-effect was added; isLiquidGlassAvailable() is
 * false on Android and older iOS, where the fallback color is used instead.
 */
type GlassViewType = ComponentType<ViewProps & { glassEffectStyle?: string; tintColor?: string; isInteractive?: boolean }>;

let NativeGlassView: GlassViewType | null = null;
export let liquidGlass = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("expo-glass-effect") as typeof import("expo-glass-effect");
  liquidGlass = mod.isLiquidGlassAvailable();
  NativeGlassView = mod.GlassView as GlassViewType;
} catch {
  /* native module not in this binary yet — flat fallback */
}

/**
 * A glass pill/panel. Keep backgroundColor out of `style` — it would paint
 * over the effect; `tintColor` doubles as the fallback background when set.
 */
export function GlassSurface({
  children,
  style,
  fallbackColor,
  tintColor,
  interactive,
  ...rest
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** flat background when Liquid Glass isn't available */
  fallbackColor: string;
  tintColor?: string;
  interactive?: boolean;
} & Omit<ViewProps, "style">) {
  if (liquidGlass && NativeGlassView) {
    return (
      <NativeGlassView glassEffectStyle="regular" isInteractive={interactive} tintColor={tintColor} style={style} {...rest}>
        {children}
      </NativeGlassView>
    );
  }
  return (
    <View style={[{ backgroundColor: tintColor ?? fallbackColor }, style]} {...rest}>
      {children}
    </View>
  );
}
