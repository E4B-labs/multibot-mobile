# Faza 4 — Komputery botów (Tier 1) — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Backend: **Opus 5**; frontend: **Fable 5**. Task 1 → potem 2 (backend) i 3 (frontend)
> równolegle. Subagenty NIE commitują. FUNDAMENT: docs/reference/BROWSER-RECON.md —
> przeczytać W CAŁOŚCI przed każdym taskiem.

**Goal (gate PLAN.md §5 fazy 4):** per-bot przeglądarka + live view + take-over +
persistent logins: "Log into a site by take-over, bot continues session after restart".
UI-SPEC §3 (Computer card), §4 (Computer section), §8, §13 (handoff).

**Architecture:** Provider `slafy` (plugin browser Hermesa, BROWSER-RECON §Interfejs):
`create_session(task_id)` startuje Playwright **persistent context** z
`user_data_dir = profiles/<bot>/browser` i `--remote-debugging-port` → oddaje
`cdp_url` (HTTP discovery OK). Hermes napędza przeglądanie sam (toolset browser_* +
agent-browser CLI) — my NIE piszemy nawigacji. Live view + take-over = nasz mostek
CDP w FastAPI: `Page.startScreencast` → ramki po WS do UI; input z UI →
`Input.dispatchMouseEvent`/`dispatchKeyEvent`. Pułapki z recon respektowane:
provider jawnie w configu każdego profilu (`browser.cloud_provider: slafy`,
`browser.backend: "off"`, `inactivity_timeout` podniesiony); close_session =
przeglądarka down, `user_data_dir` zostaje (persistent logins za darmo);
jeden proces gatewaya = jeden provider, boty rozróżniane po task_id/profilu.

**Tech Stack:** `playwright` (Python, do venv; `PLAYWRIGHT_BROWSERS_PATH=D:\tmp\pw-browsers`
— chromium już tam jest z e2e), CDP przez httpx/websockets (websockets jest w venv
z uvicorn), bez nowych zależności frontendowych.

## Global Constraints

- ZAKAZ C: — `user_data_dir` w profilu bota (G:), `PLAYWRIGHT_BROWSERS_PATH=D:\tmp\pw-browsers`.
- Zwrotka `create_session` DOSŁOWNIE wg BROWSER-RECON (klucz `bb_session_id`, BEZ
  `expires_at`). `close_session`/`emergency_cleanup` nie rzucają.
- Nie psuć 27 testów pytest + 2 speców Playwright.

---

### Task 1 (Opus 5): plugin browser provider `slafy`

**Files:** Create: `server/browser_plugin/plugin.yaml`, `server/browser_plugin/__init__.py`, `server/browser_plugin/provider.py`; Modify: `server/bots.py` lub `server/providers.py` (config browser per profil), `server/gateway.py` (instalacja pluginu do $SLAFY_DATA_DIR); Test: `tests/test_browser_provider.py`

- Przeczytaj tutorial `G:\Projects\hermes-agent\website\docs\developer-guide\browser-provider-plugin.md` + `agent/browser_provider.py` (ABC) — kopiuj wzorzec 1:1.
- Provider: `name="slafy"`; `create_session(task_id)` — ustal bota z task_id/HERMES_HOME (zbadaj, co Hermes przekazuje w task_id w kontekście profilu; fallback: mapuj po aktywnym HERMES_HOME), launch `playwright.chromium.launch_persistent_context(user_data_dir=profiles/<bot>/browser, args=["--remote-debugging-port=<wolny>"], headless=False)` — headless=False bo take-over i "okno = fallback take-overu"; zwróć cdp_url `http://127.0.0.1:<port>`. Rejestr sesji w pamięci procesu providera + plik `browser.json` w profilu (port/pid) dla restartu.
- `close_session` — zamknij context, zostaw user_data_dir; `emergency_cleanup` — best effort.
- Instalacja: `gateway.write_config` kopiuje/symlinkuje plugin do `$SLAFY_DATA_DIR/plugins/browser/slafy/` + wpis `plugins.enabled` jeśli wymagany (zbadaj) + per profil `browser.cloud_provider: slafy`, `browser.backend: "off"`, `browser.inactivity_timeout: 3600` (providers.set_provider lub bots.create_bot — tam gdzie config.yaml profilu już powstaje).
- `uv pip install playwright` do venv (pin z lockiem hermesa niepotrzebny — nasz dep).
- TDD: test jednostkowy providera bez Hermesa (create_session → cdp_url odpowiada na /json/version → close_session → user_data_dir istnieje → drugi create_session z tym samym user_data_dir).

