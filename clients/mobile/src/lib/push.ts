// expo-notifications wiring for the MultiBot mobile shell.
//
// What lives here is strictly client-side. The server-side push backend
// (PLAN-CLIENTS.md C4 / PLAN-MOBILE-KOLEGA.md B3) is still missing in
// server/ today — `POST /api/devices/:id/push` does not exist and the
// harness does not yet POST to Expo's push API when a bot enters
// `needsAttention`. Do NOT invent that backend here.
//
// Contract the shell can already honour (once the server ships it):
//   - the Expo push payload's `data` carries `{ botId, hostUrl }`;
//   - tapping the notification opens that host's WebView scrolled to the bot.
import * as Notifications from "expo-notifications";

// Without this, foreground/background notifications arrive but never render an
// alert, so the user would get a silent push they can't act on.
export function configurePushNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// Asks the OS for permission and returns the Expo push token, or null when the
// user declines or the platform refuses. Call once at first launch.
export async function requestPushPermission(): Promise<string | null> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return null;
    const { data } = await Notifications.getExpoPushTokenAsync();
    return data;
  } catch {
    return null;
  }
}

export interface NotificationBotTarget {
  botId?: string;
  hostUrl?: string;
}

// Reads the `{ botId, hostUrl }` the shell needs out of a push payload's data.
// Both fields are optional: a payload without them just opens the host list.
export function extractBotTarget(
  data: Record<string, unknown> | undefined,
): NotificationBotTarget {
  if (!data) return {};
  const botId = typeof data.botId === "string" ? data.botId : undefined;
  const hostUrl = typeof data.hostUrl === "string" ? data.hostUrl : undefined;
  return { botId, hostUrl };
}
