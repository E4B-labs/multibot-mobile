# Faza 13 — Polish (domknięcie matrycy funkcji) — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> DWIE FALE. Fala 1 (permissions/attention) SEKWENCYJNIE PIERWSZA — jedyny
> element ryzykowny architektonicznie, robiony gdy faza jeszcze uniesie
> niespodziankę. Fala 2 RÓWNOLEGLE po niej (Cmd+K, settings, onboarding, usage,
> files, długi ogon). Task końcowy = audyt matrycy §2 + STATUS: DONE. Subagenty
> NIE commitują. Fakty: docs/reference/APPROVALS-RECON.md.

**Goal (gate PLAN.md §5 fazy 13):** "Feature-matrix audit: every row §2 checked
off". UI-SPEC §6 (Cmd+K), §11 (onboarding), §13 (attention states), §14
(missing: avatar picker done, settings screen, group view done).

**Decyzja architektoniczna (row 12 — approvals), z reconu + probe:** Natywne
blokujące approvals Hermesa istnieją WYŁĄCZNIE na `/v1/runs` + SSE
(`register_gateway_notify` wołane tylko tam, api_server.py:6707). Nasza ścieżka
`/v1/chat/completions` + `X-Hermes-Session-Id` auto-ładuje historię ze state.db
(api_server.py:4137) — a `/v1/runs` NIE (bierze tylko `conversation_history` z
body). Żaden endpoint nie daje NARAZ ciągłości sesji (gwarancja gate fazy 1) i
approvals. Migracja tury na runs = samodzielne wątkowanie historii = ryzyko dla
sprawdzonej ścieżki czatu w OSTATNIEJ fazie. **Descope uczciwy (gałąź advisora):**
row 12 = (a) EGZEKWOWANE reguły uprawnień per bot przez `platform_toolsets.
api_server` w config.yaml profilu (Hermes wymusza — realne on/off toolsetów:
terminal, browser, memory, skills, mcp), (b) UI reguł + widoczne stany uwagi
(§13). Blokada w połowie tury (pauza na człowieka) NIE wchodzi — odnotowana jako
limit w LOOP z cytatem, dlaczego (runs bez ciągłości). To spójne z linią pętli
"częściowo z uczciwym limitem".

## Global Constraints

- ZAKAZ C:. Nie psuć 198 pytest + 4 spec Playwright.
- Fala 1 przed falą 2. Każdy backendowy task pełny pytest zielony przed mergem.
- Reviewer: CodeRabbit wisi w każdej fazie — użyć subagenta-recenzenta na
  diffie permissions (minimum), reszta ręcznie + advisor.

---

## FALA 1 (sekwencyjnie, PIERWSZA)

### Task 1 (Opus 5): permission rules (egzekwowane) + attention state

**Files:** Create: `server/permissions.py`; Modify: `server/gateway.py`,
`server/app.py`; Test: `tests/test_permissions.py`

- `permissions.TOOLSETS` = lista sterowalnych: `["terminal","browser","memory",
  "skills","mcp","web","code"]` (zweryfikuj realne nazwy toolsetów w
  `tools/registry` / probą jak faza 9 — pinuj TYLKO istniejące).
- `permissions.get(bot_id) -> dict` — `{toolset: bool}` z config.yaml profilu
  (`platform_toolsets.api_server` = lista DOZWOLONYCH; brak klucza = wszystkie
  wł.). `permissions.set(bot_id, toolset, enabled)` — przepisuje listę w
  config.yaml (merge, wzorzec `_ensure_memory_config`). Wyłączony toolset = nie
  ma go na liście dozwolonych.
- `gateway._ensure_approvals_config(bot_id)` w ensure-chain: `approvals:
  {mode: manual}` (default `smart` = auto-approve, czyni feature fikcją —
  APPROVALS-RECON §4). Idempotentne.
