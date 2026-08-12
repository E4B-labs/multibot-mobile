# Faza 11 — Import z Hermes Agenta — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Task 1 (backend+CLI, **Opus 5**) + Task 2 (UI, **Fable 5**) RÓWNOLEGLE —
> niezależne pliki. Task 3 gate na końcu. Subagenty NIE commitują.

**Goal (gate PLAN.md §5 fazy 11):** "Real hermes-agent profile imports; memory
searchable in-app". Wiersz C: "near-free thanks to the core mapping: importer
reads existing profile (config.yaml + SOUL.md + memory_store.db + cron defs)
→ creates a Bot".

**Architecture:** Bot JEST profilem Hermesa w `$SLAFY_DATA_DIR/profiles/<id>` —
import to kopia katalogu profilu + `bot.json` + wpięcie w naszą maszynerię.
Ensure-chain w `gateway.chat()` (klucz profilu, browser/memory/stt config,
junction skills, mcp) dokłada resztę przy pierwszym czacie — importer NIE
duplikuje tych kroków. Źródła profilu: katalog wskazany ścieżką (typowo
`~/.hermes` — profil default, LUB `~/.hermes/profiles/<name>`). Memory
searchable in-app = skopiowane `memory_store.db` + `memories/` czytają
istniejące endpointy /memory/* — zero nowego kodu.

## Global Constraints

- ZAKAZ C: ZAPISU. CZYTANIE z C: jest OK (źródłowy profil może żyć w
  `%LOCALAPPDATA%\hermes` na C: — import Z niego jest legalny, kopiujemy DO D:).
- Nie psuć 168 pytest + 4 spec Playwright.
- Import NIE nadpisuje istniejącego bota (FileExistsError → 409).
- Sekrety: `.env` źródłowego profilu kopiujemy (klucze providerów bota mają
  przejść), ale NIGDY nie logujemy zawartości.

---

### Task 1 (Opus 5): importer backend + CLI

**Files:** Create: `server/importer.py`; Modify: `server/app.py`; Test: `tests/test_importer.py`

**Interfaces (PINOWANE — UI Taska 2 koduje do tego):**
- `importer.inspect(source: str) -> dict` — waliduj ścieżkę: katalog z
  `config.yaml` = profil. Zwróć podgląd BEZ kopiowania:
  `{name, has_soul, has_memory (memory_store.db), memory_facts (count przez
  sqlite ro albo 0), has_markdown_memory, cron_jobs (count z cron/jobs.json),
  has_env, skills (count katalogów w skills/), source}`. Zła ścieżka →
  ValueError (422). UWAGA: jeżeli `source` wygląda na ROOT Hermesa (ma
  `profiles/`), zwróć też `profiles: [nazwy]` — UI pokaże wybór.
- `importer.run(source: str, bot_id: str, name: str | None = None) -> dict` —
  kopiuj katalog profilu do `profile_dir(bot_id)` (shutil.copytree,
  ignore=('browser', 'logs', 'cache', 'image_cache', 'audio_cache',
  'sessions', '__pycache__') — runtime'owe śmieci nie są tożsamością bota;
  'browser' waży setki MB i jest per maszyna). Jeżeli źródłowy profil ma
  PRAWDZIWY katalog `skills/` — po kopii zrób z niego retrofit junctionem
  przez `skills.ensure_shared(bot_id)` (istniejąca funkcja to robi: przenosi
  zawartość do shared i stawia junction). Potem `bot.json` (id, name = podane
  albo z inspect, created_at) zapisany naszym `bots._write` (nadpisze SOUL.md?
  — NIE: `_write` nadpisuje SOUL.md tożsamością bota; dla importu SOUL
  źródłowy to wartość — zbadaj `bots._write` i jeśli nadpisuje, zapisz
  bot.json bez regeneracji SOUL, np. bezpośrednio json do pliku, i odnotuj).
  Kolizja bot_id → FileExistsError (409). Zwróć bot dict jak z create_bot.
- CLI: `python -m server.importer <source> <bot_id> [--name X]` — `__main__`
  blok w tym samym pliku (inspect → print podglądu → run → print "OK <id>").
  ~15 linii, bez argparse jeśli wystarczy sys.argv (ponytail).
- REST (app.py): `POST /api/import/inspect {source}` → inspect;
  `POST /api/import {source, bot_id, name?}` → 201 + bot; po udanym imporcie
  `_broadcast({"type": "bot_created", "bot": bot})` jeżeli taki event istnieje
  w WS (sprawdź; jak nie ma — pomiń, lista botów i tak ładuje się przy mount).
- TDD: zbuduj w tmp fixture "źródłowy profil Hermesa" (config.yaml + SOUL.md +
  memory_store.db przez PRAWDZIWY MemoryStore z 2 faktami + cron/jobs.json z
  1 jobem + .env + skills/demo/SKILL.md); inspect zwraca poprawne liczniki;
  run kopiuje (SOUL zachowany ze źródła, memory_facts widoczne przez
  `memory.facts(bot_id)`, cron job widoczny przez `routines.list(bot_id)`,
  skill wylądował w SHARED dir przez junction retrofit), ignoruje śmieci
  (podłóż `browser/` i `logs/` — mają NIE być skopiowane); kolizja → 409 przez
  API; zła ścieżka → 422; root z `profiles/` → lista nazw.

### Task 2 (Fable 5): UI importu

**Files:** Create: `ui/src/components/ImportBotDialog.tsx`; Modify:
`ui/src/components/Sidebar.tsx` (menu `+`: trzecia pozycja "Import from
Hermes"), `ui/src/lib/api.ts`

- `api.ts`: `inspectImport(source) -> InspectResult`, `runImport(source,
  botId, name?) -> Bot` (kształty z Taska 1).
- ImportBotDialog (wzorzec NewBotDialog/NewGroupDialog): pole ścieżki źródła +
  przycisk `Inspect` → podgląd (name, liczba faktów pamięci, liczba rutyn,
  skills, "has SOUL"); gdy odpowiedź ma `profiles:` — select z nazwami
  (wybór dokleja `/profiles/<name>` do source i robi ponowny inspect); pola
  `Bot ID` (slug, prefill z name) i `Name`; `Import` → runImport → bot w
  sidebarze (refresh listy botów jak po create), dialog znika. Błędy 422/409
  inline (wzorzec NewBotDialog).
- Gates: `npm run build` zielony (PowerShell). Nie dotykaj backendu/e2e.

### Task 3: Gate fazy 11

**Files:** Test: `tests/test_gate_faza11.py`

- "REAL hermes-agent profile": zbuduj profil PRAWDZIWYM Hermesem —
  `hermes_profiles.create_profile("legacy")` pod osobnym HERMES_HOME (tmp,
  wzorzec bots.create_bot), dosyp fakty przez realny MemoryStore + cron job
  przez cron_jobs.create_job pod scope + własny SOUL.md ("Jestem Legacy").
  Import przez API (`POST /api/import`) → bot na liście; "memory searchable
  in-app" = `GET /api/bots/{id}/memory/facts?q=<fraza z faktu>` zwraca fakt;
  SOUL.md zachowany (zawiera "Jestem Legacy"); rutyna widoczna w
  `GET /api/bots/{id}/routines`; drugi import tego samego id → 409.
- Pełny pytest + specy Playwright zielone. LOOP.md: wiersz C DONE (importer
  CLI + UI + API; fizyczny ~/.hermes usera nietestowany w CI — ścieżka
  identyczna). FAZA: 12.
