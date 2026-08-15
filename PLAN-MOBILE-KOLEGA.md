# PLAN-MOBILE-KOLEGA.md — aplikacja na Androida, repo `clewkord/multibot2`

> Dokument dla kolegi i dla AI, które pracuje w repo `clewkord/multibot2`.
> Napisany 15 sierpnia 2026 na podstawie realnego stanu obu repozytoriów,
> nie z pamięci. Wszystko poniżej zostało sprawdzone komendą.
>
> **Podział pracy:** Kacper prowadzi `clewkord/multibot` (serwer, silnik,
> interfejs web). Kolega prowadzi `clewkord/multibot2` (aplikacja na telefon).
> Nikt nie robi zmian w cudzym obszarze.

---

## 0. Prompt do wklejenia w OpenCode / Claude Code / Codex

```
Pracujesz w repo clewkord/multibot2. To NIE jest samodzielny projekt.

To fork repo clewkord/multibot (kod oryginalny, prowadzi go Kacper). Twój
zakres to WYŁĄCZNIE aplikacja na telefon: clients/mobile/. Cała reszta drzewa
(server/, engine/, src/, scripts/) to kod przychodzący z oryginału — wolno go
scalać, nie wolno go edytować.

ZANIM NAPISZESZ PIERWSZĄ LINIĘ KODU, W KAŻDEJ SESJI:
  git fetch original
  git log --oneline HEAD..original/main
Jeśli coś wyszło — scal to (patrz sekcja 3 PLAN-MOBILE-KOLEGA.md) i dopiero
wtedy zaczynaj zadanie. Oryginał dostaje nowe funkcje co kilka dni; praca na
starym drzewie kończy się konfliktem, którego nikt później nie rozplącze.

Przeczytaj CAŁY PLAN-MOBILE-KOLEGA.md i CAŁY CLAUDE.md przed pracą.
Zadania: sekcja 6. Kolejność jak w sekcji 6, bo B1 blokuje wszystko inne.
Komentarze i commity po polsku, pełnymi zdaniami, z powodem.
Każde "działa" ma pod sobą wyjście komendy.
```

---

## 1. Co to jest i jak jest zbudowane

`multibot2` to fork `clewkord/multibot`. Wspólna historia kończy się na
`c5cf900` — czyli **cała dotychczasowa praca nad aplikacją siedzi w OBU
repozytoriach**: przerobiona skorupa hostów, popup aktualizacji, statyczny
`runtimeVersion`, kopia interfejsu w `clients/mobile/webui`, przekierowanie
WebView na `/m/`.

Rozjazd zaczyna się na dwóch commitach, które są tylko w `multibot2`:

```
015efa8 popraw wersje expo-asset na ~12.0.13 (zgodna z expo@54)
ffd3e5d multibot2: nowa, prosta apka (UI w bundle, bez serwowania z hosta)
```

Czyli oba repozytoria robią dziś to samo i od dziś trzeba to rozdzielić:
**aplikacja rozwija się w `multibot2`, `multibot` przestaje ją dotykać.**
Katalog `clients/mobile/` w `multibot` zostaje jako źródło, z którego fork się
aktualizuje.

Architektura aplikacji telefonowej po tych zmianach:

| Warstwa | Gdzie | Kto pisze |
|---|---|---|
| Natywna skorupa Expo (lista hostów, parowanie, WebView, powiadomienia) | `clients/mobile/src/` | kolega |
| Interfejs MultiBota widziany w apce | `clients/mobile/webui/` (kopia `src/` z oryginału) | kolega |
| Serwer, silnik, logika botów | `server/`, `engine/` | Kacper |
| Interfejs MultiBota w przeglądarce | `src/` | Kacper |

Ta kopia `webui` to najważniejsza decyzja w tym forku i trzeba ją rozumieć:
**aplikacja nie pobiera już interfejsu z serwera, tylko nosi własny w paczce.**
Dzięki temu kolega może przerabiać wygląd aplikacji, nie ruszając tego, co
Kacper widzi w przeglądarce. Cena: kopia się starzeje i trzeba ją ręcznie
dosypywać z oryginału (sekcja 3).

---

## 2. BLOKER — dwa projekty EAS wskazują na to samo miejsce

**To trzeba naprawić zanim kolega puści pierwsze `eas update`.**

Sprawdzone 15 sierpnia 2026 w obu repozytoriach naraz.

