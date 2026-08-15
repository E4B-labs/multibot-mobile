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

# CLAUDE.md

Instrukcje dla agentów pracujących w tym repo. Rzeczy, których nie da się
wyczytać z kodu, i pułapki, które kosztowały już cały dzień.

Repo: `clewkord/multibot` (prywatne), gałąź `main`. To prywatny fork
OpenMausBot z silnikiem Pythona wstawionym jako `engine/`.

---

## 1. Produkcja stoi na telefonie

Najczęstsze źródło pomyłek w tym projekcie.

| Element | Gdzie |
|---|---|
| Serwer MultiBota | Samsung s10e, Termux, `100.78.241.9:8799` |
| Dostęp | `ssh -p 8022 100.78.241.9` (Tailscale) |
| Kod wdrożony | `~/multibot/dist-server/`, `~/multibot/dist/` |
| Usługi | runit: `export SVDIR=$PREFIX/var/service; sv status multibot` |
| Publiczny adres | szybki tunel Cloudflare, adres losowy przy każdym starcie |

`100.78.241.9` żyje TYLKO wewnątrz sieci Tailscale. Ktoś spoza niej dostanie
timeout — to nie jest błąd aplikacji. Aktualny adres publiczny:

```sh
ssh -p 8022 100.78.241.9 'grep -o "https://[a-z0-9-]*\.trycloudflare\.com" $PREFIX/var/log/sv/cloudflared/current | tail -n 1'
```

**Dockera na telefonie nie ma i nie będzie** — nieukorzeniony Android nie da
uprawnień jądra. Komputer bota chodzi natywnie:
`MULTIBOT_COMPUTER_BACKEND=native` plus `scripts/computer-native.sh`
(Xvnc `:1`, xfce4, Chromium z CDP, websockify; porty cdp 9223, novnc 6901).

CLI dostawców (`claude`, `codex`) to wrappery na `proot-distro login debian`,
gdzie `HOME=/root`. Ścieżki `/data/data/com.termux/...` są w prooct widoczne i
binarki Termuksa się wykonują, ale Python liczy z `HOME` katalog user-site —
dlatego `HOME` musi jechać jawnie (`server/engine/computer-mcp.ts`).

Szczegóły dostępu zdalnego i logowania Google: `docs/REMOTE-ACCESS.md`.

---

## 2. Wdrożenie

```sh
# serwer i harness
pnpm build:server
tar czf - dist-server | ssh -p 8022 100.78.241.9 'cd $HOME/multibot && tar xzf -'
ssh -p 8022 100.78.241.9 'export SVDIR=$PREFIX/var/service; sv restart multibot'

# interfejs web (to samo widać w przegladarce I w apce telefonowej)
pnpm build
tar czf - dist | ssh -p 8022 100.78.241.9 'cd $HOME/multibot && tar xzf -'
```

Pliki statyczne czyta z dysku, więc po wgraniu `dist` restart jest zbędny.

**Pułapka: `sv restart multibot` NIE przeładowuje silnika.** Silnik Pythona
jest spawnowany jako proces odłączony, żeby rutyny przeżywały zamknięcie
aplikacji. Zmieniłeś coś w `engine/` — najpierw zabij proces uvicorna, dopiero
potem restartuj usługę. Pominięcie tego daje fałszywy wynik „naprawione".

---

## 3. Aplikacja telefonowa to skorupa nad WebView

`clients/mobile/src/screens/WebViewScreen.tsx` ładuje `source={{ uri }}`, gdzie
`uri` to adres hosta. Cały interfejs MultiBota przychodzi z serwera. Z tego
wynika podział, który decyduje, co w ogóle trzeba robić:

| Zmiana | Co zrobić |
|---|---|
| Interfejs MultiBota (`src/`) | `pnpm build` + wgranie `dist`. **Apki się nie rusza.** |
| Skorupa (`clients/mobile/src/`) | `npx eas-cli@latest update --branch production --message "..."` |
| Nowa zależność natywna, zmiana `plugins` w `app.json` | `npx eas-cli@latest build --platform android --profile production` |

Projekt EAS: `@slafy/multibot-mobile`, id `1d7db8a3-befe-4dc3-a347-293d98c0d031`,
kanał `production`, keystore po stronie EAS.

`runtimeVersion: "8d291d16ced5fae324025ea27c674b2b59123af7"` (statyczny
string, NIE `fingerprint`) — wzorzec przeniesiony z TaskTree. OTA dostarcza się
do każdego APK z tym samym stringiem, niezależnie od systemu, na którym liczono
build. Omija błąd, w którym `fingerprint` liczył inny hash na Windowsie
(`aba46387…`) i na Linuxie EAS (`8d291d16…`), przez co telefon ignorował update.

