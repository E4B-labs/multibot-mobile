# PLAN-COMPUTER.md — runda H/R/A: jeden pełny Komputer bota

> Plan wykonawczy dla agenta. Kolejny dokument po `GOAL.md` (runda G) i
> `PLAN-CLIENTS.md` (runda C). Odwołania `plik:linia` zweryfikowane wobec
> stanu repo z 14 sierpnia 2026 — nie wobec pamięci autora planu.

## Stan wykonania (14 sierpnia 2026)

Plan wykonany w jednej sesji. Testy: **vitest 270 passed / 3 skipped**,
**pytest 291 passed / 2 skipped**, `tsc -b` i `tsc -p tsconfig.server.json`
czyste, `vite build` i `tsc -p tsconfig.server.build.json` przechodzą,
`node scripts/selfhost-check.mjs` OK.

| Faza | Stan | Uwagi |
|---|---|---|
| H0 | zrobione | Obraz przypięty digestem; trzy niespodzianki niżej |
| H1 | zrobione | Wybór źródła usunięty, brak stanu `off`, komputer ginie z botem |
| H2 | zrobione, zweryfikowane na żywo | Jeden kontener na instalację; bot A pisze plik, bot B go czyta; usunięcie bota nie zabija maszyny |
| H3 | zrobione | Claude, Codex, ACP i Slafy montują TEN SAM komputer |
| H4 | zrobione, zweryfikowane na żywo | Ekran przez proxy; handshake `RFB 003.008` przeszedł end-to-end na samym cookie |
| H5 | zrobione (weryfikacja do poziomu API) | Lease GLOBALNY — jeden ekran, jeden właściciel wejścia; kliknięcia w wyrenderowanym panelu nikt nie sprawdził, brak przeglądarki w sesji |
| H6 | zrobione, z jedną luką | Redakcja sekretów + kasowanie kroków; **capture na poziomie pulpitu odłożone** |
| R1 | zrobione | Cztery presety, edycja rozpoznaje harmonogram, daty przez `Intl` |
| A1 | kod gotowy | Działa dopiero po podaniu projektu Firebase |
| C1 | kod gotowy, niezbudowany | Expo — brak konta i urządzenia; parowanie QR działa po stronie serwera |
| C2 | kod gotowy, niezbudowany | Electron rozszerzony o zdalny host |
| Q | częściowo | Testy automatyczne zielone; testy z realnymi modelami wymagają kluczy |

### Czego H0 nie przewidział, a co zmieniło projekt

1. **Obraz `trycua/cua-xfce` ma firefoxa, nie chromium.** Cały stos przeglądarki
   silnika (`computer.py`, `computer_mcp.py`, `teach.py`) stoi na CDP, którego
   firefox nie mówi — przejście na niego oznaczałoby przepisanie trzech
   modułów. Zamiast tego `Dockerfile.computer` dokłada Chrome cienką warstwą
   nad przypiętym digestem, więc cały istniejący kod działa bez zmian.
2. **Chrome ≥ 111 ignoruje `--remote-debugging-address`** i pinuje CDP do
   loopbacka kontenera, gdzie forwarder Dockera go nie widzi. `socat` mostkuje
   9222 na 9223 wewnątrz kontenera; host publikuje tylko 127.0.0.1.
3. **Port hosta zmienia się po każdym restarcie kontenera** (zmierzone:
   32770 → 32773 → 32830). Manager odczytuje go przez `docker port` przy każdym
   użyciu i nigdy nie zapamiętuje.
4. **WSL usypia i SIGTERMuje wszystkie kontenery**, gdy żadna sesja go nie
   trzyma. Wracają wyłącznie te z polityką restartu, więc
   `--restart unless-stopped` jest wymagane, nie kosmetyczne.
5. **Testy tworzyły PRAWDZIWE kontenery.** Suite startuje harness jako
   podproces, więc pierwszy przebieg zostawił 11 żywych kontenerów i wyczerpał
   zakres portów, na których wiążą się inne testy. Testy deklarują teraz
   `MULTIBOT_COMPUTER=off`.
6. **Ekran nie przechodził bramki auth.** `<iframe>` nie doda nagłówka
   `Authorization`, a websockify nie zna naszego subprotokołu — panel dostawał
   401 i funkcja nie działała wcale. Klient wymienia raz token na sesję cookie
   (`POST /api/auth/session`); wymiana wymaga tokena, więc bramka nie jest
   szersza.
