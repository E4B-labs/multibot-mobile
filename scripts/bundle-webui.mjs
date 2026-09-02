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
// ponytail: plik wychodzi duży (rzędu 11 MB), bo `shiki` wnosi komplet gramatyk
// kolorowania składni. Każda zmiana interfejsu to nowy taki plik w historii
// gita i cięższy start aplikacji. Gdy zacznie boleć: przytnij `shiki` do kilku
// języków w webui/, tutaj nic się nie zmieni.

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