Wartość to odcisk (fingerprint) builda `de41d3c3` — celowo taka sama jak w
zainstalowanym APK, żeby OTA trafiała do niego BEZ nowego builda. Przy
kolejnym `eas build` można przejść na ładniejszą wersję semantyczną (np.
`0.1.0`) — ale wtedy trzeba wgrać nowy APK, bo stary (runtime `8d291d16…`)
nie przyjmie update'ów z innym stringiem.

Zmiana natywna (nowa zależność, `plugins`, SDK) = nowy `eas build` ORAZ bump
`runtimeVersion`. Bez bumpu EAS puści update, ale stary APK go nie przyjmie.
Czysty JS = sam `eas update`, `runtimeVersion` bez zmian.

**W aplikacji jest popup aktualizacji** (`clients/mobile/App.tsx`, wzorzec
TaskTree): na starcie `Updates.checkForUpdateAsync()`; jak jest nowszy update,
wyskakuje `Modal` z przyciskiem "Download & restart" →
`Updates.fetchUpdateAsync()` + `Updates.reloadAsync()`. Działa tylko w produkcji
(`!__DEV__ && Updates.isEnabled`). EAS domyślnie i tak ściąga update w tle i
nakłada przy zimnym starcie — popup to jawne potwierdzenie dla użytkownika.

### Trzy pułapki EAS, wszystkie rozbrojone — nie cofaj tych zmian

1. **`/android` i `/ios` w `clients/mobile/.gitignore`.** EAS robi `prebuild`,
   który tworzy `android/`. `@expo/fingerprint` pomija katalog natywny tylko
   wtedy, gdy git go ignoruje. Bez tych wpisów build pada na fazie
   `CONFIGURE_EXPO_UPDATES` z `Runtime version mismatch`.
2. **`platforms` wpisane jawnie w `app.json`.** Expo wylicza je z
   zainstalowanych paczek: lokalnie wychodziło `["android","ios","web"]`, na
   EAS `["android","ios"]` — ta sama awaria, druga przyczyna.
3. **EAS pakuje do wysyłki pliki z gita.** Poprawka leżąca tylko na dysku nie
   trafi do builda. Commituj PRZED `eas build`.

### `UNKNOWN_ERROR` z EAS nic nie znaczy

Prawdziwy powód siedzi w logu fazy. Wyciągnij go przez API (`builds.byId`,
sesja z `~/.expo/state.json`) zamiast zgadywać — bez logu nie ruszaj
konfiguracji.

---

## 4. Prompt systemowy ma DWIE ścieżki

- Drivery **codex / claude / acp** dostają prompt z `server/index.ts:552-586`
  (pole `system` w `sendTurn`).
- Driver **slafy** (silnik) **nie dostaje `system` w ogóle** — gateway celowo
  pomija `instructions`, żeby nie przykryć SOUL.md. Jedyna droga do jego
  tożsamości to `engine/server/bots.py`, `ensure_multibot_identity()` i stała
  `_COMPUTER_IDENTITY` (marker `MULTIBOT_COMPUTER_IDENTITY_V1`).

Zmiana promptu musi trafić w OBIE ścieżki, inaczej połowa botów jej nie zobaczy.

---

## 5. Serwery MCP u codeksa

Codex startuje serwery MCP równolegle z turą i zamyka listę narzędzi w
`resolve_for_step`. Serwer, który do tej chwili nie wstał, jest pomijany, o ile
nie jest wymagany:

```
omitting pending optional MCP server server_name=computer
```

Serwer komputera to Python i na telefonie wstaje ~4 s, więc przegrywał wyścig
46 razy z rzędu. Łaska dla serwerów opcjonalnych to stała w kodzie codeksa,
więc jedyną dźwignią jest `required: true`
(`server/drivers/codex.ts::codexMcpConfig`).

`thread/resume` **nie startuje serwerów MCP w ogóle**. Wątek założony bez
komputera zostaje bez niego na zawsze. Jedyny sposób naprawy istniejącego bota
to zmiana `COMPUTER_TOOLS_VERSION` (`server/engine/computer-mcp.ts`), która
zmienia klucz w kursorze i wymusza nowy wątek. Cena: bot traci pamięć po
stronie dostawcy, transkrypt harnessu zostaje.

Log codeksa to SQLite `/root/.codex/logs_2.sqlite`, widoczny tylko w prooct,
tabela `logs`, kolumny `ts, level, target, feedback_log_body`.

**Zielona tura sama z siebie niczego nie dowodzi — to wyścig. Bez sprawdzenia
logu wynik jest przypadkiem.**

---

## 6. Higiena repo

