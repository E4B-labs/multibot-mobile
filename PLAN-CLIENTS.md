# PLAN-CLIENTS — aplikacja mobilna (Expo) i desktopowa dla Multibota

> Osobny plan do GOAL.md. Zakłada, że runda G (a przynajmniej G2 auth i G5 PWA)
> jest zamknięta: serwer hostuje pełny interfejs webowy i sprawdza token na
> każdej trasie. Ten plan dokłada klientów: telefon i komputer łączące się ze
> zdalnym hostem.

---

## 0. Prompt do wklejenia

```
/goal Wykonaj plan z PLAN-CLIENTS.md w repo G:\Projects\multibot — fazy C1..C6 po
kolei, każda z gate'em. Warunek wejścia: GOAL.md faza G2 (auth tokenem) musi być
zamknięta, bo klienci logują się tym samym tokenem. Przeczytaj CAŁY PLAN-CLIENTS.md
i CAŁY GOAL.md przed pierwszą linią kodu. Aplikacja mobilna to nowy podprojekt w
clients/mobile (Expo); NIE mieszaj jej zależności z głównym package.json. Desktop
to rozszerzenie istniejącego shella Electron, nie nowy projekt. Backend na Opusie,
frontend/mobile na Fable. Subagenty nie commitują — integrator commituje po gate'cie.
JEDŹ BEZ PRZERWY od C1 do C6; zamknięty gate = natychmiastowy start następnej fazy,
zero pytań o zgodę. Zatrzymaj się tylko przy sprzeczności planu z kodem, kasowaniu
cudzych danych albo sekrecie blokującym push. Stan trzymaj w git log (commit na gate,
prefiks numeru fazy).
```

---

## 1. Po co i co dokładnie

**Cel właściciela (dosłownie):** stawiam Multibota **raz** na jednym urządzeniu
(telefon, mini-PC, VPS), które chodzi **24/7**. Łączę się z jego botami:
1. aplikacją na **telefonie**,
2. aplikacją na **komputerze**.
Po **bezpiecznym logowaniu**. Każda funkcja ma działać zdalnie.

**Rozstrzygnięcie architektury (nie renegocjować bez sprzeczności w kodzie):**

- Serwer (harness + silnik) już serwuje kompletny interfejs webowy z jednego
  pochodzenia i sprawdza token (GOAL.md G2, G5). Klient **nie odtwarza** tego
  interfejsu — pokazuje go.
- **Mobile = Expo, cienki WebView** nad hostowanym interfejsem + natywna skorupa:
  parowanie przez QR, szyfrowany schowek na token, push „bot czeka na ciebie",
  ekran wyboru/przełączania hostów. Cały czat, panele, komputer bota — to ten sam
  interfejs webowy w środku WebView, więc każda funkcja działa bez przepisywania.
- **Desktop = istniejący shell Electron** z OpenMausBota, rozszerzony o tryb
  „połącz ze zdalnym hostem" (dziś umie tylko lokalny silnik). Zero nowego
  projektu desktopowego. Expo na desktop (react-native-windows/macos) świadomie
  odrzucone — duży koszt, ten sam efekt co Electron, który już mamy.
- **Transport:** Tailscale jako droga błogosławiona (prawdziwy HTTPS + tożsamość
  urządzenia, działa poza siecią domową, daje bezpieczny kontekst dla mikrofonu).
  LAN po HTTP jako awaryjny, z jawnie okrojonym mikrofonem.

**Dlaczego WebView, nie natywny interfejs:** natywne przepisanie czatu, paneli,
podglądu komputera bota i take-over to miesiące pracy i druga baza kodu do
utrzymania równolegle z webem. WebView daje 100% funkcji od pierwszego dnia; to,
co WebView nie daje (parowanie, schowek, push), dokłada natywna skorupa. To jest
najkrótsza poprawna droga, nie kompromis.

---

## 2. Bezpieczny login — projekt (to jest „wymyśl jak to zrobić")

GOAL.md G2 zakłada jeden wspólny token. Dla wielu urządzeń to za mało: nie da się
odłączyć zgubionego telefonu bez unieważnienia wszystkich. Ten plan **udoskonala
G2 do parowania per urządzenie**. Jeśli G2 wdrożyło już jeden token — ten plan go
zastępuje, migracja w C1.

### Model: token per urządzenie, hash na serwerze

Serwer trzyma w `config.json`:

