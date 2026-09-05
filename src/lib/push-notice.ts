// Treść lokalnego powiadomienia „push nie działa". Osobny, czysty moduł, bo
// `push.ts` i `mobile-release.ts` ciągną React Native i modułów Expo — a ta
// decyzja (co napisać i czy da się z tym cokolwiek zrobić) jest jedyną
// częścią wartą testu.
import type { MobileRelease } from "./mobile-release";

export type PushUnavailableNotice = {
  title: string;
  body: string;
  data?: { action: "install-apk" };
};

/**
 * Buduje treść powiadomienia o braku tokenu push.
 *
 * Stara wersja mówiła zawsze „push niedostępny: brak FCM" — prawda, ale
 * użytkownik nie ma z tym co zrobić. Gdy w manifeście stoi nowszy APK (czyli
 * telefon siedzi na starym buildzie bez `google-services.json`, a JS przyszedł
 * z `eas update`), powiadomienie mówi wprost, co zainstalować, i niesie
 * `action: "install-apk"` — stuknięcie odpala pobranie APK.
 *
 * Gdy nowszego APK nie ma (albo manifest nie odpowiedział), zostaje stary
 * komunikat diagnostyczny: „zainstaluj nowszą wersję" byłoby wtedy kłamstwem.
 */
export function pushUnavailableNotice(
  release: MobileRelease | null,
  currentBuild: number,
): PushUnavailableNotice {
  if (release && release.versionCode > currentBuild) {
    return {
      title: "MultiBot",
      body: `Zainstaluj nową wersję MultiBot (${release.version}), żeby działały powiadomienia`,
      data: { action: "install-apk" },
    };
  }
  return { title: "MultiBot", body: "MultiBot — push niedostępny: brak FCM" };
}