- Attention (§13): `_run_chat` (już współdzielony) po odpowiedzi ustawia flagę
  uwagi, gdy bot sygnalizuje potrzebę człowieka. ponytail: bez klasyfikatora LLM
  — heurystyka na markerach w reply ("sign in", "log in", "approve", "hand
  back", "need you to", "zaloguj", "potwierdź") → `_broadcast({"type":
  "attention", "bot_id", "reason": <wycinek>})` + zapis `attention.json` w
  data_dir (per bot, kasowany przy następnej turze bez markera). Endpoint
  `GET /api/bots/{id}/attention` → `{reason}|null`. Upgrade: realny
  approval przez /v1/runs, gdy ciągłość na runs zostanie rozwiązana.
- REST: `GET /api/bots/{id}/permissions` → get; `PATCH /api/bots/{id}/
  permissions {toolset, enabled}` → set.
- TDD: set wyłącza toolset (config.yaml ma listę dozwolonych bez niego), get
  odczytuje; brak klucza = wszystkie true; `_ensure_approvals_config`
  idempotentne, wpisuje manual; attention marker w reply → event + endpoint
  zwraca reason, kolejna tura bez markera czyści.

### Task 2 (Fable 5): UI uprawnień + karta "Needs your attention"

**Files:** Create: `ui/src/components/PermissionsSection.tsx`; Modify:
`ui/src/components/BotSettings.tsx` (albo RightPanel), `ui/src/components/
Sidebar.tsx` (orange dot na wierszu), `ui/src/components/RightPanel.tsx`,
`ui/src/lib/api.ts`, `ui/src/lib/ws.ts`

- PermissionsSection w ustawieniach bota: przełączniki per toolset
  (`GET/PATCH /permissions`), caption "Control what this agent is allowed to
  do".
- Attention (§13): WS `attention` → pomarańczowa kropka na wierszu bota w
  sidebarze (zastępuje preview: "Waiting for you: <reason>") + karta w prawym
  panelu (pomarańczowy header "Needs your attention" + reason + `Skip` /
  `I'm done, continue` — przyciski wysyłają zwykłą wiadomość kontynuacyjną
  albo czyszczą stan). Reuse istniejącego `attention.json` przez GET przy
  mount.
- Gates: `npm run build` zielony.

### Task 3: Gate fali 1

**Files:** Test: `tests/test_gate_faza13_perms.py`

- REALNY gateway + mock LLM: bot z WYŁĄCZONYM toolsetem terminal — mock każe
  modelowi wywołać terminal, asercja że narzędzia nie ma w ofercie modelowi
  (`tools` w żądaniu mocka bez terminal-owych) albo wywołanie odrzucone.
  Kontrast: bot z włączonym terminalem ma je w ofercie. Dowodzi EGZEKWOWANIA
  uprawnień przez Hermesa, nie tylko zapisu configu. Attention: reply z
  markerem "sign in" → event `attention` wyemitowany.

---

## FALA 2 (równolegle, po fali 1)

### Task 4 (Opus 5): usage meter + files tab backend

**Files:** Create: `server/usage.py`, `server/files.py`; Modify:
`server/gateway.py` (capture usage), `server/app.py`; Test:
`tests/test_usage.py`, `tests/test_files.py`

- Usage: chat/completions zwraca `usage` (api_server.py:4368). `gateway.chat`
  wyciąga `response.json().get("usage")` i `usage.record(bot_id, usage)` →
  akumuluje `{prompt_tokens, completion_tokens, total_tokens, turns}` w
  `$SLAFY_DATA_DIR/usage.json` (per bot). `usage.get(bot_id)` /
  `usage.all()`. REST `GET /api/usage`, `GET /api/bots/{id}/usage`. Nie psuć
  kontraktu `_run_chat` (usage zapisywany obok, nie zmienia zwrotu).
