// expo-notifications wiring for the MultiBot mobile shell.
//
// Kontrakt z hostem:
//   - urządzenie rejestruje swój token Expo przez `POST /api/devices/:id/push`
//     (zapis: `server/push.ts` → `registerPushDevice`);
//   - host wysyła push przez exp.host w momencie, gdy bot zapala
//     `needsAttention` (`server/index.ts` → `notifyPushDevices`);
//   - `data` w ładunku bywa puste, bo serwer wysyła dziś tylko `{ to, title,
//     body }` — wtedy stuknięcie w powiadomienie otwiera zapisanego hosta.
//
// Od 0.4.0 rejestracji NIE robi już powłoka: nie ma tokenu hosta, bo sesję
// trzyma strona (identity v2, cookie w originie serwera). Powłoka daje więc
// tylko token Expo — mostem `push.request` / `push.token` w `WebViewScreen` —
// a `POST /api/devices/:id/push` woła interfejs webowy swoją sesją.
//
// Bez tego kroku lista urządzeń hosta zostaje pusta i `notifyPushDevices`
// wychodzi natychmiast. To tutaj przestaje działać cały łańcuch.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";

import { currentBuildVersion, fetchMobileRelease } from "./mobile-release";
import { pushUnavailableNotice } from "./push-notice";
import { shouldPresentNotification } from "./notification-policy";

// Bot otwarty na ekranie w tej chwili. Powiadomienie o NIM byłoby szumem —
// użytkownik i tak patrzy na tę rozmowę. Ustawiane z powłoki (WebView melduje
// wybór bota przez `postMessage`).
let visibleBotId: string | null = null;
export function setVisibleBot(botId: string | null): void {
  visibleBotId = botId;
}

// Kanał zakłada się RAZ, a każdy, kto potrzebuje go mieć gotowym, czeka na tę
// samą obietnicę. `configurePushNotifications` i rejestracja tokenu siedzą w
// OSOBNYCH efektach `App.tsx`, więc bez wspólnej bariery kolejność zależy od
// tego, który efekt zdąży pierwszy.
//
// Uwaga na rozpowszechnioną wersję tego uzasadnienia: „na Androidzie 13+ okno
// zgody nie pojawi się bez kanału" dotyczy aplikacji celujących w API ≤ 32.
// Expo SDK 54 celuje w 35/36, gdzie `requestPermissionsAsync` pokazuje okno
// samo z siebie. Bariera zostaje po to, żeby kanał istniał ZANIM przyjdzie
// pierwsze powiadomienie — inaczej trafia w kanał zapasowy z cudzymi
// ustawieniami dźwięku i wagi.
let channelReady: Promise<void> | null = null;

// Android bierze dźwięk i wagę wyłącznie z kanału, a nie z ładunku pushu.
// Bez kanału `default` (tak nazywa go Expo, gdy serwer nie poda `channelId`)
// powiadomienia wchodzą ciche i bez wyskakującego banera.
function ensureNotificationChannel(): Promise<void> | null {
  if (Platform.OS !== "android") return null;
  channelReady ??= Notifications.setNotificationChannelAsync("default", {
    name: "MultiBot",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    // Nieudane założenie kanału nie może wywrócić rejestracji: bez kanału
    // powiadomienia będą ciche, ale token wciąż warto zdobyć.
  }).then(
    () => undefined,
    (e: unknown) => {
      console.warn("push: nie udało się założyć kanału powiadomień", e);
    },
  );
  return channelReady;
}

// Without this, foreground/background notifications arrive but never render an
// alert, so the user would get a silent push they can't act on.
export function configurePushNotifications(): void {
  Notifications.setNotificationHandler({
    // `handleNotification` odpala się WYŁĄCZNIE gdy aplikacja jest na
    // pierwszym planie — więc wystarczy porównać bota z tym na ekranie.
    handleNotification: async (notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      const remote = (notification.request.trigger as { type?: string } | null)?.type === "push";
      const present = shouldPresentNotification(data, visibleBotId, remote);
      return {
        shouldShowAlert: present,
        shouldShowBanner: present,
        shouldShowList: present,
        shouldPlaySound: present,
        shouldSetBadge: false,
      };
    },
  });
  void ensureNotificationChannel();
}

// Awaria tokenu Expo jest z zewnątrz nieodróżnialna od ciszy: aplikacja działa
// dalej, tylko powiadomienia nigdy nie przychodzą. Pokazujemy lokalne
// powiadomienie, żeby brak konfiguracji FCM był widoczny.
//
// RAZ NA INSTALACJĘ, nie raz na uruchomienie: stary wariant (`let` w module)
// resetował się przy każdym starcie aplikacji, więc telefon na starym APK
// dostawał to samo powiadomienie codziennie. Zapamiętany jest NUMER BUILDU,
// który już ostrzegał — po instalacji nowego APK, gdyby push wciąż nie wstawał,
// ostrzeżenie przyjdzie jeszcze raz (i tylko raz).
const NOTIFIED_BUILD_KEY = "mb_push_unavailable_build";
let pushFailureNotified = false;
async function notifyPushUnavailable(): Promise<void> {
  if (pushFailureNotified) return;
  pushFailureNotified = true;
  try {
    const build = String(currentBuildVersion());
    // Sam ODCZYT łapiemy osobno: keystore po przywróceniu kopii zapasowej
    // potrafi rzucić przy deszyfrowaniu, a to nie może uciszyć ostrzeżenia.
    if ((await SecureStore.getItemAsync(NOTIFIED_BUILD_KEY).catch(() => null)) === build) return;
    // Manifest mówi, czy jest co instalować. Nieosiągalny manifest to nie
    // powód, żeby zmilczeć awarię — wtedy leci sam komunikat diagnostyczny.
    const release = await fetchMobileRelease().catch(() => null);
    await Notifications.scheduleNotificationAsync({
      content: pushUnavailableNotice(release, currentBuildVersion()),
      trigger: null,
    });
    await SecureStore.setItemAsync(NOTIFIED_BUILD_KEY, build).catch(() => undefined);
  } catch {
    // Brak kanału, odmowa uprawnień, SecureStore bez dostępu — powiadomienie
    // diagnostyczne nie może wywrócić rejestracji tokenu.
  }
}

// Asks the OS for permission and returns the Expo push token, or null when the
// user declines or the platform refuses. Call once at first launch.
export async function requestPushPermission(): Promise<string | null> {
  try {
    // Wołamy przez `ensureNotificationChannel`, a nie przez samo
    // `await channelReady`: rejestracja potrafi ruszyć zanim
    // `configurePushNotifications` zdąży się wykonać, a wtedy `channelReady`
    // jest jeszcze `null` i czekanie na nie przepuszcza wszystko dalej.
    await ensureNotificationChannel();
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") return null;
    const { data } = await Notifications.getExpoPushTokenAsync();
    return data;
  } catch (e) {
    // Cichy `return null` sprawiał, że awaria tokenu wyglądała identycznie jak
    // odmowa uprawnień — push nie działał i nie zostawiał po sobie śladu.
    console.warn("push: nie udało się pobrać tokenu Expo", e);
    void notifyPushUnavailable();
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
