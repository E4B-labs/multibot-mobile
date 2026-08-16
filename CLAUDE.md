# CLAUDE.md — `multibot2`, aplikacja MultiBota na telefon

Instrukcje dla agentów pracujących w tym repo. Rzeczy, których nie da się
wyczytać z kodu, i pułapki, które kosztowały już cały dzień.

Repo: `clewkord/multibot2` (prywatne), gałąź `main`.
**To repo JEST aplikacją na telefon.** Korzeń repo to projekt Expo, tak samo
jak w TaskTree. Nie ma tu serwera, silnika ani wersji na komputer.

Kod oryginalny MultiBota mieszka w `clewkord/multibot` i przychodzi tutaj
tylko jednym kanałem — patrz sekcja 4.

---

## 1. Z czego składa się aplikacja

| Katalog | Co to |
|---|---|
| `App.tsx`, `src/` | skorupa: lista hostów, parowanie, WebView, powiadomienia, popup aktualizacji |
| `webui/` | kopia interfejsu MultiBota (React + Vite + Tailwind), przerobiona pod telefon |
| `docs/branding/` | `inspiracje.png` i logo dostawców — wzór wzornictwa |

Skorupa jest w React Native. `webui/` jest zwykłą aplikacją webową i jedzie
w WebView. To dwa różne światy i nie mieszają się: w `src/` nie ma HTML,
w `webui/` nie ma komponentów React Native.

---

## 2. Wydawanie — wzorzec TaskTree

Projekt EAS: `multibot2-mobile`, id `ddb5cfa5-d72e-419f-acb7-e7c2dcddce14`,
konto `slafy`, kanał `production`, pakiet `com.multibot2.mobile`.

**Te cztery wartości są nietykalne.** Kacper ma drugą, produkcyjną aplikację
na projekcie `1d7db8a3-befe-4dc3-a347-293d98c0d031`. Wpisanie tamtego
`projectId` tutaj sprawia, że nasz `eas update` nadpisuje jego produkcję.

| Zmiana | Komenda |
|---|---|
| JavaScript, style, zawartość `webui/` | `npx eas-cli@latest update --branch production -m "opis"` |
| Nowa paczka natywna, `plugins`, uprawnienia, SDK | podnieś `runtimeVersion`, potem `eas build --platform android --profile production` |

`runtimeVersion` to statyczny string `"1.0.0"`, nie polityka `fingerprint`.
Statyczny, bo `fingerprint` liczył inny hash na Windowsie niż na serwerze EAS
i telefon ignorował aktualizacje. Cena: **nikt nie pilnuje granicy za ciebie.**
`eas update` po zmianie natywnej daje aplikację, która wstaje i wywala się na
białym ekranie, bo JavaScript woła moduł, którego w paczce nie ma.

### Trzy pułapki EAS, wszystkie rozbrojone — nie cofaj tych zmian

1. **`/android` i `/ios` w `.gitignore`.** EAS robi `prebuild`, który tworzy
   `android/`. `@expo/fingerprint` pomija katalog natywny tylko wtedy, gdy git
   go ignoruje. Bez tych wpisów build pada na fazie `CONFIGURE_EXPO_UPDATES`
   z `Runtime version mismatch`.
2. **`platforms` wpisane jawnie w `app.json`.** Expo wylicza je z
   zainstalowanych paczek: lokalnie wychodzi `["android","ios","web"]`, na EAS
   `["android","ios"]` — ta sama awaria, druga przyczyna.
3. **EAS pakuje do wysyłki pliki wzięte z gita.** Poprawka leżąca tylko na
   dysku nie trafi do builda. Commituj PRZED `eas build`.

### Przed KAŻDYM `eas update` sprawdź, Z JAKIEGO COMMITA stoi to, co na kanale

```sh
npx eas-cli@latest update:view <group-id> --json    # pole gitCommitHash
git cat-file -t <hash>                              # masz go u siebie?
```

Sama data z `update:list` nic nie mówi. Na tym kanale publikuje więcej niż
jedna osoba, każdy ze swojego dysku, a `eas update` zawsze kładzie CAŁĄ paczkę
na wierzch — nie ma czegoś takiego jak nałożenie zmiany na cudzą wersję.

Pułapka, która kosztowała już dwie publikacje: aktualizacja na kanale bywa
wydana z commita, którego **nie ma na GitHubie**. Wtedy wydanie z `main`, choćby
najświeższego, cofa tamtą pracę i nikt nie umie jej odtworzyć — bo istnieje
wyłącznie na cudzym dysku.