```jsonc
"devices": [
  {
    "id": "dev_a1b2c3",
    "name": "Telefon Kacpra",
    "tokenHash": "<sha256 tokena, hex>",   // NIGDY plaintext
    "createdAt": 1699900000,
    "lastSeen": 1699999999
  }
]
```

- **Token** = 32 losowe bajty, base64url (`crypto.randomBytes(32)`). Pokazywany
  urządzeniu **raz**, nigdy więcej. Serwer trzyma tylko `sha256(token)`.
- **Sprawdzenie na każdej trasie**: klient wysyła `Authorization: Bearer <token>`;
  serwer liczy `sha256`, szuka w `devices`, dopasowanie **stałoczasowe**
  (`crypto.timingSafeEqual` na buforach hashy — porównanie stringów przecieka
  długością przez czas). Trafienie: aktualizuj `lastSeen`, przepuść. Brak: `401`.
- **Oba upgrade'y WebSocket** (przelotka silnika, kanał komputera bota) sprawdzają
  token z query albo nagłówka **przed** handshake'iem. Pominięcie WS = otwarte
  drzwi obok zamkniętych; to najczęstszy błąd.
- **Odłączenie urządzenia**: usuń wpis z `devices`, token natychmiast martwy.
  Lista sparowanych urządzeń z nazwami i „ostatnio widziane" w ustawieniach.

### Parowanie: kod jednorazowy, nie przepisywanie tokena

Właściciel nigdy nie przepisuje 43-znakowego tokena z ekranu na ekran.

1. W zalogowanej sesji webowej: „Połącz urządzenie" → `POST /api/pair/start` →
   serwer generuje **6-cyfrowy kod** ważny 5 minut (jeden na raz, w pamięci) i
   pokazuje **QR** zawierający `{ url, code }` (url = adres hosta, np. tailnet).
2. Telefon: skan QR (`expo-camera`) albo ręcznie wpisany adres + kod.
   `POST /api/pair/claim { code, deviceName }`.
3. Serwer waliduje kod (stałoczasowo, jednorazowy — po użyciu wygasa), tworzy
   token per urządzenie, zapisuje `sha256` w `devices`, zwraca token **raz**.
4. Telefon zapisuje `{ url, token, deviceId }` w `expo-secure-store` (szyfrowany
   keychain/keystore). Od teraz każde żądanie z Bearer.

Rate-limit na `/api/pair/claim` (kilka prób, potem lockout na kod) — 6 cyfr da się
zgadnąć brute-forcem bez tego.

### Transport

- **Tailscale (zalecane):** host uruchamia `tailscale serve https / http://127.0.0.1:8799`.
  Adres `https://<host>.<tailnet>.ts.net` z prawdziwym certyfikatem. QR niesie ten
  adres. Działa z dowolnej sieci, daje bezpieczny kontekst (mikrofon, service
  worker). Zero otwierania portów na routerze.
- **LAN HTTP (awaryjne):** `http://192.168.x.x:8799`. Działa w domu, ale WebView
  po zwykłym HTTP ma zawodny mikrofon i brak instalacji PWA. Aplikacja natywna
  może przyznać WebView uprawnienie do mikrofonu niezależnie od schematu, więc
  dyktowanie w apce mobilnej może działać tam, gdzie w przeglądarce nie — do
  zweryfikowania per platforma, nie obiecywać w ciemno.
- **Nigdy:** serwer wystawiony wprost na publiczny adres bez Tailscale/HTTPS.
  Silnik zostaje na `127.0.0.1` zawsze, tylko za przelotką harnessa.

---

## 3. Fazy

### C1 — Auth per urządzenie na serwerze (fundament)

Rozszerza/zastępuje G2. Backend.

- `server/auth.ts`: model `devices` w `config.json`, `sha256` + `timingSafeEqual`,
  middleware HTTP na wszystkie trasy, guard na obu WS upgrade.
- `server/pair.ts` (nowy): `POST /api/pair/start` (kod + QR data), `POST /api/pair/claim`
  (walidacja, wydanie tokena per urządzenie), rate-limit na claim.
- Trasy zarządzania: `GET /api/devices` (lista, bez tokenów), `DELETE /api/devices/:id`.
- Migracja: jeśli istnieje pojedynczy token z G2, potraktuj go jako jedno
  urządzenie „Ten komputer" i pozwól dalej działać.
