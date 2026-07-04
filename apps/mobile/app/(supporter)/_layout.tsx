import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@kloop/shared";
import { api } from "../../src/api";

const { Trigger } = NativeTabs;

/**
 * Native bottom tabs: UITabBar on iOS (Liquid Glass with minimize-on-scroll
 * on iOS 26+, classic tab bar below) and Material bottom navigation on Android.
 * The search tab uses the system search role (separate pill on iOS 26+).
 */
export default function SupporterTabs() {
  const { data } = useQuery({
    queryKey: ["review-counts"],
    queryFn: () => api.reviewCounts(),
    refetchInterval: 60_000,
  });
  const reviewBadge = data?.counts.total ?? 0;

  return (
    <NativeTabs tintColor={colors.primary} minimizeBehavior="onScrollDown" badgeBackgroundColor={colors.primary}>
      <Trigger name="queue" contentStyle={{ backgroundColor: colors.background }}>
        <Trigger.Icon sf={{ default: "tray.2", selected: "tray.2.fill" }} md="inbox" />
        <Trigger.Label>Queue</Trigger.Label>
      </Trigger>
      <Trigger name="reviews" contentStyle={{ backgroundColor: colors.background }}>
        <Trigger.Icon sf={{ default: "checkmark.seal", selected: "checkmark.seal.fill" }} md="rate_review" />
        <Trigger.Label>Reviews</Trigger.Label>
        <Trigger.Badge hidden={reviewBadge === 0}>{reviewBadge > 0 ? String(reviewBadge) : undefined}</Trigger.Badge>
      </Trigger>
      <Trigger name="my-work" contentStyle={{ backgroundColor: colors.background }}>
        <Trigger.Icon sf={{ default: "briefcase", selected: "briefcase.fill" }} md="work" />
        <Trigger.Label>My work</Trigger.Label>
      </Trigger>
      <Trigger name="search" role="search" contentStyle={{ backgroundColor: colors.background }}>
        <Trigger.Icon sf="magnifyingglass" md="search" />
        <Trigger.Label>Search</Trigger.Label>
      </Trigger>
    </NativeTabs>
  );
}
