import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useQuery } from "@tanstack/react-query";
import { colors } from "@kloop/shared";
import { api } from "../../src/api";

const { Trigger } = NativeTabs;

/**
 * Native bottom tabs: UITabBar on iOS (Liquid Glass with minimize-on-scroll
 * on iOS 26+, classic tab bar below) and Material bottom navigation on Android.
 */
export default function RequesterTabs() {
  // same key as the My requests screen — SSE invalidation keeps both live
  const { data } = useQuery({ queryKey: ["requests", "mine"], queryFn: () => api.requests() });
  const unread = (data?.requests ?? []).filter((r) => r.unreadForRequester).length;

  return (
    <NativeTabs tintColor={colors.primary} minimizeBehavior="onScrollDown" badgeBackgroundColor={colors.primary}>
      <Trigger name="index" contentStyle={{ backgroundColor: colors.background }}>
        <Trigger.Icon sf={{ default: "questionmark.bubble", selected: "questionmark.bubble.fill" }} md="contact_support" />
        <Trigger.Label>Get help</Trigger.Label>
      </Trigger>
      <Trigger name="requests" contentStyle={{ backgroundColor: colors.background }}>
        <Trigger.Icon sf={{ default: "tray", selected: "tray.fill" }} md="inbox" />
        <Trigger.Label>My requests</Trigger.Label>
        <Trigger.Badge hidden={unread === 0}>{unread > 0 ? String(unread) : undefined}</Trigger.Badge>
      </Trigger>
      <Trigger name="settings" contentStyle={{ backgroundColor: colors.background }}>
        <Trigger.Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} md="settings" />
        <Trigger.Label>Settings</Trigger.Label>
      </Trigger>
    </NativeTabs>
  );
}