- Testy: brak tokena → 401 na HTTP i na obu WS; zły token → 401; claim zużywa kod;
  drugie użycie kodu → odrzucone; odłączenie urządzenia unieważnia jego token;
  dopasowanie stałoczasowe (test istnienia, nie pomiar czasu).

**GATE C1**
- Sparowanie przez kod działa end-to-end (skrypt: start → claim → żądanie z tokenem → 200).
- Odłączone urządzenie dostaje 401.
- Pełny pytest silnika + vitest harnessa zielone; silnik nieosiągalny spoza loopbacku (test).

### C2 — Serwer serwuje interfejs i QR parowania

- Harness serwuje zbudowane `dist/` z własnego portu (jedno pochodzenie), także w
  trybie zdalnym (bez vite).
- Ekran „Połącz urządzenie" w `AppSettingsPanel`: przycisk generuje kod, rysuje QR
  (czysty SVG albo istniejący sposób — zero nowych zależności), pokazuje adres
  tailnet jeśli Tailscale wykryty (`tailscale status`).
- Lista sparowanych urządzeń z „ostatnio widziane" i przyciskiem odłączenia.

**GATE C2**
- Z przeglądarki na innym urządzeniu (przez Tailscale): wejście na adres hosta →
  ekran logowania → wklejony token → działający interfejs, w tym podgląd komputera bota.
- QR generuje się i zawiera poprawny `{url, code}`.

### C3 — Aplikacja mobilna Expo: skorupa + WebView

Nowy podprojekt `clients/mobile` (własny `package.json`, Expo SDK 54+). Fable.

- `expo` + `react-native-webview` + `expo-secure-store` + `expo-camera` (do QR).
  Zero z tych zależności nie wchodzi do głównego `package.json`.
- Ekran startowy: lista sparowanych hostów (z SecureStore) albo „Dodaj hosta".
- „Dodaj hosta": skan QR (`expo-camera`, typ `qr`) → `pair/claim` → zapis
  `{url, token, deviceId, name}` w `expo-secure-store`.
- Ekran główny: `WebView` na `url` hosta z nagłówkiem `Authorization: Bearer <token>`
  na żądaniu nawigacji (i wstrzyknięcie tokena do zapytań `/api` wewnątrz WebView —
  `injectedJavaScriptBeforeContentLoaded` ustawia go dla fetch/WS).
- Przełącznik hostów (gdy właściciel ma serwer na telefonie i drugi na VPS).
- Obsługa błędów: host nieosiągalny → czytelny ekran „offline, sprawdź Tailscale",
  nie biały WebView.

**GATE C3**
- Na fizycznym telefonie (Expo Go albo dev build): sparowanie QR z hostem,
  WebView pokazuje pełny interfejs, czat z botem działa, podgląd komputera bota
  renderuje klatki, take-over działa dotykiem.
- Token przeżywa restart aplikacji (SecureStore).

### C4 — Push „bot czeka na ciebie"

- Serwer: gdy bot wchodzi w stan `needsAttention` (istnieje z fazy F3), wyślij push
  do sparowanych urządzeń, które mają zarejestrowany token push.
- Rejestracja: mobile wysyła Expo push token w `pair/claim` albo osobną trasą
  `POST /api/devices/:id/push`.
- Wysyłka: Expo Push API (`https://exp.host/--/api/v2/push/send`) — serwer woła po
  HTTP, bez SDK.
- Tap w powiadomienie otwiera apkę na tym bocie (deep link do WebView na `#bot=<id>`).

**GATE C4**
- Bot utyka na logowaniu (needsAttention) → telefon dostaje powiadomienie →
  tap otwiera właściwego bota.
- Odłączone urządzenie nie dostaje pushy.

### C5 — Desktop: tryb zdalnego hosta w istniejącym Electronie

- `electron/main.mjs`: obok trybu „lokalny silnik" dodaj „połącz ze zdalnym hostem".
  Wybór przy starcie albo w ustawieniach: adres + token (albo kod parujący jak mobile).
- Token w keychain systemu (`safeStorage` Electrona — wbudowane, zero nowych deps).
- Okno ładuje zdalny interfejs (jak WebView na mobile, tu `BrowserWindow.loadURL`
  na adres hosta) z tokenem, zamiast startować lokalny harness.
- Tryb lokalny (dziś) zostaje domyślny; zdalny to dodatkowa opcja.