- Files (§6 files tab, empty at launch): `files.list(bot_id) -> list[dict]`
  read-only listing `profile_dir(bot_id)/workspace` (wzorzec memory.py:
  `{name, size, modified, path}`; brak katalogu = []). REST
  `GET /api/bots/{id}/files`. Bez uploadu (launch: empty/read-only).
- TDD: usage akumuluje przez dwie tury (mock), all() sumuje; files listuje
  podłożone pliki workspace, pusty katalog = [].

### Task 5 (Fable 5): Cmd+K + Settings + onboarding + usage/files UI

**Files:** Create: `ui/src/components/CommandPalette.tsx`,
`ui/src/components/SettingsModal.tsx`, `ui/src/components/Onboarding.tsx`,
`ui/src/components/FilesTab.tsx`; Modify: `ui/src/App.tsx`, `lib/api.ts`

- Cmd+K (§6): globalny listener Cmd/Ctrl+K → modal, pola search + zakładki
  `All | Agents | Groups | Files | Routines | Actions`. All: wiersze botów
  (skok do czatu) + akcje ("Settings", "New Bot"). Reuse list z contextu.
  Files zakładka: pusto "No files yet" albo lista z `/files`. ponytail: fuzzy
  filter po nazwie, bez indeksu.
- SettingsModal (§14.2): theme (light/dark toggle — jeśli DS wspiera; inaczej
  placeholder), usage meter (suma `/api/usage` — total tokens per bot,
  tabela), link do permissions. Minimalny, nie pełny panel.
- Onboarding (§11): pierwsze uruchomienie (brak botów) → pełnoekranowy kreator
  "Give each Bot a job" + Next/Back, na końcu tworzy pierwszego bota (reuse
  createBot). Flaga w localStorage, żeby nie wracał.
- FilesTab: prosta lista `/files` w prawym panelu albo w Cmd+K (jedno miejsce
  wystarczy — wybierz, opisz).
- Gates: `npm run build` zielony.

### Task 6 (Fable 5): długi ogon z LOOP

**Files:** Modify: istniejące komponenty; `lib/api.ts`

- Inter-bot thread list w RightPanel (faza 7 limit: wątki tylko session-local;
  `GET /api/bots/{id}/interbot` już istnieje — dodać sekcję listy, klik otwiera
  InterbotThread).
- Routine drift-skip warning (faza 6 notka): przy zmianie providera bota po
  utworzeniu rutyny — ostrzeżenie w UI rutyn ("model changed; routines may be
  skipped until re-saved").
- @plugin/@mention auto-suggest (#25): rozszerz istniejący @ roster w
  Composerze o pluginy (część już jest z fazy 7 — zweryfikuj, dopnij jeśli
  brakuje).
- bot_created event (faza 3 notka): backend `_broadcast({"type":
  "bot_created", "bot"})` w POST /api/bots + import; UI odświeża listę botów
  między kartami. (Mała zmiana backendu DOZWOLONA w tym tasku — opisz.)
- Gates: `npm run build` + pełny pytest zielone.

### Task 7: Gate fazy 13 = AUDYT MATRYCY

**Files:** Test: `tests/test_gate_faza13.py`; Modify: `LOOP.md`

- Audyt: przejdź KAŻDY wiersz PLAN.md §2 (#1-39). Dla każdego: DONE / częściowo
  (z uczciwym limitem) / nieobjęty. Zapisz tabelę w `## RAPORT` LOOP.md z
  dowodem (plik/test/endpoint) per wiersz.
- `test_gate_faza13.py`: smoke integracyjny nowych endpointów
  (permissions get/set, usage, files, attention) przez TestClient — nie
  retestuje UI (specy Playwright), potwierdza że REST matrycy działa.
- Pełny pytest + WSZYSTKIE specy Playwright zielone.
- LOOP.md: **STATUS: DONE**, RAPORT wypełniony (audyt + znane limity zebrane z
  faz 4/6/7/9/10/12/13). To koniec pętli.