| Pole | `multibot` | `multibot2` |
|---|---|---|
| `extra.eas.projectId` | `1d7db8a3-befe-4dc3-a347-293d98c0d031` | **to samo** |
| `slug` | `multibot-mobile` | **to samo** |
| `owner` | `slafy` | **to samo** |
| `android.package` | `com.openmausbot.mobile` | **to samo** |
| kanał w `eas.json` | `production` | **ten sam** |
| `runtimeVersion` | `8d291d16ced5fae324025ea27c674b2b59123af7` | `1.0.0` |

Jeden projekt EAS, jeden kanał, dwa repozytoria. `eas update --branch
production` puszczony z `multibot2` **publikuje w produkcyjnej aplikacji
Kacpra**. Ten sam błąd wywrócił już TaskTree Desktop — dwa klony jednego
projektu wysyłały aktualizacje w to samo miejsce i wygrywał ten, kto puścił
ostatni.

Dziś przed katastrofą chroni jedna różnica w ostatnim wierszu, i to
przypadkiem, nie z projektu. Aplikacja zainstalowana u Kacpra ma runtime
`8d291d16…` — dokładnie po to, żeby przyjmowała aktualizacje bez nowego APK.
`multibot2` publikuje jako `1.0.0`, więc tam nie dochodzi.

Ta ochrona zniknie w chwili, gdy ktokolwiek zrówna te dwie wartości — a zrówna
je pierwszy `eas build` z `multibot2`, bo naturalnym odruchem jest wpisać tam
to, co widać w drugim repo. Dlatego to jest zadanie numer jeden, przed
jakąkolwiek zmianą w kodzie.

### Naprawa (B1) — osobny projekt EAS, jednorazowo

```sh
cd clients/mobile

# 1. Odetnij stary projekt
#    W app.json USUŃ całe "extra" i całe "updates" (przywróci je eas init).
#    Zmień "slug" na "multibot2-mobile".
#    Zmień android.package i ios.bundleIdentifier na "com.multibot2.mobile".
#    Przy okazji usuń duplikaty w android.permissions — CAMERA i RECORD_AUDIO
#    są tam wpisane po dwa razy.

# 2. Załóż własny projekt EAS na koncie kolegi
npx eas-cli@latest login
npx eas-cli@latest init          # wpisze nowe extra.eas.projectId
npx eas-cli@latest update:configure

# 3. Pierwszy build
git add -A && git commit -m "chore(mobile): osobny projekt EAS dla multibot2"
npx eas-cli@latest build --platform android --profile production
```

Zmiana `android.package` znaczy, że to inna aplikacja dla systemu — na
telefonie da się mieć obie naraz i nic się nie nadpisze. O to chodzi.

**Kolejność ma znaczenie: commit PRZED `eas build`.** EAS pakuje do wysyłki
pliki wzięte z gita, nie z dysku. Poprawka leżąca tylko na dysku nie trafi do
builda, a build padnie na czymś, co „przecież jest naprawione". Ten błąd
kosztował w oryginale trzy nieudane buildy.

### Kiedy `update`, a kiedy `build`

`runtimeVersion` jest statyczny (`"1.0.0"`), więc nikt nie pilnuje granicy za
kolegę — trzeba jej pilnować samemu.

| Zmiana | Co zrobić |
|---|---|
| JavaScript, TypeScript, style, obrazki, zawartość `webui/` | `npx eas-cli@latest update --branch production -m "opis"` |
| Nowa paczka natywna, zmiana `plugins` / uprawnień / `app.json` | podnieś `runtimeVersion` na `"1.0.1"`, potem `build` |

Puszczenie `update` po zmianie natywnej daje aplikację, która wstaje i wywala
się na białym ekranie, bo JavaScript woła moduł, którego w paczce nie ma.
Podniesienie `runtimeVersion` to zabezpieczenie: stare buildy przestają brać
te aktualizacje.

---

## 3. Ściąganie nowych funkcji z oryginału

Kacper cały czas dokłada funkcje po stronie serwera i interfejsu. Bez tego
kroku aplikacja kolegi w kilka tygodni przestanie rozumieć API serwera.

### Jednorazowo

```sh
git remote add original https://github.com/clewkord/multibot
git fetch original
```

Kolega potrzebuje dostępu do prywatnego repo `clewkord/multibot` — Kacper musi
go dodać jako współpracownika (`Settings → Collaborators`).

### Na starcie KAŻDEJ sesji

```sh
git fetch original
git log --oneline HEAD..original/main      # co nowego doszło
git merge original/main
```

Konflikty będą prawie wyłącznie w `clients/mobile/` — czyli w plikach kolegi.
Tam wygrywa wersja kolegi. W `server/`, `engine/`, `src/` wygrywa oryginał
zawsze, bez wyjątku:

```sh
git checkout --theirs server/ engine/ src/
```

