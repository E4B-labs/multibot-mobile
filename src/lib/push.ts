// expo-notifications wiring for the MultiBot mobile shell.
//
// Kontrakt z hostem jest już domknięty po obu stronach (repo `multibot`):
//   - telefon rejestruje swój token Expo przez `POST /api/devices/:id/push`
//     z nagłówkiem `Authorization: Bearer <token hosta>` i ciałem `{ token }`
//     (trasa: `server/index.ts`, zapis: `server/push.ts` → `registerPushDevice`);
//   - host wysyła push przez exp.host w momencie, gdy bot zapala
//     `needsAttention` (`server/index.ts` → `notifyPushDevices`);
//   - `data` w ładunku bywa puste, bo serwer wysyła dziś tylko `{ to, title,
//     body }` — wtedy stuknięcie w powiadomienie otwiera zapisanego hosta.
//
// Bez kroku rejestracji serwer nie ma dokąd wysłać powiadomienia: lista
// urządzeń w jego configu (`pushDevices`) zostaje pusta i `notifyPushDevices`
// wychodzi natychmiast. To tutaj przestaje działać cały łańcuch.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

import { hostAuthHeaders, type Host } from "./host-logic";
import { getHostToken } from "./hosts";

// Bot otwarty na ekranie w tej chwili. Powiadomienie o NIM byłoby szumem —
// użytkownik i tak patrzy na tę rozmowę. Ustawiane z powłoki (WebView melduje
// wybór bota przez `postMessage`).
let visibleBotId: string | null = null;
export function setVisibleBot(botId: string | null): void {
  visibleBotId = botId;
}

// Without this, foreground/background notifications arrive but never render an
// alert, so the user would get a silent push they can't act on.
export function configurePushNotifications(): void {
  Notifications.setNotificationHandler({
    // `handleNotification` odpala się WYŁĄCZNIE gdy aplikacja jest na
    // pierwszym planie — więc wystarczy porównać bota z tym na ekranie.
    handleNotification: async (notification) => {
      const { botId } = extractBotTarget(notification.request.content.data as Record<string, unknown> | undefined);
      const onScreen = Boolean(botId) && botId === visibleBotId;
      return {
        shouldShowAlert: !onScreen,
        shouldShowBanner: !onScreen,
        shouldShowList: !onScreen,
        shouldPlaySound: !onScreen,
        shouldSetBadge: false,
      };
    },
  });
  // Android bierze dźwięk i wagę wyłącznie z kanału, a nie z ładunku pushu.
  // Bez kanału `default` (tak nazywa go Expo, gdy serwer nie poda `channelId`)
  // powiadomienia wchodzą ciche i bez wyskakującego banera.
  if (Platform.OS === "android") {
    void Notifications.setNotificationChannelAsync("default", {
      name: "MultiBot",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 250, 250],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
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

// Ile czekamy na hosta przy rejestracji. Bez limitu żądanie do hosta spoza
// tailnetu wisi w nieskończoność, a razem z nim wpis w `inflight` — kolejne
// wejście do aplikacji nie miałoby wtedy jak ponowić próby.
const REGISTER_TIMEOUT_MS = 10_000;

// Hosty, które PRZYJĘŁY już ten konkretny token; klucz to id hosta, wartość to
// token. Pamięć jest ulotna z rozmysłem: po restarcie aplikacji rejestrujemy
// ponownie, bo token Expo potrafi się zmienić, a zapis po stronie hosta jest
// idempotentny (nadpisuje wpis o tym samym id urządzenia).
const confirmed = new Map<string, string>();

// Próby w locie, po jednej na hosta — powrót do aplikacji w trakcie żądania
// nie może odpalać drugiego równoległego POST-a.
const inflight = new Map<string, Promise<boolean>>();

/**
 * Dopilnowuje, żeby host znał token push tego telefonu. Zwraca `true`, gdy host
 * potwierdził rejestrację. Wołać przy starcie i przy każdym powrocie aplikacji
 * na wierzch: pierwsza próba pada, kiedy telefon jest chwilowo poza siecią
 * hosta, a bez ponowienia powiadomienia nie przyszłyby już nigdy.
 */
export async function ensurePushRegistered(host: Host): Promise<boolean> {
  const running = inflight.get(host.id);
  if (running) return running;
  const attempt = registerOnHost(host).finally(() => inflight.delete(host.id));
  inflight.set(host.id, attempt);
  return attempt;
}

async function registerOnHost(host: Host): Promise<boolean> {
  const expoToken = await requestPushPermission();
  if (!expoToken) return false;
  if (confirmed.get(host.id) === expoToken) return true;

  const hostToken = await getHostToken(host.id);
  // Wpis hosta bez tokenu (usunięty ręcznie z SecureStore) — trasa i tak
  // odpowiedziałaby 401, więc nie ma po co wysyłać żądania.
  if (!hostToken) return false;

  // `AbortSignal.timeout` nie istnieje w polyfillu React Native, więc limit
  // czasu budujemy z kontrolera i `setTimeout`.
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REGISTER_TIMEOUT_MS) : null;
  try {
    const res = await fetch(`${host.url}/api/devices/${encodeURIComponent(host.id)}/push`, {
      method: "POST",
      headers: { "content-type": "application/json", ...hostAuthHeaders(hostToken) },
      // Świadomie bez `botId`: serwer filtruje urządzenia po bocie, a wpis bez
      // bota dostaje powiadomienia od wszystkich botów tego hosta.
      body: JSON.stringify({ token: expoToken }),
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res.ok) return false;
    confirmed.set(host.id, expoToken);
    return true;
  } catch {
    // Host nieosiągalny albo starsza wersja serwera bez tej trasy. Nie
    // zapisujemy potwierdzenia, więc następne wejście w aplikację spróbuje
    // jeszcze raz — i wtedy zwykle się udaje.
    return false;
  } finally {
    if (timer) clearTimeout(timer);
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