7. **Ekran ginął w drodze przez inny handler.** `server/engine/proxy.ts`
   niszczył gniazdo KAŻDEGO upgrade'u, który nie był jego — z czasów, gdy był
   jedynym takim handlerem. Websockify zwracał `101`, a klient nie dostawał nic.
   Żaden test jednostkowy nie mógł tego złapać, bo w izolacji oba handlery są
   poprawne; regresję pilnuje teraz test montujący oba naraz.
8. **Równoległe `ensureComputer` ścigały się.** Panel odpytuje, tura też —
   przegrany dostawał `name already in use` i użytkownik widział
   `Computer error` przy działającym komputerze. Wywołania są teraz
   deduplikowane, a konflikt nazwy traktowany jako sukces.
9. **Rozwiązywanie portu było wołane przy każdym żądaniu** — a `readPorts`
   robiło trzy przejścia przez WSL. Upgrade WebSocketa nie mieścił się w
   limicie czasu. Teraz czytany jest jeden port, z krótkim cache.
10. **Boot harnessu tworzył komputery**, więc każdy testowy spawn serwera
    mnożył kontenery (narosło ich 20). Start tylko **wznawia** istniejące;
    komputer powstaje, gdy ktoś go realnie użyje.
11. **`localComputer` konsumował tylko `claude.ts`.** Codex montował w
   `mcp_servers` sam `agents`, ACP tak samo — dwa z czterech driverów z
   Definition of Done nie miały czym dotknąć pulpitu. Oba zostały doposażone.

### Co wymaga Ciebie, zanim to ruszy

- **Zbudować obraz komputera:** `docker build -f Dockerfile.computer -t multibot-computer:dev .`
  (na Windows przez WSL). Bez niego panel pokaże `Computer error`.
- **Firebase (A1):** własny projekt, `projectId` w configu, OAuth clients dla
  web/Expo/Electron. Do tego czasu logowanie Google jest bezczynne, a działa
  token dostępowy.
- **Expo (C1):** `npm install` **wewnątrz `clients/mobile/`** (nigdy w korzeniu),
  potem `npx expo install --fix` — wersje zależności są ustawione ręcznie i
  nierozwiązane wobec rejestru. Kamera i SecureStore wymagają urządzenia.
- **Testy providerów (Q):** cztery drivery × screenshot/click/type/terminal
  wymagają realnych kluczy API.

### Świadome luki

- **Capture na poziomie pulpitu w Record a skill.** Recorder jedzie przez CDP,
  który widzi wyłącznie wnętrze strony. Nagrywanie zdarzeń XFCE (okna, aplikacje,
  drzewo dostępności) wymaga osobnego kanału, którego w tym repo nie ma. Zamiast
  udawać go współrzędnymi, nagrywanie działa dobrze na poziomie przeglądarki, a
  reszta jest zapisana jako luka.
- **Parowanie QR nie ma jeszcze ekranu w aplikacji hosta.** Serwer
  (`POST /api/pair/start` i `/api/pair/claim`) oraz telefon są gotowe, ale nic
  nie renderuje kodu, a pole `url` w odpowiedzi to `127.0.0.1` — zanim QR
  zostanie pokazany, musi tam trafić adres LAN albo Tailscale. Dziś działa
  ręczne wklejenie tokena i tak też robi aplikacja mobilna.
