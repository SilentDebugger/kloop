import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * One tiny vocabulary for the whole app, so feedback stays consistent:
 *
 *   tap      pressing a button / actionable row
 *   select   choosing among options (chips, segments, pickers, toggles)
 *   success  a mutation the user cares about went through
 *   warning  destructive-ish outcome (reject, sign out) or recording stop
 *   error    something failed
 *
 * Fire-and-forget: haptics must never block or crash the UI (simulators and
 * some Android devices have no engine, web has no API at all).
 */
const enabled = Platform.OS === "ios" || Platform.OS === "android";

function fire(fn: () => Promise<void>) {
  if (!enabled) return;
  void fn().catch(() => {});
}

export const haptics = {
  tap: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  select: () => fire(() => Haptics.selectionAsync()),
  /** slightly stronger than tap — picking up something weighty (start recording) */
  medium: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  success: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