- **Plany.** `PLAN-00-INDEX.md` to spis wszystkiego, co ma powstać, z numerami
  pozycji. Plany wykonawcze: `PLAN-COMPUTER-USE.md`, `PLAN-PAMIEC.md`,
  `PLAN-UI.md`, `PLAN-BIZNES.md`, `PLAN-STOS.md`. Zanim zaczniesz zadanie,
  sprawdź, czy nie ma go już na tej liście z podjętą decyzją — kilka rzeczy
  zostało tam świadomie odrzuconych i nie otwiera się ich ponownie.
- **Aplikacja na telefon mieszka w drugim repo.** `clewkord/multibot2` to fork
  tego repo, prowadzony przez kolegę Kacpra, i tam idą wszystkie zmiany
  aplikacji mobilnej. Tutaj `clients/mobile/` zostaje jako źródło, z którego
  tamten fork się aktualizuje. Nie rób w tym repo zmian pod telefon bez
  uzgodnienia — trafią do dwóch miejsc naraz. Zasady współpracy i pułapka
  wspólnego projektu EAS: `PLAN-MOBILE-KOLEGA.md`.
- Pliki upstreamu (OpenMausBot) zmieniamy wyłącznie małymi, dodającymi blokami
  oznaczonymi komentarzem `// multibot:`. `server/contracts.ts` — zero zmian.
- Bez nowych zależności npm w ich `package.json`. Bez reformatów.
- Zasada graceful-absence: wyłączony silnik ma dawać zachowanie stockowego
  OpenMausBot, nigdy wywróconą turę.
- Drill merge'a upstreamu na końcu każdej większej zmiany.
- **W drzewie roboczym bywają cudze niezacommitowane zmiany.** Commituj
  wyłącznie własne pliki, nigdy `git add -A`.
- Gałęzie, PR-y i podział pracy: `docs/TEAM-WORKFLOW.md`. Trzymaj się tego
  dokumentu zamiast wymyślać własny obieg.
- Komentarze i commity po polsku, pełnymi zdaniami, z powodem — nie z opisem
  tego, co i tak widać w diffie.

---

## 7. Weryfikacja przed „skończone"

```sh
pnpm build:server
npx vitest run server/
cd engine && ./.venv/bin/python -m pytest    # 233+ testów
```

Każde „działa" ma pod sobą wyjście komendy. Bez wyjścia to nie twierdzenie,
tylko nadzieja. Czerwone testy zgłaszasz razem z wyjściem; testu nie
„poprawiasz", żeby przeszedł, chyba że sam test jest błędny — wtedy piszesz
dlaczego.

Zmiana zachowania zostawia jeden sprawdzalny check: mały test albo `assert`.
Bez frameworków i fikstur.

Zrobione 2 z 3 rzeczy — piszesz wprost które i dlaczego trzeciej nie.

---

## 8. Bezpieczeństwo

- Token dostępu (`auth.token` w `~/.openmausbot/config.json`, 64 znaki) daje
  PEŁNĄ kontrolę: boty, pliki, terminal komputera bota, klucze API dostawców.
  Nie ma kont ani ograniczonych uprawnień. Nie wypisuj go do logów, transkryptów
  ani komend, których wyjście gdzieś trafia.
- Rotacja: UI (`AppSettingsPanel`) albo `POST /api/auth/token/rotate`. Zrywa
  wszystkie sesje.
- Publiczny tunel = każdy może zapukać. Za bramką stoi wszystko powyżej.
  Dlatego tunel nie wstaje domyślnie na ślepo.
- Przed pushem przeskanuj diff: `sk-`, `ghp_`, `AKIA`,
  `-----BEGIN.*PRIVATE KEY-----`, `.env`, pliki powyżej 50 MB. Trafienie
  blokuje push — wypchnięty sekret zostaje w historii na zawsze.

---

## 9. Znane otwarte problemy

- **`screenshot` na telefonie nie wraca.** Tura wisiała ponad 25 minut z
  `busy=True` po wywołaniu narzędzia. Samo narzędzie startuje. Podejrzenie:
  zrzut 1920x1080 przez CDP na s10e albo zakleszczenie w
  `engine/server/computer.py`. Niezdiagnozowane.
- **Logowanie Google w aplikacji mobilnej** — Android blokuje OAuth w WebView
  (`disallowed_useragent`). Potrzebny natywny `expo-auth-session`.
- **Parowanie kodem QR** — serwer gotowy (`POST /api/pair/start`, `/claim`),
  brak ekranu z kodem w UI.
- **Nazwany tunel Cloudflare** wymaga własnej domeny; świadomie zostajemy przy
  szybkim tunelu, więc logowanie Google jest na razie niedostępne.
