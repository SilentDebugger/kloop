import { Tabs } from "expo-router";
import { Text } from "react-native";
import { colors } from "@kloop/shared";

const tabBarStyle = {
  position: "absolute" as const,
  marginHorizontal: 14,
  marginBottom: 10,
  borderRadius: 999,
  backgroundColor: colors.card,
  borderTopWidth: 0,
  height: 62,
  paddingTop: 6,
  shadowColor: "#1D1B16",
  shadowOpacity: 0.12,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 4 },
  elevation: 8,
};

function label(text: string) {
  return ({ focused }: { focused: boolean }) => (
    <Text style={{ fontSize: 13, fontWeight: "600", color: focused ? colors.primary : colors.textSecondary }}>{text}</Text>
  );
}

export default function RequesterTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle,
        tabBarShowLabel: true,
        tabBarIconStyle: { display: "none" },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ tabBarLabel: label("Get help") }} />
      <Tabs.Screen name="requests" options={{ tabBarLabel: label("My requests") }} />
      <Tabs.Screen name="settings" options={{ tabBarLabel: label("Settings") }} />
    </Tabs>
  );
}
