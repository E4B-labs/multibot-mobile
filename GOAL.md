# GOAL — Multibot, runda G (self-host 24/7 + przebudowa providerów)

> Plik jest samowystarczalny: wykonawca dostaje go na zimno, bez historii rozmowy.
> Wszystko, czego potrzebuje, jest tutaj albo wskazane ścieżką w repo.

---

## 0. Prompt do wklejenia

```
/goal Wykonaj plan z GOAL.md w repo G:\Projects\multibot — fazy G1..G7 po kolei,
każda z własnym gate'em. Przed pierwszą linią kodu przeczytaj CAŁY GOAL.md, potem
zweryfikuj w kodzie każdy fakt z sekcji "Krytyczne pliki" (numery linii mogły się
przesunąć — szukaj po kontekście, nie po numerze). Pracuj subagentami: backend na
Opusie, frontend na Fable. Subagenty NIE commitują — commituje integrator po
przejściu gate'u. Po każdej fazie: pełny pytest silnika + vitest harnessa + typecheck
+ build, potem commit i push na main. Nie pytaj o zgodę na rzeczy opisane w planie.
Zatrzymaj się tylko wtedy, gdy plan jest sprzeczny z tym, co widzisz w kodzie —
wtedy opisz sprzeczność i zaproponuj rozstrzygnięcie.
```

---

## 1. Co to jest