Reguła: `gitCommitHash` najnowszej aktualizacji musi być commitem, który masz
w historii. Nie masz go — **nie publikuj**. Poproś autora, żeby wypchnął swoją
gałąź, dociągnij ją, dopiero wtedy wydawaj.

Bundle interfejsu też nie jedzie sam. `webui/src` trafia do aplikacji dopiero
przez `npm run webui`, który przebudowuje `webui/` i zapisuje `src/webui-html.ts`.
Bez tego kroku publikujesz stary ekran mimo poprawionego źródła.

### `UNKNOWN_ERROR` z EAS nic nie znaczy

Prawdziwy powód siedzi w logu fazy w panelu buildu na `expo.dev`. Bez tego
logu nie ruszaj konfiguracji — zgadywanie kosztuje po kilkanaście minut na
próbę.

---

## 3. Popup aktualizacji

`App.tsx`, wzorzec przeniesiony z TaskTree: na starcie
`Updates.checkForUpdateAsync()`, przy nowszej wersji `Modal` z przyciskiem,
potem `fetchUpdateAsync()` i `reloadAsync()`. Działa tylko w produkcji
(`!__DEV__ && Updates.isEnabled`).

EAS i tak ściąga aktualizację w tle i nakłada przy zimnym starcie — popup jest
po to, żeby użytkownik wiedział, że to się dzieje.

---

## 4. Skąd biorą się nowe funkcje z `multibot`

Nie przez `git merge`. To repo nie ma już `server/` ani `engine/`, więc
scalanie chciałoby je przywrócić przy każdym podejściu.

```sh
git remote add original https://github.com/clewkord/multibot   # raz
node scripts/sync-webui.mjs
```

Skrypt kopiuje `src/` z `original/main` do `webui/src/` i **pomija pliki
należące do telefonu** — lista stoi jawnie na górze skryptu, każda pozycja
z powodem. Wymaga czystego drzewa gita; brudne — odmawia i nic nie rusza.

Wynik oglądasz przez `git diff` i commitujesz albo cofasz przez
`git checkout .`. Nie ma stanu, którego nie da się odwrócić.

Zmiany po stronie **serwera** (nowe trasy API) nie wymagają tu niczego,
dopóki `webui/` ich nie woła. Zmiany w interfejsie wymagają uruchomienia
skryptu.

---

## 5. Weryfikacja przed „skończone"

```sh
npm install && npx tsc --noEmit          # skorupa
cd webui && npm install && npm run build # interfejs
```

Każde „działa" ma pod sobą wyjście komendy. Bez wyjścia to nie twierdzenie,
tylko nadzieja.

Zrobione 2 z 3 rzeczy — piszesz wprost które i dlaczego trzeciej nie.

---

## 6. Bezpieczeństwo

Token dostępu do hosta (64 znaki) daje PEŁNĄ kontrolę nad serwerem MultiBota:
boty, pliki, terminal komputera bota, klucze API dostawców. Nie ma kont ani
ograniczonych uprawnień.

Token leży w `expo-secure-store` i trafia do WebView we fragmencie adresu
(`#access_token=`), który nigdy nie idzie po sieci. Nie wypisuj go do logów,
transkryptów ani komend, których wyjście gdzieś trafia.

Przed pushem przeskanuj diff: `sk-`, `ghp_`, `AKIA`,
`-----BEGIN.*PRIVATE KEY-----`, `.env`, pliki powyżej 50 MB.

---

## 7. Higiena

- Komentarze i commity po polsku, pełnymi zdaniami, z powodem — nie z opisem
  tego, co i tak widać w diffie.
- W drzewie roboczym bywają cudze niezacommitowane zmiany. Commituj wyłącznie
  własne pliki, nigdy `git add -A`.
- Plan pracy: `PLAN-MOBILE-KOLEGA.md` (zadania B1–B5) i `PLAN-MOBILE-REPO.md`
  (kształt repo).

---

## 8. Znane otwarte problemy

- **Powiadomienia push nie działają end-to-end.** Klient jest gotowy
  (`src/lib/push.ts`), ale po stronie serwera w `multibot` nie ma ani trasy
  przyjmującej token urządzenia, ani wysyłki do Expo. Robota Kacpra, pozycja
  U28 w jego planach.
- **Parowanie kodem QR** — trasy serwera gotowe (`POST /api/pair/start`,
  `/api/pair/claim`), ale nie ma ekranu, który ten kod POKAZUJE. Do tego czasu
  wpisywanie adresu ręcznie zostaje równorzędną drogą, nie awaryjną.
- **Logowanie Google** — Android odrzuca OAuth w WebView
  (`disallowed_useragent`). Wymagałoby natywnego `expo-auth-session`.
  Decyzja Kacpra: zostajemy przy tokenie.
