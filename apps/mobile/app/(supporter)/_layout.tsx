import { Tabs } from "expo-router";
import { Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@kloop/shared";
import { api } from "../../src/api";
import { CountBadge } from "../../src/ui";

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

function label(text: string, badge?: number) {
  return ({ focused }: { focused: boolean }) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: focused ? colors.primary : colors.textSecondary }}>{text}</Text>
      {badge ? <CountBadge n={badge} /> : null}
    </View>
  );
}

export default function SupporterTabs() {
  const { data } = useQuery({
    queryKey: ["review-counts"],
    queryFn: () => api.reviewCounts(),
    refetchInterval: 60_000,
  });
  const reviewBadge = data?.counts.total ?? 0;

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
      <Tabs.Screen name="queue" options={{ tabBarLabel: label("Queue") }} />
      <Tabs.Screen name="reviews" options={{ tabBarLabel: label("Reviews", reviewBadge) }} />
      <Tabs.Screen name="search" options={{ tabBarLabel: label("Search") }} />
      <Tabs.Screen name="my-work" options={{ tabBarLabel: label("My work") }} />
    </Tabs>
  );
}