- **Sparowany telefon dostaje token główny**, więc `revokeDeviceSession` go nie
  odetnie — obietnica z fazy Q („unieważnione urządzenie traci HTTP/SSE/WS")
  nie jest dla niego spełniona. Właściwe rozwiązanie to tokeny per urządzenie
  z `PLAN-CLIENTS.md` C1; świadomie odłożone.
- **Komputer bota zasypia razem z WSL.** Na Windows demon Dockera stoi w WSL,
  a ta usypia, gdy nic jej nie trzyma — kontenery dostają SIGTERM i wracają
  dopiero, gdy coś obudzi WSL. Pierwsze żądanie po przerwie potrafi trwać
  kilkadziesiąt sekund i po drodze zwrócić 502. Na Linuksie problem nie
  występuje.
- **Dwa boty mogą sobie przeszkadzać na wspólnym pulpicie.** Lease rozstrzyga
  tylko spór człowiek kontra agent. Dwie tury naraz sterują tą samą
  przeglądarką i mogą się nadpisać — to wymaga kolejki tur nad maszyną, nie
  drugiego lease'a. Agent dostaje w prompcie ostrzeżenie, żeby sprawdzał ekran
  zamiast ufać temu, co widział wcześniej.
- **Sterowanie fizycznym pulpitem hosta, Cloud Computer, Windows VM** —
  odłożone zgodnie z planem.

## Docelowa decyzja

Jeden pełny **Komputer bota**, uruchamiany automatycznie na urządzeniu
hostującym MultiBota. Bez wyboru źródła: znikają `Shared`, `This Mac`,
`Cloud`, `Playwright`, `Browser` i `Off`.

### Rozstrzygnięcia

- Pierwsza wersja komputera: trwały **Linux desktop w Dockerze, JEDEN na instalację**,
  wspólny dla wszystkich botów (zmiana z 14.08 wieczorem — było per bot).
- W środku: pulpit, Chromium, terminal, pliki, workspace.
- Komputer należy do instalacji, nie do bota: powstaje przy pierwszym użyciu i
  PRZEŻYWA usunięcie bota, bo pozostałe boty z niego korzystają.
- Zamknięcie panelu nie wpływa na komputer.
- Panel pokazuje już działający ekran.
- Kliknięcie ekranu powiększa go i pozwala przejąć sterowanie.
- Agent i użytkownik korzystają z dokładnie tego samego pulpitu.
- Cloud, fizyczny komputer hosta, Shared Computer i Windows VM — na później.
- Telefon jest klientem. Nie obiecujemy pełnego desktopu Docker na
  nieuprzywilejowanym Termuxie.
- `Record a skill` wykorzysta istniejące `Teach a task`, nie drugi system.
- Desktop wykorzystuje istniejący Electron.
- Mobile wykorzystuje Expo + WebView.
- Google login wykorzystuje Firebase Authentication jak TaskTree. Firestore
  nie jest mechanizmem OAuth.

## Stan repo — co już jest (zweryfikowane)

| Rzecz | Gdzie | Stan |
|---|---|---|
| Union trybów komputera | `server/store.ts:75` | `"cloud" \| "local" \| "playwright" \| "shared" \| "off"` — pięć wariantów, do usunięcia |
| Wybór źródła w ustawieniach bota | `src/components/SettingsPanel.tsx:293-304` | pętla po trybach z `patch({ computer: mode })` |
| Rozgałęzienia komputera w harnessie | `server/index.ts:612`, `:632`, `:637`, `:686-694`, `:710`, `:1259-1260` | `wants = bot.computer`, provisioning Boxa, lokalne CUA, prompt, `startScreenPoller`, `configureEngineComputer` |
| Fazy panelu | `src/components/ComputerPanel.tsx:37-43`, `:80-110`, `:349-354`, `:382-387` | `checking/starting/ready/local/local-unavailable/unconfigured/playwright/shared/off` |
| Cloud Box | `server/box.ts` (232 l.), `server/computer-proxy.ts` (273 l.), `server/drivers/boxagent.ts` (240 l.) | z OpenMausBot, 1:1 |
| Lokalne CUA hosta | `electron/cua.mjs` (144 l.) | z OpenMausBot |
| MCP komputera (harness) | `server/engine/computer-mcp.ts` (87 l.) | montuje komputer silnika |
| Komputer silnika | `engine/server/computer.py`, `engine/server/computer_mcp.py` | CDP nad Chromium: `screenshot`, `navigate`, `read_page`, `click`, `type_text`, `key`, `scroll`, `status` |
| Rutyny — tryby | `src/components/RoutinesPanel.tsx:54` | `["hourly","daily","weekly","custom"]` — brak `monthly` |
| Rutyny — bug edycji | `src/components/RoutinesPanel.tsx:81` | `useState(routine ? "custom" : "daily")` — **każda edycja startuje w Custom** |
| Rutyny — backend | `server/routines.ts:17`, `:35-58`, `:129`, `:151-155`, `:197` | pięciopolowy cron + `nextRunAt` już policzone |
| Teach a task | `src/components/SkillsPanel.tsx:131` (`TeachCard`), `engine/server/teach.py:196/216/273` | `start` / `stop` / `synthesize` działają |
| **Luka bezpieczeństwa teach** | `engine/server/teach.py:97` | `send("input", e.target, { value: e.target.value })` — nagrywa hasła i tokeny |
| Auth | `server/auth.ts`, `server/index.ts:1586-1597`, `:1910` | token dostępowy (runda G2). **Brak Firebase, brak Google login** |
| Klienci mobile/desktop | `clients/` | katalog **pusty** — runda C nie ruszona |
| Docker | `Dockerfile.selfhost`, `docker-compose.selfhost.yml`, `scripts/selfhost-check.mjs` | self-host całego MultiBota, nie komputer per bot |

### Uwaga o hoście (nie z planu — z realiów maszyny)

Na tej maszynie **nie ma Dockera pod Windows**. Docker żyje wyłącznie w
WSL Ubuntu; polecenia idą przez `wsl -d Ubuntu -e sh -c "... docker compose ..."`,
wolumeny muszą być nazwane (bind na `/mnt/g` odpada). Noga testowa
„Windows Docker Desktop" z fazy H0 nie przejdzie tu w formie dosłownej —
zastąp ją „Docker w WSL2 na Windows" i zapisz wynik jako taki.

## Zasady wykonania

Przed kodem przeczytać:

- `PRODUCT.md`
- `PLAN-CLIENTS.md`
- `src/components/ComputerPanel.tsx`
- `docs/computer-use-integration.md`
- `server/box.ts`
- `server/computer-proxy.ts`
- `server/engine/computer-mcp.ts`
- `engine/server/computer.py`
- `engine/server/computer_mcp.py`
- `engine/server/teach.py`

Reguły:

1. **Zachować wszystkie obecne niezatwierdzone zmiany. Nie resetować worktree.**
   Drzewo ma dziesiątki zmodyfikowanych plików i nieśledzone `PRODUCT.md`,
   `server/approval-rules.ts`, `server/attachments.ts`,
   `scripts/install-codex.mjs`. To praca w locie — commituj wybiórczo,
   nigdy `git add -A`.
2. Nie budować nowego systemu, jeśli istnieje działający fragment
   OpenMausBot, Cua albo Teach a task.
3. **Nie publikować żadnego portu kontenera na `0.0.0.0`.** Dostęp tylko
   przez harness i jego auth.
4. **Nie montować `/var/run/docker.sock` do komputera agenta.**
5. Każda faza kończy się testem i osobnym gate'em. Nie wdrażać częściowego
   Computer UI na produkcję.

## Rozeznanie runtime'ów (wynik analizy, do wykorzystania w H0)

- **Cua** — wspólne API dla Linux/macOS/Windows: screenshot, mysz,
  klawiatura, shell, MCP, trajektorie. Preferowany control layer.
- **Agent Infra Sandbox** — pełny kontener z browserem, shellem, plikami,
  MCP, VNC i VS Code. Najbliższy wymaganej funkcji; sprawdzić wymagania
  bezpieczeństwa.
- **Anthropic Computer Use Demo** — potwierdzony wzorzec Linux desktop w
  Dockerze z X11 i VNC; słaba separacja komponentów, jedna sesja.
- **E2B Desktop** — poprawny cloud sandbox ze streamem i takeover, wymaga
  zewnętrznej usługi.
- **linuxserver/webtop** — pełny desktop z przeglądarki; bezpieczne
  wystawienie i agent API trzeba dobudować.
- **dockur/windows** — prawdziwy Windows jako VM KVM w Dockerze. Wymaga
  Linux hosta, `/dev/kvm`, dużo RAM, licencji. Nie na pierwszą wersję.
- **noVNC** — gotowy webowy klient VNC: desktop, skalowanie, clipboard,
  gesty mobilne.

---

# Faza H0 — sprawdzenie obrazu komputera

Cel: potwierdzić runtime **przed** przebudową UI.

Priorytet testowania:

1. przypięta wersja `trycua/cua-xfce`;
2. przypięty digest `agent-infra/sandbox`;
3. dopiero potem własny cienki obraz na bazie Ubuntu/XFCE.

Wymagany spike:

- start kontenera;
- trwały `/home`;
- Chromium;
- terminal;
- screenshot;
- click / type / scroll;
- shell command;
- VNC/noVNC;
- restart bez utraty cookies;
- dostęp wyłącznie przez loopback;
- działanie na Docker w WSL2 (Windows) i na zwykłym Linuxie.

Odrzucić obraz, jeśli wymaga:

- `--privileged`;
- hostowego Docker socketa;
- otwartego VNC bez auth;
- `seccomp=unconfined` bez uzasadnienia i testu alternatywy;
- taga `latest` bez przypiętej wersji/digestu.

**Gate H0:**

- użytkownik ręcznie otwiera Chromium i terminal przez webowy desktop;
- agent wykonuje polecenie i klika na tym samym ekranie;
- dane przeżywają restart kontenera.

---

# Faza H1 — jeden model Komputera bota

Usunąć wybór źródła komputera. **Nie tworzyć enumu z jednym wariantem** —
jeśli istnieje tylko hosted computer, tryb nie jest potrzebny.

### Zmiany danych

- usunąć `computer?: "cloud" | "local" | "playwright" | "shared" | "off"`
  z aktywnego modelu bota (`server/store.ts:75`);
- stare wartości podczas migracji ignorować, traktować jako nowy hosted
  computer;
- bot bez pola również dostaje hosted computer;
- stare sekrety Box zachować na dysku, ukryć w UI;
- boty używające providera Computer/BoxAgent przenieść na bezpieczny
  domyślny model.

### Lifecycle

```
bot utworzony
    → computer provisioning
    → ready
    → watchdog
    → recovering przy awarii
    → ready albo error
```

Nie istnieje stan użytkowy `off`.

Jeśli proces umrze:

- panel pokazuje `Recovering…`;
- watchdog próbuje restartu;
- po wyczerpaniu prób pokazuje `Computer error`;
- **nigdy** nie zmienia ustawienia bota na `off`.

Na starcie MultiBota:

- odczytać wszystkich nieusuniętych botów;
- zapewnić jeden komputer dla każdego;
- usunąć osierocone kontenery **tylko** po jednoznacznym dopasowaniu do
  nieistniejących botów.

Na usunięcie bota:

- zatrzymać kontener;
- usunąć kontener;
- usunąć jego persistent volume po istniejącym potwierdzeniu usunięcia bota.

**Gate H1:**

- utworzenie bota automatycznie tworzy komputer;
- restart MultiBota przywraca kontener;
- zamknięcie panelu niczego nie zatrzymuje;
- nie ma żadnego `Off`.

---

# Faza H2 — pełny hosted desktop

Dodać minimalny manager, np. `server/hosted-computer.ts`. **Nie budować
rozbudowanej abstrakcji pod przyszłe providery.**

Każdy bot otrzymuje:

```
container: multibot-computer-<botHash>
volume:    multibot-computer-data-<botHash>
home:      /home/multibot
workspace: /workspace
display:   jeden trwały X11/XFCE display
```

W środku:

- Chromium;
- terminal graficzny;
- bash;
- podstawowe narzędzia plikowe;
- noVNC/VNC albo równoważny stream;
- CUA/computer server albo MCP sandboxa;
- katalog `Downloads`;
- trwały browser profile;
- workspace bota.

Porty kontenera:

- dynamiczne;
- związane wyłącznie z `127.0.0.1`;
- niewidoczne bezpośrednio dla klienta;
- proxy przez `/api/bots/:id/computer/*`.

Dodać limity CPU/RAM konfigurowalne według hosta. Brak zasobów daje
czytelny `Computer error`, **nie** silent fallback do browser-only.

**Gate H2:**

- agent otwiera Chromium;
- plik pobrany przez browser jest widoczny w terminalu;
- plik utworzony w terminalu jest widoczny w desktopie;
- cookies i pliki przeżywają restart;
- drugi bot ma całkowicie oddzielny profil.

---

# Faza H3 — jeden komputer dla wszystkich providerów

Jeden MCP computer musi trafić do każdego drivera.

**Claude** (`server/drivers/claude.ts`):

- zachować istniejący wzorzec montowania `mcpServers.computer`;
- zmienić target z Boxa/browser engine na hosted computer.

**Codex** (`server/drivers/codex.ts`):

- rozszerzyć `mcp_servers`, które obecnie zawierają tylko `agents`;
- dodać `computer`;
- przetestować screenshot, click, type, terminal i interrupt.

**ACP** (`server/drivers/acp/core.ts`):

- dodać ten sam komputer do `acpMcpServers`;
- testy dla Gemini/Grok/Kimi/Qwen zgodnie z dostępnymi driverami.

**Slafy** (`server/drivers/slafy.ts`, `engine/server/computer.py`):

- wyłączyć drugi, ukryty browser provider;
- routed computer tools mają iść do hosted computer;
- `off`/`local`/`cloud` nie mogą pozostawać jako nieegzekwowane stare tryby.

System prompt (miejsce: `server/index.ts:686-694`):

```
Masz własny trwały komputer.
Pulpit, Chromium, terminal i pliki należą do tego samego środowiska.
Najpierw wykonaj screenshot lub odczytaj accessibility tree.
Polecenia computer_exec działają wewnątrz komputera bota, nie na hoście.
```

**Gate H3:**

- identyczny test przechodzi dla Claude, Codex, ACP i Slafy;
- żaden provider nie ma dodatkowej, niewidocznej przeglądarki;
- agent widzi dokładnie ekran pokazany użytkownikowi.

---

# Faza H4 — ujednolicone UI

W obu obecnych miejscach (`src/components/ComputerPanel.tsx`,
`src/components/SettingsPanel.tsx:293-304`) usunąć selektory źródła.

Jedyna nazwa:

| Polski | Angielski |
|---|---|
| Komputer bota | Bot computer |
| Ekran bota | Bot screen |
| Uruchamianie komputera… | Starting computer… |
| Komputer gotowy | Computer ready |
| Przejmij sterowanie | Take control |
| Oddaj sterowanie | Hand back |
| Pełny ekran | Full screen |
| Nagraj skill | Record a skill |

Nie używać w UI: `Playwright`, `Bot browser`, `Shared browser`, `This Mac`,
`Cloud box`, `Local`, `Off`.

Panel:

- po otwarciu od razu łączy się ze streamem;
- ekran wykorzystuje cały dostępny obszar;
- kliknięcie lub `Full screen` otwiera pełnoekranowy widok;
- desktop i mobile dostają właściwe skalowanie współrzędnych;
- `Escape` zamyka fullscreen, ale **nie** komputer;
- stan połączenia nie zmienia lifecycle komputera.

---

# Faza H5 — takeover użytkownika

Dodać lease sterowania:

```
agent
  └─ domyślny właściciel wejścia

user kliknie Take control
  └─ user dostaje lease
  └─ agent nadal może oglądać ekran
  └─ agent nie może klikać/pisać

user kliknie Hand back
  └─ lease wraca do agenta
```

Endpointy:

```
POST /api/bots/:id/computer/control/acquire
POST /api/bots/:id/computer/control/renew
POST /api/bots/:id/computer/control/release
GET  /api/bots/:id/computer/control
```

Lease:

- krótki;
- odnawiany podczas aktywności;
- automatycznie zwalniany po rozłączeniu;
- jeden właściciel wejścia;
- screenshot zawsze dozwolony;
- agent dostaje stan `user_has_control`, nie losowy błąd narzędzia.

**Gate H5:**

- użytkownik loguje się na stronie;
- agent nie przejmuje klawiatury podczas takeover;
- po `Hand back` agent kontynuuje na tej samej stronie i sesji.

---

# Faza H6 — Record a skill

**Nie pisać od początku.** MultiBot już ma:

- `src/components/SkillsPanel.tsx:131` — `TeachCard`
- `engine/server/teach.py:196` — `start`
- `engine/server/teach.py:216` — `stop`
- `engine/server/teach.py:273` — `synthesize`
- tworzenie skilla przez istniejący `skill_manage`

Zmiany:

1. Przenieść lub współdzielić `TeachCard` z panelem Computer.
2. Nazwać akcję `Record a skill`.
3. Start nagrywania automatycznie przejmuje user-control lease (H5).
4. Dla Chromium nadal zbierać DOM/CDP selektory.
5. Dla pulpitu zbierać accessibility element, app/window, click, key,
   scroll i zmianę ekranu.
6. Współrzędne traktować jako fallback.
7. Po zatrzymaniu pokazać transcript przed wysłaniem do modelu.
8. Dopiero po akceptacji wygenerować skill istniejącym systemem.
9. Zapisać źródło i datę nagrania w metadanych skilla.

## Krytyczna poprawka bezpieczeństwa

`engine/server/teach.py:97` zapisuje dziś pełne `input.value`:

```js
document.addEventListener("input", (e) => send("input", e.target, { value: (e.target && e.target.value) || "" }), true);
```

Nagra hasło, token albo numer karty. Wartość trafia dalej do transkryptu
(`engine/server/teach.py:246`) i do promptu syntezy.

Przed włączeniem funkcji:

- `input[type=password]` → `[REDACTED]`;
- pola z nazwą `password`, `token`, `secret`, `apiKey`, `card`, `cvv`
  → `[REDACTED]`;
- nie nagrywać clipboardu;
- pozwolić użytkownikowi usunąć krok;
- **nigdy** nie wkładać sekretu do `SKILL.md`.

**Gate H6:**

- demonstracja tworzy skill;
- skill przeżywa restart;
- test z polem hasła potwierdza brak wartości w pliku, transkrypcie
  i promptach.

---

# Faza R1 — rutyny bez Custom

W `src/components/RoutinesPanel.tsx:54` usunąć `custom`. Pozostawić:

```
Hourly
Daily
Weekly
Monthly
```

Dodać parser cron → preset:

```
M * * * *       → hourly
M H * * *       → daily
M H * * D       → weekly
M H DAY * *     → monthly
```

Edycja istniejącej rutyny ma rozpoznać preset. Obecnie
`src/components/RoutinesPanel.tsx:81` robi
`useState<ScheduleMode>(routine ? "custom" : "daily")` — to jest
bezpośrednia przyczyna problemu.

Nietypowe stare harmonogramy:

- zachować bez zmiany;
- nigdy nie pokazywać surowego crona na karcie;
- podczas edycji wymagać wyboru jednego z czterech presetów;
- anulowanie edycji zachowuje stary harmonogram.

Agentowe `create_routine` powinno dostać strukturę:

```
cadence: hourly | daily | weekly | monthly
minute
time
weekday
monthDay
```

Backend nadal może zapisywać cron, ale agent i UI nie operują na surowym
cron-stringu.

Karta:

```
Skan rynku AI — Agent Rozwoju…
Co tydzień w piątek o 17:00
Następne uruchomienie: piątek, 21 sierpnia 2026, 17:00
Jeszcze nie uruchomiono
```

Formatować przez `Intl.DateTimeFormat`. Wykorzystać istniejące `nextRunAt`
z `server/routines.ts:17` (liczone w `:129`, `:151`, `:155`, `:197`).

**Gate R1:**

- żadnego `Custom`;
- żadnego `0 17 * * 5` na karcie;
- `monthly` działa;
- polski i angielski opis;
- istniejąca rutyna ze screena pokazuje piątek i godzinę 17:00.

---

# Faza A1 — Firebase Google login

Korekta pojęć: **Google OAuth obsługuje Firebase Authentication.**
Firestore jest bazą danych i nie jest wymagany do samego logowania.

Wzorce do wykorzystania z TaskTree:

- `G:/Projects/TASKTREE/memory/src/firebase.ts`
- `G:/Projects/TASKTREE/memory/src/lib/auth-flow.ts`
- `G:/Projects/TASKTREE/desktop/electron/main.cjs:194` — Electron OAuth

**Nie kopiować:** TaskTree Firebase config, OAuth client ID, client secret,
`google-services.json`, Firestore rules. Zalecenie: osobny projekt Firebase
MultiBot, albo przynajmniej osobne aplikacje i OAuth clients.

Klienci:

- web/PWA: Firebase web auth;
- Expo: native Google Sign-In → `GoogleAuthProvider.credential`;
- Electron: system browser + loopback callback + `state` + `nonce` + PKCE.

Serwer:

1. Klient pobiera Firebase ID token.
2. Wysyła go do `POST /api/auth/firebase/session`.
3. Harness weryfikuje token.
4. Sprawdza UID właściciela.
5. Tworzy lokalną sesję urządzenia.
6. Ustawia `HttpOnly`, `Secure`, `SameSite=Strict` cookie.
7. HTTP, SSE i WebSocket korzystają z cookie.

Nie wstrzykiwać długoterminowego tokena do każdego `fetch`. Cookie rozwiązuje
też uwierzytelnienie WebSocketu.

Pierwszy właściciel:

- przypisanie UID tylko z loopbacka albo po lokalnym jednorazowym kodzie;
- **nie** stosować zasady „pierwszy użytkownik z Internetu zostaje
  właścicielem".

Migracja: obecny bearer token (`server/index.ts:1586-1597`, `server/auth.ts`)
działa jako awaryjna metoda odzyskania; po poprawnym Google loginie może
zostać wyłączony; sesje urządzeń można osobno unieważniać
(`revokeAuthSessions`, `server/index.ts:1910`).

Firestore:

- opcjonalnie profil i lista urządzeń;
- boty, wiadomości, pliki, komputery, klucze i rutyny nadal self-hosted;
- MultiBot nie może przestać działać tylko dlatego, że Firestore jest
  niedostępny.

---

# Faza C1 — Expo mobile

Zachować architekturę z `PLAN-CLIENTS.md`. Katalog `clients/` jest dziś pusty.

```
clients/mobile/
  własny package.json
  własny lockfile
  Expo
  react-native-webview
  expo-secure-store
  expo-camera
  expo-notifications
```

Flow:

1. Dodaj host.
2. Skan QR zawierającego URL i jednorazowy kod.
3. Zaloguj przez Google.
4. Powiąż urządzenie z hostem.
5. Odbierz hostową session cookie.
6. Otwórz WebView.
7. Renderuj pełny istniejący UI.
8. Computer fullscreen i takeover obsługuje dotyk.
9. Push otwiera właściwego bota.

Telefon jest klientem. Host z pełnym komputerem wymaga Windows/Linux/VPS
z Dockerem.

---

# Faza C2 — Electron desktop

**Nie tworzyć nowej aplikacji.** Rozszerzyć istniejący shell (`electron/`):

- lokalny host;
- zdalny host;
- Google login przez system browser;
- session storage przez `safeStorage`;
- przełączanie hostów;
- pełny Computer takeover;
- ten sam instalator Windows/macOS/Linux (`electron-builder.yml`).

Electron nie powinien sterować fizycznym pulpitem hosta w pierwszej wersji.
`This Mac` (`electron/cua.mjs`) pozostaje odłożone.

---

# Faza Q — testy końcowe

### Lifecycle

- create bot → container provisioning;
- restart harness → container reused;
- crash container → automatic recovery;
- delete bot → container i volume usunięte;
- zamknięcie panelu → container nadal działa.

### Izolacja

- Bot A nie widzi cookies, plików ani procesów Bota B;
- porty tylko loopback;
- brak Docker socketa;
- limity CPU/RAM;
- traversal i obce bot ID odrzucane.

### Providerzy

Claude, Codex, ACP, Slafy. Każdy wykonuje:

```
computer screenshot
open browser
click
type
run terminal command
create file
```

### Takeover

Użytkownik przejmuje → agent czeka → użytkownik oddaje → agent kontynuuje.

### Record a skill

Nagranie, transcript, redakcja hasła, synteza, ponowne wykonanie skilla.

### Routines

hourly/daily/weekly/monthly; parser istniejącego crona; brak Custom;
lokalizowane daty; `nextRunAt`.

### Auth i klienci

Google login web/Expo/Electron; zły UID odrzucony; unieważnione urządzenie
traci HTTP/SSE/WS; Computer stream nie działa bez sesji; Expo i Electron
otwierają ten sam bot.

### Końcowe polecenia

```
pnpm test
pnpm typecheck
pnpm build
pnpm build:server
node scripts/selfhost-check.mjs
cd engine && .venv\Scripts\python.exe -m pytest tests
```

---

# Odłożone świadomie

Dodane do TaskTree jako osobne zadania:

- Cloud Computer;
- sterowanie fizycznym komputerem hosta;
- Shared Computer;
- prawdziwy Windows VM jako komputer bota.

Windows VM wraca dopiero po stabilnym Linux desktop. Cloud wraca po
działającym lokalnym lifecycle. Shared wraca po poprawnym lease i izolacji
jednego komputera.

---

# Definition of Done

Projekt skończony, gdy:

1. Każdy bot automatycznie dostaje własny komputer.
2. Nie istnieje `Off`.
3. Nie ma wyboru źródła komputera.
4. UI wszędzie mówi `Komputer bota`.
5. Komputer ma pełny pulpit, terminal, Chromium i pliki.
6. Agent i użytkownik widzą ten sam ekran.
7. Użytkownik przejmuje i oddaje sterowanie.
8. Komputer przeżywa restart aplikacji.
9. Codex, Claude, ACP i Slafy naprawdę nim sterują.
10. `Record a skill` tworzy bezpieczny skill z demonstracji.
11. Rutyny mają tylko Hourly/Daily/Weekly/Monthly i czytelne daty.
12. Web, Electron i Expo logują przez Google i obsługują Computer.
13. Żaden port komputera nie jest publiczny.
14. Wszystkie testy są zielone.
