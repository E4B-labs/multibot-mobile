// Pakuje zbudowany interfejs (webui/dist/index.html) do modułu TypeScriptu,
// który Metro wciąga do paczki aplikacji.
//
// Po co w ogóle: WebView musi dostać interfejs jako STRING razem z `baseUrl`
// wskazującym na hosta. Tylko wtedy wywołania `fetch("/api/...")` w środku
// interfejsu trafiają do serwera MultiBota. Wczytanie tego samego pliku
// z dysku telefonu (`file://`) daje dokument bez origin, więc każde wywołanie
// API leci w próżnię — dlatego nie da się tego zrobić „prościej", przez plik.
//
// Efekt uboczny, świadomy: interfejs jedzie w paczce, więc `eas update`
// dostarcza zmiany w nim bez wgrywania czegokolwiek na serwer.
//
// UWAGA NA ROZMIAR — patrz LIMIT_MB niżej. `baseUrl` znaczy
// `loadDataWithBaseURL`, a Chromium koduje podany string do base64 w JEDNEJ
// tablicy bajtów (×4/3), po czym robi z niej Stringa (×2 na UTF-16). Przy
// 11,7 MB interfejsu to jest ~48 MB przejściowo i APK 29 wywracał się na
// starcie na każdym telefonie:
//   OutOfMemoryError: Failed to allocate a 15771976 byte allocation
//     at android.util.Base64.encodeToString
//     at WebViewChromium.loadDataWithBaseURL
// Winowajcą był pełny pakiet `shiki` (~9,7 MB gramatyk i motywów, wklejony tu
// przez viteSingleFile). Od tego czasu webui/src/lib/highlighter.ts ładuje
// kilkanaście języków zamiast dwustu.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "webui", "dist", "index.html");
const target = join(root, "src", "webui-html.ts");

let html;
try {
  html = readFileSync(source, "utf8");
} catch {
  console.error(`Brak ${source}. Najpierw: cd webui && npm install && npm run build`);
  process.exit(1);
}

// Keep the generated module identical on Windows and POSIX runners.
html = html.replace(/\r\n?/g, "\n");

// Ikona i manifest PWA zostają w wyjściu jako osobne pliki, bo `viteSingleFile`
// wkleja do środka tylko kod i style. W WebView nie robią nic (nie ma paska
// adresu ani ekranu instalacji), a wskazują na pliki, których w paczce nie ma —
// więc wylatują, zamiast produkować dwa błędy 404 przy każdym starcie.
html = html.replace(/\s*<link[^>]*rel="(?:icon|manifest)"[^>]*>/g, "");

// Pojedynczy plik znaczy: zero odwołań do sąsiednich plików, bo w paczce nie ma
// katalogu, z którego można by je pobrać. Wyjście z `viteSingleFile` powinno
// mieć wszystko w środku — sprawdzamy to, zamiast ufać wtyczce.
const external = [...html.matchAll(/<(?:script|link)[^>]*?(?:src|href)="(?!data:|https?:|#)([^"]+)"/g)];
if (external.length > 0) {
  console.error("Build nie jest samodzielny, odwołuje się do:", external.map((m) => m[1]).join(", "));
  console.error("Sprawdź, czy viteSingleFile jest w webui/vite.config.ts.");
  process.exit(1);
}

// Hamulec, nie próg awarii: 6 MB to wciąż ~8 MB base64 i ~16 MB Stringa, więc
// mieści się w domyślnej stercie z zapasem, a jednocześnie łapie każdy powrót
// do „wklejmy tu jeszcze jeden komplet gramatyk". Build ma paść tutaj, a nie
// dopiero na telefonie Kacpra.
const LIMIT_MB = 6;
if (html.length > LIMIT_MB * 1024 * 1024) {
  console.error(
    `Interfejs ma ${(html.length / 1024 / 1024).toFixed(1)} MB, limit to ${LIMIT_MB} MB. ` +
      "WebView na Androidzie koduje go do base64 przy starcie i pada na OutOfMemoryError. " +
      "Zobacz, co urosło (najczęściej gramatyki shiki w webui/src/lib/highlighter.ts).",
  );
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
writeFileSync(
  target,
  "// PLIK GENEROWANY — nie edytuj ręcznie.\n" +
    "// Powstaje z `node scripts/bundle-webui.mjs` po zbudowaniu webui/.\n" +
    `export const WEBUI_HTML = ${JSON.stringify(html)};\n`,
  "utf8",
);

const mb = (html.length / 1024 / 1024).toFixed(1);
console.log(`OK: src/webui-html.ts, ${mb} MB`);