**Multibot** = prywatny fork [OpenMausBot](https://github.com/milind-soni/OpenMausBot) (MIT)
z wbudowanym silnikiem agentowym z projektu slafy-bot.

- Repo: `G:\Projects\multibot`, origin `github.com/clewkord/multibot` (prywatne), remote `upstream` na milind-soni.
- Trzy procesy w dev:
  - `pnpm dev:engine` — silnik Python (FastAPI) na `127.0.0.1:8700`, kod w `engine/`
  - `pnpm dev:server` — harness Node/TypeScript na `127.0.0.1:8799`, kod w `server/`
  - `pnpm dev` — interfejs React (vite) na `127.0.0.1:5199`, kod w `src/`
- Stan: fazy F0–F11 poprzedniej rundy zamknięte. Testy: **269 pytest** (`engine/`), **135 vitest** (`server/`). CI zielone (`.github/workflows/ci.yml` ich, `engine.yml` nasz).
- Mapa funkcji i konwencji: `MULTIBOT.md`.

**Kluczowa zasada odziedziczona z poprzedniej rundy:** frontend i styl są ICH.
Zmiany w plikach upstreamu wyłącznie małymi, addytywnymi blokami oznaczonymi
komentarzem `// multibot:`. `server/contracts.ts` — zero zmian. Zero nowych
zależności npm. Nowe pliki bez kolizji nazw z upstreamem.

---

## 2. Twarde zasady wykonania

1. **Nigdy nie zapisuj niczego na dysk C:.** Temp = `D:\tmp`. W komendach ustawiaj `TMP`/`TEMP` na `D:\tmp`, `PLAYWRIGHT_BROWSERS_PATH` na `D:\tmp\pw-browsers`, a przy uruchamianiu harnessa `USERPROFILE` na katalog pod `D:\tmp`, żeby nie dotknąć prawdziwego `~/.openmausbot`. Jeśli narzędzie umie pisać tylko na C: — zatrzymaj się i powiedz, nie pisz.
2. **Subagenty nie commitują.** Integrator commituje po gate'cie. Commit message konwencjonalny (`feat:`, `fix:`), po polsku, ze stopkami `Co-Authored-By` i `Claude-Session`.
3. **Skan sekretów przed każdym pushem.** Blokuje: `sk-`, `ghp_`, `AKIA`, `BEGIN … PRIVATE KEY`, pliki `.env`, cokolwiek powyżej 50 MB. Na trafienie: stop, nie pushuj, powiedz co i gdzie.
4. **Auto-push na `main`** po każdym zamkniętym gate'cie (repo należy do właściciela).
5. **Sekrety użytkownika** (klucze API, token dostępu) żyją w `~/.openmausbot/config.json` albo w `.env` profilu silnika. Nigdy w repo, nigdy w logach, nigdy w odpowiedzi katalogu integracji.
6. **Testy muszą zostać zielone.** Każdy gate: `cd engine && .venv/Scripts/python.exe -m pytest -q --basetemp='D:\tmp\pytest-<faza>'`, `pnpm test`, `pnpm typecheck`, `pnpm build`.
7. `test_browser_provider.py::test_session_lifecycle` bywa flaky pod pełną suitą — jak padnie, powtórz solo, zanim uznasz za regresję.

---

## 3. Czego chce właściciel (13 wymagań, dosłownie)

Zebrane z dyktowanej listy. Numeracja używana dalej w fazach.

| # | Wymaganie |
|---|---|
| W1 | W górnym pickerze modeli **nie ma pozycji „Slafy Engine”**. Silnik nie jest osobnym vendorem obok Claude/Codex/Grok. |
| W2 | W ustawieniach bota **nie ma karty „Local Engine (BYOK)”** z listą openrouter/anthropic/openai/custom. |
| W3 | W **ustawieniach aplikacji** mogę: włączać (allow) różne CLI, oraz dodać własny model przez **sam „custom”** — klucz + adres + identyfikator modelu, zapisać. Po zapisie ten model **pojawia się w górnym pickerze** jako do wybrania. Bez listy nazwanych providerów. |
| W4 | Boty na CLI (Claude Code, Codex) **nie mają w interfejsie napisów o Hermes Agencie ani Slafy Engine**. Silnik ma być zmergowany „pod spodem”, nie osobnym bytem z własną marką. |
| W5 | Onboarding przy pierwszym wejściu: **skan urządzenia** (co to za maszyna) i pytanie, **czy postawić na tym urządzeniu serwer bota chodzący 24/7**. Po „tak” widać **przepływ instalacji na żywo**. |
| W6 | Onboarding: nick + e-mail (już istnieje) oraz **wykrywanie i instalowanie CLI** — nie tylko wykryte, ale też „zainstaluj mi to CLI”. |
| W7 | Onboarding: opcja **podpięcia Hermes Agenta** do całości. |
| W8 | **Więcej CLI vendorów**: Kimi CLI / Kimi Code i inne dostępne. |
| W9 | **Modele lokalne** — działa przez custom base URL, ma zostać i być czytelne. |
| W10 | **Każdy bot ma swój wirtualny komputer**, a dodatkowo **wszystkie boty mają jeden wspólny komputer**. |
| W11 | Instaluję Multibota **raz, na jednym urządzeniu** (telefon, mini-PC, VPS). To urządzenie chodzi **24/7**. |
| W12 | Dostęp do tych botów **z aplikacji na telefonie** i **z aplikacji na komputerze**, po zalogowaniu. Każda funkcja ma działać zdalnie. |
| W13 | Instalacja ma być **bardzo łatwa** — jedna komenda albo instalator, reszta sama. |

---

## 4. Interpretacja i decyzje architektoniczne

Rozstrzygnięcia podjęte przed napisaniem planu. Wykonawca ich nie renegocjuje,
chyba że kod jawnie im przeczy.

### D1. „Custom model” = nazwana instancja na driverze `slafy`

Mechanizm już istnieje i nie wymaga nowego magazynu danych.
`server/config.ts` → `instanceConfigs(cfg)` czyta `cfg.instances` i wstrzykuje
`environment` per instancja (wzorzec: `cfg.xai.key`). Zapis własnego modelu =
wpis w `cfg.instances`:

```jsonc
"kimi-k2": {
  "driver": "slafy",
  "displayName": "Kimi K2",              // nazwa widoczna w pickerze
  "environment": { "OPENAI_API_KEY": "…" },
  "model": { "default": "moonshot/kimi-k2", "baseUrl": "https://…/v1" }
}
```

Driver `slafy` przy `ensureBot` popycha te wartości do profilu bota w silniku
istniejącą trasą `PUT /api/bots/{id}/provider` (kształt: `provider`, `api_key`,
`base_url`, `model`). Backend silnika zostaje bez zmian — cztery providery
(`openrouter|anthropic|openai|custom`) żyją dalej po stronie API, tylko UI
pokazuje wyłącznie `custom`. To jest świadome: mniej UI, zero migracji danych.

**Cztery pułapki, wszystkie obowiązkowe:**

1. **`instanceConfigs()` podmienia, nie scala.** Dziś: jeśli `cfg.instances` jest
   niepuste, domyślna flota (claude/codex/grok/gemini/computer) **znika**. Zapis
   pierwszego custom modelu wywaliłby więc wszystkie CLI z pickera. Zmień na
   nakładkę: domyślna flota zawsze bazą, `cfg.instances` scalane na wierzch.
   To dotyka wszystkich testów harnessa, które bootują przez tę ścieżkę.
2. **Migracja żywych botów.** W `~/.openmausbot/bots.json` istnieją boty z
   `modelSelection.instanceId: "slafy"`. Usunięcie instancji `slafy` z floty
   osieroci je (picker pokazuje pustkę, czat martwy). Przy starcie: jeśli bot
   celuje w nieistniejącą instancję, przepnij go na pierwszy custom model, a gdy
   żadnego nie ma — na pierwszą dostępną instancję i zostaw czytelny stan pusty.
3. **Skąd bierze się `displayName`** widoczne w `/api/instances` — dziś to
   „Slafy Engine”, prawdopodobnie stała w driverze. Nazwa per instancja z configu
   jest sednem funkcji, więc znajdź to miejsce i przepuść nazwę z configu.
4. **`driverKind: "slafy"` zostaje jako string wewnętrzny.** Wszystkie bramki w
   `src/` i testy trzymają się tej wartości. Zmieniamy wyłącznie etykiety widoczne
   dla człowieka. Zmiana samego identyfikatora to czysty koszt bez zysku.

### D2. W4 to odbrandowanie, nie uniwersalizacja funkcji

Wymaganie mówi o **napisach**. Zakres: wymieść z UI ciągi „Slafy Engine”,
„Local Engine (BYOK)”, „Slafy engine”, „Hermes Agent (BYOK)”, „engine” tam,
gdzie brzmi jak osobny produkt. Zostaje neutralne słownictwo („Bot browser”,
„Memory”, „Routines”).

**Nie budujemy** w tej rundzie pamięci i rutyn dla botów na CLI — właściciel o to
nie prosił, a rutyny dla bota na claude wymagają, żeby silnik oddzwaniał do
harnessa po turę. To osobna, duża robota. Zapisana jako punkt odłożony (§8).
Jedyna funkcja cross-driver, o którą prosi wprost, to komputer — i ta już działa
dla claude/codex przez most narzędziowy z fazy F5.

### D3. Onboarding — w większości montaż z istniejących klocków

`src/components/Onboarding.tsx` ma dziś trzy kroki: krok 0 nick + e-mail,
krok 1 wykryte CLI, krok 2 uprawnienia (tylko Electron).

Docelowa kolejność wg dyktowania:

```
0. Skan urządzenia  →  „Postawić tu serwer 24/7?”   [NOWE]
1. Nick + e-mail                                     [JEST]
2. CLI: wykryte + „Zainstaluj”                       [ROZSZERZYĆ]
3. Własny model (custom) — opcjonalnie               [PRZEROBIĆ z karty BYOK]
4. Uprawnienia (Electron)                            [JEST]
```

- **Skan urządzenia**: `os.hostname()`, platforma, architektura, RAM, czy jest Python, czy jest Docker. Nowa trasa w harnessie, np. `GET /api/device`.
- **Instalacja serwera z podglądem**: `scripts/provision-engine.mjs` już to robi (faza F11) i jest idempotentny per krok. Nowość to wyłącznie **strumień postępu do UI** — SSE albo kanał `/api/events`, i ekran z listą kroków.
- **Instalacja CLI**: przycisk per CLI odpalający udokumentowaną komendę instalacji, z tym samym strumieniem wyjścia. Komendy trzymaj w metadanych drivera, nie w komponencie.
- **W7 (Hermes)**: import profili Hermesa już istnieje — `POST /api/engine/import/inspect` i `POST /api/engine/import`, UI w `AppSettingsPanel`. W onboardingu wystarczy skrót do tego samego przepływu.

### D4. Nowe CLI — tylko te, które mówią po ACP

`server/drivers/acp/core.ts` daje generyczny runtime protokołu Agent Client
Protocol. Dodanie CLI = obiekt `AcpSupport` na jakieś 50 linii; wzorzec do
skopiowania: `server/drivers/acp/grok.ts`. Windowsowe shimy `.cmd` obsługuje już
`resolveCliSpawn` z `server/env-path.ts` (faza F1), więc nowe CLI dostają
poprawne uruchamianie za darmo.

**Najpierw research, dopiero potem obietnice.** Dla każdego kandydata sprawdź w
oficjalnej dokumentacji, czy wspiera ACP (szukaj „agent client protocol”, „acp”,
„agent stdio”). Kandydaci do sprawdzenia: **Kimi CLI / Kimi Code**, opencode,
crush, qwen-code, iflow. CLI bez ACP: **odłóż i wypisz** w raporcie zamiast
dopisywać własny protokół.

### D5. Komputery — jeden na bota plus jeden wspólny (W10)

Per-bot już działa (faza F5): profil przeglądarki pod
`engine-data/profiles/<bot>/browser`, tryb „Bot browser” w panelu Computer.

Wspólny: poprzedni projekt miał współdzieloną przeglądarkę — patrz
`engine/tests/test_tier2.py` (profil `shared`, asercja „jeden proces chromium”).
**Sprawdź, co z tego przetrwało w `engine/server/computer.py`**, zanim cokolwiek
napiszesz; to prawdopodobnie głównie okablowanie: stały identyfikator profilu
`shared`, piąta opcja w „Runs on”, plus decyzja o równoczesnym dostępie.

Silnik ma zamek chroniący przed dwoma chromium na jednym profilu, więc dwa boty
sięgające po wspólny komputer w tej samej chwili albo się ustawią w kolejce, albo
dostaną błąd. **Wybierz jedno i napisz to w interfejsie** — cicha serializacja
bez komunikatu jest gorsza niż jawna odmowa.

### D6. Dostęp zdalny — blokada bezpieczeństwa, nie do obejścia

**Harness nie ma dzisiaj żadnego uwierzytelniania, a boty mają narzędzie
terminala.** Wystawienie go (albo silnika) na adres inny niż loopback bez
logowania to zdalne wykonanie kodu dla każdego, kto jest w tej samej sieci.

Z tego wynika twardy porządek: **żadnego bindowania na `0.0.0.0`, dopóki nie
działa logowanie tokenem.** Wymagania minimalne:

- token sprawdzany na **każdej** trasie HTTP **oraz na obu ścieżkach upgrade'u WebSocket** (przelotka silnika i kanał komputera bota) — pominięcie WS to otwarte drzwi obok zamkniętych;
- **silnik zostaje na `127.0.0.1` zawsze**, wyłącznie za przelotką harnessa;
- harness sam serwuje zbudowane `dist/` — jeden port, jedno pochodzenie, żadnego vite w trybie zdalnym (to przy okazji likwiduje prowizorkę z osobnym portem);
- token generowany przy instalacji, pokazywany raz, trzymany w `config.json`; porównanie odporne na atak czasowy;
- pierwsze żądanie bez tokena: `401`, nie przekierowanie ujawniające istnienie zasobów.

**Aplikacja mobilna i desktopowa = PWA**, nie natywna. Manifest, ikony i service
worker serwuje harness; instaluje się z przeglądarki na telefonie i na
komputerze, ma własną ikonę i pełny ekran. Natywna aplikacja w sklepie to inny
rząd wielkości pracy dla tego samego efektu — jeśli właściciel będzie jej chciał,
to osobna runda.

**Dwa fakty o „bezpiecznym kontekście”, których nie wolno obejść:**
service worker (czyli instalowalność PWA) oraz mikrofon (czyli dyktowanie)
**nie działają po zwykłym `http://192.168.x.x`** — tylko na `localhost` albo po
HTTPS. Wniosek: dostęp po zwykłym HTTP w sieci lokalnej ma z definicji
okrojone dyktowanie i brak instalacji PWA, a **pełnoprawna droga zdalna to
Tailscale** (`tailscale serve` daje prawdziwy certyfikat i tożsamość urządzenia;
na maszynie właściciela Tailscale już jest, adres `100.82.124.117`).
Nie „naprawiaj” mikrofonu osłabianiem sprawdzeń — to nie jest błąd aplikacji.

---

## 5. Fazy

Kolejność jest celowa: **G1 pierwsza**, bo to jest dokładnie to, na co właściciel
patrzy w aplikacji i co dziś nie zgadza się z jego wyobrażeniem.

---

### G1 — Providerzy: picker, custom model, odbrandowanie (W1, W2, W3, W4, W9)

Backend (Opus) i frontend (Fable) równolegle, wspólny gate.

**Backend**
- `server/config.ts`: `instanceConfigs()` na nakładkę zamiast podmiany (pułapka D1.1); wsparcie dla `displayName`, `model.baseUrl` i `model.default` per instancja.
- Usunięcie `slafy: { driver: "slafy" }` z domyślnej floty (W1).
- Trasy zarządzania własnymi modelami w `server/index.ts` (blok `// multibot:`): `GET` listy, `PUT /api/models/custom/:id`, `DELETE /api/models/custom/:id`. Walidacja identyfikatora, odrzucanie nazw zarezerwowanych, klucz nigdy nie wraca w odpowiedzi.
- `server/drivers/slafy.ts`: `displayName` i katalog modeli z konfiguracji instancji; przy `ensureBot` push konfiguracji providera do silnika (`provider: "custom"` + `base_url` + `model`).
- Migracja osieroconych botów przy starcie (pułapka D1.2), z testem.

**Frontend**
- Usunięcie karty BYOK z ustawień bota (W2) — plik `src/components/EngineProvider.tsx` znika albo zostaje przerobiony na formularz w ustawieniach aplikacji.
- `AppSettingsPanel`: sekcja **Models** — lista własnych modeli (nazwa, adres, model, klucz zamaskowany), formularz dodawania (nazwa, base URL, model id, klucz), usuwanie. Po zapisie model widoczny w górnym pickerze (W3).
- `AppSettingsPanel`: sekcja **Command-line tools** — lista CLI z wykrytym stanem i włącznikiem „allow” (W3, przygotowanie pod G3).
- Odbrandowanie (W4): wymieść z `src/` napisy „Slafy”, „Hermes Agent”, „Local Engine”, „engine” w roli nazwy własnej. Zostawić neutralne.

**GATE G1**
- Górny picker: brak „Slafy Engine”; po dodaniu własnego modelu pojawia się on pod nadaną nazwą i da się go wybrać.
- Bot przełączony na własny model prowadzi rozmowę (można na atrapie modelu z `engine/tests/mock_llm.py`, jeśli nie ma klucza).
- Istniejące boty z `instanceId: "slafy"` po restarcie nadal działają (migracja).
- Grep po `src/` nie znajduje „Slafy”, „Hermes Agent” ani „Local Engine” w tekstach widocznych dla użytkownika.
- 269 pytest, 135+ vitest, typecheck, build — zielone.

---

### G2 — Uwierzytelnianie i jedno pochodzenie (fundament pod W11, W12)

**Bez tej fazy nie wolno wystawić niczego poza loopback.**

- `server/auth.ts` (nowy): token z `config.json`, porównanie stałoczasowe, middleware dla wszystkich tras HTTP i dla obu ścieżek upgrade'u WebSocket. Wyjątki tylko dla `/api/health` i zasobów statycznych logowania.
- Tryb zdalny: harness serwuje `dist/` (zbudowany interfejs) z tego samego portu; `/api` i WS na tym samym pochodzeniu.
- Ekran logowania (jeden input z tokenem, zapamiętanie w `localStorage`), `401` obsłużony globalnie w warstwie zapytań frontendu.
- `ENGINE_URL` i sam silnik zostają na `127.0.0.1` — test to pinuje.
- Generowanie tokena przy pierwszym starcie, wypisane raz w konsoli i widoczne w ustawieniach aplikacji z przyciskiem „pokaż” i „wygeneruj nowy”.

**GATE G2**
- Żądanie bez tokena: `401` na HTTP i zerwane połączenie na obu ścieżkach WS (test).
- Z tokenem: pełna funkcjonalność, w tym podgląd komputera bota i przejęcie sterowania.
- Silnik nieosiągalny spoza loopbacku (test).
- Rotacja tokena unieważnia stare sesje.

---

### G3 — Onboarding: skan urządzenia, serwer 24/7, instalacja CLI (W5, W6, W7, W8, W13)

- `GET /api/device`: nazwa maszyny, platforma, architektura, RAM, obecność Pythona i Dockera, czy silnik już zainstalowany.
- Nowy krok 0 w onboardingu: podsumowanie urządzenia + pytanie „postawić tu serwer chodzący cały czas?”. Po „tak” — uruchomienie `scripts/provision-engine.mjs` i **widoczny na żywo postęp** (kroki: pobranie Pythona, zależności, silnik agentowy, przeglądarka), z możliwością zwinięcia i dokończenia w tle.
- Krok CLI: przy każdym niewykrytym CLI przycisk „Zainstaluj” odpalający udokumentowaną komendę, ze strumieniem wyjścia w tym samym komponencie postępu. Komendy w metadanych drivera.
- Krok Hermes (W7): skrót do istniejącego importu profili.
- Nowe drivery ACP (W8) — po researchu z D4; każdy jako osobny plik w `server/drivers/acp/` plus rejestracja w `builtIn.ts` i wpis w domyślnej flocie.

**GATE G3**
- Świeży profil (`USERPROFILE` na katalog pod `D:\tmp`): onboarding przechodzi od skanu do działającego bota.
- Instalacja serwera pokazuje realny postęp i przeżywa zamknięcie panelu.
- Co najmniej jedno nowe CLI wykrywane i uruchamialne (albo raport, dlaczego żadne z kandydatów nie spełnia D4).

---

### G4 — Wspólny komputer (W10)

- Sprawdzenie, co ze wspólnej przeglądarki przetrwało (D5), i uzupełnienie braków.
- Piąta opcja w „Runs on”: **Shared browser** — jeden profil dla całej floty.
- Jawna obsługa równoczesnego dostępu: kolejka albo odmowa, komunikat w interfejsie.
- Podgląd na żywo i przejęcie sterowania działają tak samo jak dla komputera per bot.

**GATE G4**
- Dwa boty korzystają ze wspólnego komputera: logowanie wykonane przez jednego jest widziane przez drugiego.
- Równoczesna próba kończy się zachowaniem opisanym w interfejsie, nie zawieszeniem.
- Komputer per bot dalej działa niezależnie.

---

### G5 — PWA: aplikacja na telefon i na komputer (W12)

- `manifest.webmanifest`, ikony (źródło: `docs/branding/`), service worker: powłoka aplikacji z pamięci podręcznej, dane zawsze z sieci.
- Układ mobilny: lista botów jako pierwszy ekran, panele na pełną szerokość, obszary dotykowe.
- „Zainstaluj aplikację” w ustawieniach z instrukcją per przeglądarka.
- Utrzymanie sesji: token przeżywa restart aplikacji.

**GATE G5**
- Instalacja na telefonie z ekranu przeglądarki, ikona na pulpicie, uruchomienie w trybie pełnoekranowym, zalogowanie tokenem, rozmowa z botem.
- To samo jako aplikacja na komputerze.
- Dyktowanie działa po HTTPS (Tailscale), a po zwykłym HTTP komunikuje wprost, dlaczego jest niedostępne.

---

### G6 — Instalacja jedną komendą (W11, W13)

- Skrypt instalacyjny dla trzech scenariuszy: Windows (instalator z fazy F11), Linux/VPS (Docker, `engine/Dockerfile` istnieje), Android/Termux (`engine/scripts/termux-install.sh`).
- Tryb serwera: harness + silnik jako usługa (systemd na Linuksie, Zadanie Harmonogramu na Windowsie, `termux-services` na Androidzie), start po restarcie urządzenia.
- Instrukcja `tailscale serve` jako zalecana droga dostępu z zewnątrz.
- Wypisanie tokena i adresu po instalacji.

**GATE G6**
- Na czystym urządzeniu: jedna komenda, po niej działający serwer i adres z tokenem do wklejenia w aplikacji.
- Restart urządzenia: serwer wstaje sam, rutyny lecą dalej.

---

### G7 — Domknięcie

- Aktualizacja `MULTIBOT.md` i mapy funkcji.
- Drill scalenia z upstreamem (`git fetch upstream && git merge upstream/main`) — policz konflikty, napraw.
- Test offline: model lokalny, tryb samolotowy, czat plus pamięć plus rutyny.
- Przegląd kodu całej rundy.

---

## 6. Krytyczne pliki

Numery linii mogą się przesunąć — szukaj po kontekście.

| Ścieżka | Co tam jest |
|---|---|
| `server/config.ts` | `instanceConfigs()` — domyślna flota i wstrzykiwanie `environment`; **pułapka podmiany zamiast scalania** |
| `server/index.ts` | wszystkie trasy harnessa, montaż przelotki silnika, obsługa `upgrade` dla WS, katalog integracji |
| `server/drivers/builtIn.ts` | rejestr driverów — dodanie CLI to jedna linia |
| `server/drivers/acp/core.ts` | generyczny runtime ACP |
| `server/drivers/acp/grok.ts` | wzorzec obiektu `AcpSupport` do skopiowania dla nowego CLI |
| `server/drivers/slafy.ts` | driver silnika: `ensureBot`, mapowanie zdarzeń, konfiguracja providera |
| `server/env-path.ts` | `resolveCliSpawn` — poprawne uruchamianie CLI na Windows |
| `server/engine/proxy.ts` | przelotka `/api/engine/*` i pipe WebSocket |
| `server/engine/supervisor.ts` | wybór interpretera i podnoszenie silnika |
| `server/store.ts` | `BotRecord`, w tym `computer` i `resumeCursors` |
| `src/components/ModelPicker.tsx` | górny picker instancji i modeli |
| `src/components/AppSettingsPanel.tsx` | ustawienia aplikacji — tu lądują Models i Command-line tools |
| `src/components/Onboarding.tsx` | trzy istniejące kroki pierwszego uruchomienia |
| `src/components/ComputerPanel.tsx` | tryby komputera, podgląd na żywo, przejęcie sterowania |
| `src/state/store.tsx` | stan aplikacji, flagi paneli, warstwa zapytań |
| `engine/server/app.py` | wszystkie trasy silnika |
| `engine/server/computer.py` | przeglądarka bota, profile, wejścia |
| `engine/tests/test_tier2.py` | ślad po wspólnej przeglądarce |
| `scripts/provision-engine.mjs` | instalacja runtime'u silnika, idempotentna per krok |
| `engine/Dockerfile` | silnik na serwerze |

---

## 7. Ryzyka

1. **Scalanie floty instancji** (G1) — dotyka ścieżki, przez którą bootuje każdy test harnessa. Zmiana najpierw, testy zaraz po niej.
2. **Osierocone boty** (G1) — bez migracji właściciel traci dostęp do dwóch istniejących rozmów. Test obowiązkowy.
3. **Uwierzytelnianie a WebSocket** (G2) — podgląd komputera i kanał zdarzeń idą upgrade'em; łatwo zabezpieczyć HTTP i zostawić WS otwarty. Test na obu ścieżkach.
4. **Instalacja CLI** (G3) — komendy instalacyjne różnią się per system i potrafią wymagać uprawnień. Nie podnoś uprawnień po cichu; brak uprawnień pokaż jako komunikat z komendą do samodzielnego uruchomienia.
5. **Bezpieczny kontekst** (G5) — dyktowanie i instalacja PWA po zwykłym HTTP nie zadziałają. To ograniczenie przeglądarek, nie błąd; komunikuj, nie obchodź.
6. **Wspólny komputer** (G4) — dwa boty na jednym profilu przeglądarki to realny konflikt. Rozstrzygnięcie musi być widoczne w interfejsie.

---

## 8. Świadomie odłożone

- Pamięć, rutyny i skille dla botów na CLI (wymaga oddzwaniania silnika do harnessa po turę).
- Natywna aplikacja mobilna w sklepach (PWA pokrywa wymaganie).
- Trwały transkrypt pokoju grupowego (silnik nie oznacza wypowiedzi grupowych w historii).
- Podpisanie instalatora Windows (brak certyfikatu; SmartScreen ostrzega).
- Automatyczna aktualizacja na Windows (`publish` wskazuje repozytorium upstreamu).
- OAuth dla własnych serwerów MCP.
- CLI bez wsparcia ACP.

---

## 9. Definicja ukończenia

Na czystym urządzeniu: jedna komenda stawia serwer, który chodzi po restarcie.
Właściciel wchodzi z telefonu i z komputera na jeden adres, loguje się tokenem,
dodaje własny model wpisując klucz i adres, wybiera go w pickerze, rozmawia z
botem, ogląda i przejmuje jego przeglądarkę, ustawia rutynę i widzi ją odpaloną
przy zamkniętej aplikacji. W interfejsie nie ma słowa „Slafy” ani „Hermes”.
