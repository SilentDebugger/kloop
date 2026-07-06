import { Platform } from "react-native";
import { api } from "./api";

/** Device push token from the last successful registration — needed for delete-on-logout. */
let currentToken: string | null = null;

/**
 * Push registration (Expo push service). Fails silently in Expo Go or
 * when the user declines — pushes are a progressive enhancement.
 */
export async function registerPush(): Promise<void> {
  try {
    const Notifications = await import("expo-notifications");
    // show pushes as banners while the app is foregrounded too
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return;
    const token = await Notifications.getExpoPushTokenAsync();
    currentToken = token.data;
    await api.registerPushToken(token.data, "expo");
  } catch {
    // Expo Go without projectId, simulator, or declined permission — fine.
  }
}

/** Call while still authenticated (before clearing the session) so sign-out stops pushes to this device. */
export async function unregisterPush(): Promise<void> {
  try {
    if (!currentToken) {
      const Notifications = await import("expo-notifications");
      currentToken = (await Notifications.getExpoPushTokenAsync()).data;
    }
    if (currentToken) await api.deletePushToken(currentToken);
    currentToken = null;
  } catch {
    // never block sign-out on push cleanup
  }
}
