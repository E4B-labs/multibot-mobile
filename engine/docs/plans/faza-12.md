# Faza 12 — Stary telefon (Termux) + Tier 2 computer — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Task 1 (Tier 2, **Opus 5**) + Task 2 (Termux, **Opus 5**) RÓWNOLEGLE —
> niezależne pliki. Task 3 gate. Subagenty NIE commitują.

**Goal (gate PLAN.md §5 fazy 12):** "Full app runs on Android/Termux;
documented". Wiersz A: "Termux install path like hermes-config setup".
Tier 2 (PLAN.md §4.3): "shared headless browser (or Android WebView), no
per-bot VM; **honest degradation, same API**".

**Architecture:** Tier 2 = przełącznik `SLAFY_COMPUTER_TIER=2` w NASZYM
providerze `slafy`: JEDEN współdzielony headless chromium (user_data_dir w
katalogu danych, nie per profil), `create_session` każdego bota zwraca ten sam
`cdp_url` — komputery botów działają, degradacja uczciwa: wspólne
ciasteczka/loginy (dokumentowana). API identyczne — computer.py/teach.py nie
wiedzą o tierze. Termux: skrypt instalacyjny + doc. REALIA Termuxa: Playwright
NIE wspiera Androida — na telefonie komputer bota jest niedostępny (UI już
obsługuje brak przeglądarki: teach/computer zwracają 404), czat/pamięć/rutyny/
pluginy działają w pełni. Tier 2 celuje w słabe maszyny x86/ARM Linux z
chromium (stary laptop, RPi), nie w sam Termux. Fizyczny telefon nietestowalny
w CI — weryfikacja skryptu w WSL Ubuntu (najbliższe środowisko), odnotować.

## Global Constraints

- ZAKAZ C:. Nie psuć 184 pytest + 4 spec Playwright.
- Tier 1 zostaje DOMYŚLNY — brak env/`1` = zachowanie dotychczasowe, żaden
  istniejący test nie może się zmienić.
- Skrypt Termux: idempotentny (ponowne odpalenie = update, nie błąd), zero
  interakcji (pkg -y), jasne komunikaty czego brakuje.

---

### Task 1 (Opus 5): Tier 2 — współdzielona przeglądarka w providerze

**Files:** Modify: `server/browser_plugin/provider.py`; Test: `tests/test_tier2.py`

- Przełącznik: env `SLAFY_COMPUTER_TIER` (czytany per wywołanie, nie przy
  imporcie — testy podmieniają env). `!= "2"` = dotychczasowa ścieżka 1:1.
- Tier 2 w `create_session`: jeden proces chromium HEADLESS na maszynę
  (`user_data_dir = <root HERMES_HOME BEZ profilu>/shared-browser` — uwaga:
  create_session działa pod scope profilu; root wyprowadź z env
  `SLAFY_DATA_DIR`/struktury ścieżki profilu — opisz wybór), launch przy
  pierwszym wywołaniu, kolejne boty dostają TEN SAM port/cdp_url; refcount
  sesji, `close_session` ubija proces dopiero przy zerze (ponytail: prosty
  licznik + lock wystarczy). `browser.json` KAŻDEGO profilu dostaje wspólny
  `cdp_url` (mostek CDP fazy 4 czyta per profil — ma działać bez zmian).
  Headless: `headless=True` w launch_persistent_context dla tieru 2 (Tier 1
  zostaje jak jest).
- Honest degradation w kodzie: komentarz + pole `"tier": 2` w zwracanym dict
  z create_session (nieużywane przez Hermesa — ignoruje nadmiarowe pola;
  przyda się w UI fazy 13).
- TDD (bez realnego chromium tam, gdzie się da; jeden test z realnym headless
  chromium dozwolony — wzorzec test_browser_provider.py, PLAYWRIGHT_BROWSERS_PATH
  na D:): tier != 2 nie zmienia ścieżki (istniejące testy zielone); tier 2:
  dwa boty dostają ten sam cdp_url, browser.json obu profili wskazuje wspólny
  adres, drugi create_session NIE spawnuje drugiego procesu, close pierwszego
  bota nie ubija przeglądarki drugiego (refcount), close ostatniego ubija.

### Task 2 (Opus 5): skrypt Termux + dokumentacja

**Files:** Create: `scripts/termux-install.sh`, `docs/TERMUX.md`; Modify: `README.md`

- `scripts/termux-install.sh` (bash, LF!): `pkg update -y; pkg install -y
  python nodejs-lts git rust binutils` (rust/binutils — koła pydantic/numpy na
  ARM bywają budowane; sprawdź minimalny zestaw, opisz), klon/pull repo do
  `~/slafy-bot`, `pip install` zależności serwera (BEZ playwright — Android
  nieobsługiwany; requirements zawężone: zbadaj czy import server.app przejdzie
  bez playwright — `server/browser_plugin` importuje playwright leniwie czy
  twardo? jeśli twardo w imporcie app, zrób import warunkowy z czytelnym
  komunikatem), `npm ci && npm run build` w ui/, start:
  `uvicorn server.app:app --host 0.0.0.0 --port 8700` + serwowanie zbudowanego
  ui (zbadaj najprostsze: uvicorn StaticFiles mount na dist/ za flagą env
  `SLAFY_SERVE_UI=1` — mała zmiana w app.py DOZWOLONA, opisz) + wpis
  `termux-wake-lock`. Idempotentny, `set -e`, komunikaty [slafy].
- `docs/TERMUX.md`: wymagania (Android 10+, ~2 GB wolne), krok po kroku,
  dostęp z przeglądarki telefonu (http://127.0.0.1:8700), ograniczenia UCZCIWIE:
  brak komputera bota na Termuxie (Playwright bez Androida), serwerowe STT
  wymaga klucza GROQ, edge-tts działa; Tier 2 = słabe maszyny z chromium (RPi/
  stary laptop), na nich `SLAFY_COMPUTER_TIER=2`. Sekcja "Weryfikacja bez
  telefonu": przebieg w WSL Ubuntu.
- README: sekcja "Stary telefon (Termux)" linkująca do docs/TERMUX.md.
- Test: `bash -n scripts/termux-install.sh` (składnia) w CI-stylu — dopisz do
  `tests/test_termux_script.py` prosty test wołający `bash -n` (git bash jest
  na maszynie) + asercje że skrypt nie zawiera `apt ` (Termux używa pkg) ani
  ścieżek `C:`.

### Task 3: Gate fazy 12

- Tier 2: pytest z Taska 1 zielone (realny współdzielony chromium headless).
- Termux: pełny przebieg skryptu w WSL Ubuntu (`wsl -d Ubuntu`) na ile się da
  (pkg→apt shim NIE — skrypt jest termuxowy; w WSL wykonaj RĘCZNIE te same
  kroki co skrypt: python venv + pip install zawężone + uvicorn start + curl
  /health i /api/bots) — dowód "full app runs" na ARM-oidalnym Linuxie bez
  Playwrighta. Jak WSL bez pythona/node — doinstaluj w WSL (to nie C:).
  Odnotuj w LOOP: fizyczny Android nietestowany, skrypt zweryfikowany
  składniowo + kroki w WSL.
- Pełny pytest + specy Playwright zielone. LOOP.md: wiersz A DONE (z
  ograniczeniem: komputer bota niedostępny na samym Termuxie — by design,
  PLAN §4.3 przewiduje degradację). FAZA: 13.
