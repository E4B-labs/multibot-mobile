// Self-check dla awaryjnego powiadomienia „push nie działa". Czysta logika
// treści siedzi w `push-notice.ts` (bez React Native), więc chodzi pod gołym
// Node. Okablowanie w `push.ts` i `App.tsx` sprawdzamy na źródle — wzór z
// `onboarding-flow.test.ts`, bo testy tu chodzą bez jsdom.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { pushUnavailableNotice } from "./push-notice.ts";

const release = { version: "0.3.9", versionCode: 22, apkUrl: "https://expo.dev/artifacts/eas/x.apk" };

test("nowszy APK w manifeście daje powiadomienie, w które da się stuknąć", () => {
  const notice = pushUnavailableNotice(release, 20);
  assert.equal(notice.body, "Zainstaluj nową wersję MultiBot (0.3.9), żeby działały powiadomienia");
  assert.deepEqual(notice.data, { action: "install-apk" });
});

test("bez nowszego APK zostaje komunikat diagnostyczny, bez akcji", () => {
  // Telefon już na najnowszym buildzie — „zainstaluj nowszą" byłoby kłamstwem.
  assert.deepEqual(pushUnavailableNotice(release, 22), {
    title: "MultiBot",
    body: "MultiBot — push niedostępny: brak FCM",
  });
  assert.deepEqual(pushUnavailableNotice(release, 23), {
    title: "MultiBot",
    body: "MultiBot — push niedostępny: brak FCM",
  });
  // Manifest nieosiągalny — awarię wciąż meldujemy.
  assert.equal(pushUnavailableNotice(null, 20).body, "MultiBot — push niedostępny: brak FCM");
  assert.equal(pushUnavailableNotice(null, 20).data, undefined);
});

test("ostrzeżenie idzie raz na instalację, nie raz na uruchomienie", () => {
  const push = readFileSync("src/lib/push.ts", "utf8");
  // Numer buildu w trwałym magazynie: `let` w module ginął przy restarcie.
  assert.match(push, /NOTIFIED_BUILD_KEY = "mb_push_unavailable_build"/);
  assert.match(push, /SecureStore\.getItemAsync\(NOTIFIED_BUILD_KEY\)\.catch\(\(\) => null\)\) === build\) return;/);
  assert.match(push, /SecureStore\.setItemAsync\(NOTIFIED_BUILD_KEY, build\)/);
  assert.match(push, /content: pushUnavailableNotice\(release, currentBuildVersion\(\)\)/);
});

test("stuknięcie w powiadomienie odpala instalację APK", () => {
  const app = readFileSync("App.tsx", "utf8");
  assert.match(app, /if \(!remote && data\?\.action === "install-apk"\)/);
  assert.match(app, /void installLatestRelease\(\)/);
  // `data` w pushu pisze serwer — zdalne powiadomienie nie odpala instalatora.
  assert.match(app, /const remote = \(notification\.request\.trigger as \{ type\?: string \} \| null\)\?\.type === "push";/);
  // Zimny start (aplikacja ubita) idzie tą samą ścieżką co listener.
  assert.match(app, /getLastNotificationResponseAsync\(\)\.then\(\(last\) => \{\s*if \(last\) handleResponse\(last\.notification\);/);
});