### Kopia `webui` — jedyne miejsce, gdzie merge nie wystarczy

Git nie wie, że `clients/mobile/webui/` to kopia `src/`. Zmiana, którą Kacper
zrobi w `src/`, przyjdzie z merge'em do `src/`, a kopia w `webui/` zostanie
stara. Aplikacja nadal będzie pokazywać interfejs sprzed miesiąca.

Po każdym merge'u, w którym ruszyło `src/`:

```sh
git diff HEAD@{1} HEAD -- src/          # co dokładnie się zmieniło u Kacpra
```

Przenieś te zmiany do `webui/` ręcznie — z pominięciem tych plików, które
kolega świadomie przerobił pod telefon. To jest praca do zrobienia głową, nie
przez `cp -r`: `cp -r src/. clients/mobile/webui/` skasuje cały styl mobilny.

> `ponytail:` świadome uproszczenie. Prawidłowo `webui` powinno być cienką
> warstwą nadpisań nad `src/`, a nie pełną kopią — wtedy merge robiłby to sam.
> Przerabiać na to warto dopiero, gdy ręczne dosypywanie zacznie boleć,
> powiedzmy po trzecim bolesnym merge'u.

---

## 4. Blok do wklejenia w `CLAUDE.md` i `AGENTS.md` repo `multibot2`

Kolega ma to dopisać na samej GÓRZE obu plików w swoim repo (`AGENTS.md` może
być jedną linią wskazującą na `CLAUDE.md` — OpenCode i Codex szukają tej
nazwy).

```markdown
## Zanim cokolwiek zrobisz w tym repo

To repo jest forkiem `clewkord/multibot`. Kod oryginalny mieszka TAM, tutaj
mieszka wyłącznie aplikacja na telefon (`clients/mobile/`).

Na starcie każdej sesji, przed odczytaniem zadania:

    git fetch original
    git log --oneline HEAD..original/main

Coś wyszło — scal to i dopiero wtedy pracuj. Zasada rozstrzygania konfliktów:
`clients/mobile/` należy do tego repo, `server/`, `engine/` i `src/` należą do
oryginału i tutaj się ich NIE edytuje, tylko przyjmuje.

`clients/mobile/webui/` to ręczna kopia `src/`. Git jej nie zsynchronizuje —
po merge'u ruszającym `src/` przenieś zmiany do `webui/` ręcznie.

Projekt EAS tego repo jest WŁASNY i nie wolno go zmieniać na projekt
oryginału. Jeden `projectId` w dwóch repozytoriach oznacza, że jedna apka
nadpisuje drugą.
```

---

## 5. Jak ma wyglądać interfejs

Wzór: `C:\Users\kacpe\Desktop\loga\inspiracje.png` (u Kacpra). Poniżej opis,
żeby dało się pracować bez pliku.

Styl: bardzo ciemny, prawie czarny (`#0a0a0a`) na tło, karty odrobinę jaśniejsze
(`#141414`) z delikatną jasną obwódką `1px` o niskiej przezroczystości. Rogi
mocno zaokrąglone (12–16 px). Tekst biały, opisy szare (`#8a8a8a`). Zero
kolorowych tła — kolor pojawia się TYLKO w awatarach i ikonach marek.

Elementy do odwzorowania:

- **Paleta wyszukiwania.** Pole „Search" u góry, pod nim rząd zakładek
  filtrujących: `All · Messages · Agents · Groups · Files · Links · Routines ·
  Actions`. Aktywna zakładka to jasna pigułka, reszta sam szary tekst.
- **Wiersz listy.** Okrągły kolorowy awatar, obok pogrubiona nazwa, zaraz za
  nią mała szara pigułka z rolą („Help with updates", „Handles Partnerships"),
  w drugiej linii szary opis przycięty jedną linią. Po prawej stronie wiersza,
  wyszarzone: typ (`Agent`, `Skill`, `Routine`, `Plugin`, `Action`) albo
  godzina (`1:04 PM`, `Monday`).
- **Wiersze skilli** mają z przodu glif `⌘`.
- **Wtyczki** pokazują prawdziwe logo marki (Gmail, Google Drive, Google
  Calendar) i szare słowo `connected` obok nazwy.
- **Karta pliku**: ikona dokumentu, nazwa `weekly-update-aug-14.md`, pod nią
  rozmiar `9.5 KB`.
- **Pigułki zdarzeń** w czacie: `Created routine ● Weekly agent updates`,
  `Renamed to Weekly Update` — małe, obłe, szary tekst.
- **Przyciski stanu**: małe, ciemne, obłe. `Open`. `Connecting...` z trzema
  kwadracikami animowanymi po kolei.
