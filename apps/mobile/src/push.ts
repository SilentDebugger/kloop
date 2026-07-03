import { Platform } from "react-native";
import { api } from "./api";

/**
 * Push registration (Expo push service). Fails silently in Expo Go or
 * when the user declines — pushes are a progressive enhancement.
 */
export async function registerPush(): Promise<void> {
  try {
    const Notifications = await import("expo-notifications");
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const token = await Notifications.getExpoPushTokenAsync();
    await api.registerPushToken(token.data, "expo");
  } catch {
    // Expo Go without projectId, simulator, or declined permission — fine.
  }
}