### Task 2 (Opus 5): mostek CDP — live view + take-over + screenshot do czatu

**Files:** Create: `server/computer.py`; Modify: `server/app.py`; Test: `tests/test_computer.py`

**Interfaces (PINOWANE — Task 3 konsumuje):**
- `WS /api/bots/{id}/computer` — server→client: `{"type":"frame","data":"<base64 jpeg>","w":int,"h":int}`; client→server: `{"type":"input","event":{...surowe pola CDP Input.dispatch*Event, klucz "kind":"mouse"|"key"}}` oraz `{"type":"quality","fps":int}` (opcjonalne).
- `GET /api/bots/{id}/computer/status -> {"running": bool, "url": str|null}` (aktualna strona).
- `POST /api/bots/{id}/computer/screenshot -> {"data": "<base64 jpeg>"}` (do computer card w czacie).
- computer.py: podłącz się do cdp_url bota (z `browser.json` profilu — zapisany przez provider Taska 1); `Page.startScreencast` (format jpeg, everyNthFrame wg fps); forward ramek do wszystkich WS tego bota; input: `Input.dispatchMouseEvent`/`Input.dispatchKeyEvent` przez CDP. Brak przeglądarki = status running:false, WS zamyka się kodem 4404.
- TDD: testy na prawdziwym chromium z Taska 1 (launch w fixture): status, screenshot zwraca jpeg (magic bytes), screencast dostarcza >=1 ramkę, input klika (zmiana w DOM prostej strony data:).

### Task 3 (Fable 5): UI komputera

**Files:** Create: `ui/src/components/ComputerView.tsx`; Modify: `ui/src/components/RightPanel.tsx`, `ui/src/components/ChatView.tsx` (computer card), `ui/src/lib/api.ts` (+ typy), `ui/src/lib/ws.ts` (jeśli wspólny helper)

- RightPanel Computer section: placeholder → żywy thumbnail (canvas/img z ramek WS `/api/bots/{id}/computer`), hover `⤢ Open` → pełny ComputerView (overlay/dialog max szerokość, UI-SPEC §4).
- ComputerView: canvas z ramkami; przycisk **Take over** (filled) → tryb interaktywny: mousedown/mousemove/mouseup/klawiatura z canvas → eventy `input` po WS (skalowanie współrzędnych canvas→viewport wg w/h ramki); **I'm done** (outline) → koniec trybu; stan "You're in control" banner.
- Computer card w czacie (UI-SPEC §3, paul/cue_0006): gdy bot working i komputer running — karta: header `Computer` + zielony pill `⚙ Action needed` (na razie pokazywana na żądanie: przycisk w headerze czatu obok monitora NIE — najprościej: karta w RightPanel wystarcza; card w czacie dopiero gdy backend będzie emitował "needs attention" — faza 13; odnotuj cięcie).
- Gates: tsc + build zielone.

### Task 4: Gate fazy 4

**Files:** Test: `ui/e2e/computer.spec.ts` albo `tests/test_gate_faza4.py` (wybierz poziom, na którym da się stabilnie: pytest z prawdziwym providerem prościej niż pełny stack)

- Scenariusz gate'a: start przeglądarki bota → take-over: przez mostek CDP nawiguj do strony testowej z formularzem logowania (lokalny mock — serwer z ciasteczkiem sesji), "zaloguj się" inputem przez WS → zamknij sesję (`close_session`) → nowy `create_session` (ten sam user_data_dir) → ciasteczko/localStorage przetrwało = bot kontynuuje sesję po restarcie. Asercja na cookie.
- Pełny pytest + playwright zielone. LOOP.md: odhacz #13 (częściowo — persistent computer, logins), #14 (live view + take over, bez telefonu), #16/#17 zanotuj stan. FAZA: 5.
