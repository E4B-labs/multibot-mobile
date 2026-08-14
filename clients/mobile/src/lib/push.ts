// expo-notifications wiring — STUB. This registers a device for push and
// returns the Expo push token, but there is no server-side push backend to
// hand it to yet:
//   - PLAN-CLIENTS.md C4 specifies the server should POST to Expo's push API
//     (https://exp.host/--/api/v2/push/send) when a bot enters
//     `needsAttention`, and that the token should be registered via
//     `POST /api/devices/:id/push`. Neither exists in server/ today.
// Do not invent that backend here — call this, get a token, and once the
// server route exists, send `token` to it.
import * as Notifications from "expo-notifications";

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return null;
    const { data } = await Notifications.getExpoPushTokenAsync();
    // TODO: POST { token: data } to /api/devices/:id/push once that route
    // ships server-side (PLAN-CLIENTS.md C4).
    return data;
  } catch {
    return null;
  }
}
