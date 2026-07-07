import { View } from "react-native";
import { colors } from "@kloop/shared";

/**
 * Root route ("/"). Cold starts (including notification taps) land here;
 * without this file expo-router shows its "Unmatched Route" screen whenever
 * the AuthGate redirect loses the race against route resolution. AuthGate
 * replaces this with the role-appropriate home as soon as the store hydrates.
 */
export default function Index() {
  return <View style={{ flex: 1, backgroundColor: colors.background }} />;
}