**GATE C5**
- Aplikacja desktop na drugim komputerze łączy się ze zdalnym hostem, loguje,
  pełna funkcjonalność.
- Token w keychain, przeżywa restart, da się rozłączyć.

### C6 — Pakowanie klientów i domknięcie

- Mobile: `eas build` konfiguracja (albo lokalny build APK dla Androida), ikona
  z `docs/branding/`, nazwa aplikacji. iOS tylko jeśli właściciel ma konto Apple
  Developer — inaczej odłóż, zapisz w §odłożone.
- Desktop: tryb zdalny w tym samym instalatorze co lokalny (F11 NSIS).
- Dokumentacja: `clients/README.md` — jak sparować telefon, jak połączyć desktop,
  Tailscale jako droga zalecana.
- Drill scalenia z upstreamem, testy całości zielone.

**GATE C6**
- Świeży telefon: instalacja APK, skan QR, działający bot — bez terminala.
- Świeży komputer: instalator, tryb zdalny, działający bot.

---

## 4. Krytyczne pliki i punkty

| Ścieżka | Co |
|---|---|
| `server/auth.ts` | token per urządzenie, hash, stałoczasowe porównanie, guard HTTP + WS (nowy albo z G2) |
| `server/pair.ts` | kod parujący, QR data, wydanie tokena (nowy) |
| `server/index.ts` | serwowanie `dist/`, trasy `/api/pair/*`, `/api/devices/*`, montaż middleware auth |
| `server/engine/proxy.ts` | oba WS upgrade muszą przechodzić przez guard tokena |
| `electron/main.mjs` | tryb lokalny vs zdalny, `safeStorage` na token |
| `clients/mobile/` | nowy podprojekt Expo — własny package.json, nie miesza się z głównym |
| `src/components/AppSettingsPanel.tsx` | ekran parowania, QR, lista urządzeń |
| `AppSettingsPanel` / store | wstrzyknięcie tokena do warstwy zapytań frontendu w trybie zdalnym |

---

## 5. Ryzyka

1. **WS bez auth** — najłatwiejszy do przeoczenia otwór; podgląd komputera i kanał
   zdarzeń idą upgrade'em. Test na obu ścieżkach, obowiązkowy.
2. **Token w URL** — nigdy w query stringu tras HTTP (ląduje w logach). Tylko
   nagłówek Bearer. WS query token dopuszczalny wyłącznie bo nagłówków nie ma w
   upgrade z przeglądarki — wtedy krótkożyjący token jednorazowy do upgrade, nie
   główny.
3. **Bezpieczny kontekst na LAN HTTP** — mikrofon i PWA nie działają; w apce
   natywnej WebView może to obejść uprawnieniem systemowym, ale zweryfikuj per
   platforma, nie obiecuj.
4. **Brute force kodu parującego** — 6 cyfr bez rate-limitu to sekundy łamania.
   Lockout obowiązkowy, kod jednorazowy i krótkożyjący.
5. **Expo w monorepo** — zależności React Native gryzą się z zależnościami weba,
   jeśli dzielą `node_modules`. Osobny podprojekt, osobny lockfile.
6. **iOS bez konta Apple** — build i dystrybucja iOS wymaga płatnego konta.
   Android APK działa bez tego; iOS odłóż, jeśli konta nie ma.

---

## 6. Świadomie odłożone

- Natywny interfejs (bez WebView) — miesiące pracy, druga baza kodu, ten sam efekt.
- iOS App Store, jeśli brak konta Apple Developer.
- Współdzielenie hosta między różnymi ludźmi (multi-user) — dziś jeden właściciel,
  wiele jego urządzeń.
- Offline mobile (WebView wymaga żywego hosta; PWA z G5 pokrywa część tego).
- Biometria do odblokowania apki (SecureStore już szyfruje; biometria to warstwa UX).

---

## 7. Definicja ukończenia

Właściciel instaluje serwer raz na urządzeniu 24/7. Na telefonie skanuje QR z
ekranu ustawień serwera — apka sparowana, widzi wszystkie boty, rozmawia, ogląda i
przejmuje przeglądarkę bota, dostaje powiadomienie gdy bot utknie. Na komputerze
robi to samo w trybie zdalnym istniejącej aplikacji desktop. Zgubiony telefon
odłącza jednym kliknięciem z listy urządzeń. Wszystko po Tailscale, bez otwierania
portów i bez przepisywania tokenów.