- **Podgląd komputera bota**: zaokrąglona ramka, w środku makieta okna
  przeglądarki. Nad nią pasek `Weekly Update is watching and learning`
  z czerwoną kropką nagrywania, licznikiem `0:13` i krzyżykiem. Na warstwie
  wierzchniej półprzezroczysty przycisk `Learn from demonstration`.
  Kursor myszy WIDOCZNY i duży.

To ten sam kierunek, który dostanie interfejs webowy. Jeżeli coś jest
niejasne — zapytać Kacpra zamiast zgadywać, bo obie strony mają wyjść tak
samo.

---

## 6. Zadania kolegi, po kolei

**B1 — osobny projekt EAS.** Sekcja 2. Blokuje wszystko inne, bo bez tego
każdy `eas update` jest strzałem w produkcję Kacpra.
*Gate:* `eas update --branch production` przechodzi, aplikacja Kacpra nie
dostaje żadnej aktualizacji, na telefonie kolegi da się zainstalować obie apki
naraz.

**B2 — remote `original` i blok w CLAUDE.md.** Sekcje 3 i 4.
*Gate:* `git fetch original && git merge original/main` wykonane; commit
`c0dfced` (composio parity, wysyłka plików bota) jest w drzewie.

**B3 — powiadomienia push.** Serwer po stronie oryginału już to ma
(`clients/mobile/src/lib/push.ts` plus trasy w `server/`). Brakuje: prośby o
uprawnienie przy pierwszym starcie, rejestracji tokenu Expo na hoście,
obsługi wejścia w powiadomienie (ma otwierać właściwego bota).
*Gate:* bot kończy turę przy WYŁĄCZONEJ aplikacji, powiadomienie przychodzi na
telefon, kliknięcie otwiera rozmowę z tym botem.

**B4 — przerobienie wyglądu.** Sekcja 5. Praca w `clients/mobile/webui/`.
Zaczynać od palety wyszukiwania i wierszy list — najwięcej widać.
*Gate:* zrzuty ekranu obok `inspiracje.png`, Kacper akceptuje.

**B5 — onboarding.** Pierwszy start aplikacji ma dziś ekran listy hostów.
Docelowo dwa duże przyciski: **Postaw serwer** i **Zaloguj się do serwera**.
Pierwszy pokazuje instrukcję z adresem i tokenem, drugi prowadzi do
skanowania kodu QR albo wklejenia adresu z tokenem. Kacper robi tę samą rzecz
po stronie webu — **uzgodnić teksty przed pisaniem**, żeby nie wyszły dwie
różne aplikacje.
*Gate:* czysta instalacja, użytkownik bez wiedzy technicznej dochodzi do
działającego czatu i nie musi niczego wpisywać ręcznie poza jednym QR.

Poza zakresem kolegi: `server/`, `engine/`, `src/`, silnik, komputer bota,
pamięć, rozliczenia. To wszystko przychodzi merge'em.

---

## 7. Rzeczy, które ugryzą — spis z góry

1. **`eas build` bierze pliki z gita.** Commit przed buildem, zawsze.
2. **`/android` i `/ios` muszą zostać w `clients/mobile/.gitignore`.** EAS robi
   `prebuild` i tworzy `android/`. Ten katalog w gicie wywala build na
   `Runtime version mismatch` w fazie `CONFIGURE_EXPO_UPDATES`.
3. **`platforms` w `app.json` wpisane jawnie.** Expo wylicza je z paczek:
   lokalnie wychodzi `["android","ios","web"]`, na EAS `["android","ios"]` —
   ta sama awaria, druga przyczyna. Nie kasować tego pola.
4. **`UNKNOWN_ERROR` z EAS nic nie znaczy.** Prawdziwy powód siedzi w logu
   fazy w panelu buildu na `expo.dev`. Bez tego logu nie ruszać konfiguracji,
   bo zgadywanie kosztuje po kilkanaście minut na próbę.
5. **Logowanie Google w aplikacji nie działa i nie zadziała w WebView.**
   Android zwraca `disallowed_useragent`. Potrzebny natywny
   `expo-auth-session`. Na dziś obowiązuje logowanie tokenem — nie zaczynać od
   tego tematu.
6. **Serwer stoi na telefonie Kacpra** (`100.78.241.9:8799`) i jest widoczny
   tylko wewnątrz sieci Tailscale. Z zewnątrz idzie przez szybki tunel
   Cloudflare, którego adres zmienia się przy każdym starcie. Do testów kolega
   pyta Kacpra o bieżący adres albo stawia sobie własny serwer lokalnie
   (`pnpm build:server && node dist-server/index.js`).
