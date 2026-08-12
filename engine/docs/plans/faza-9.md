# Faza 9 — Teach-a-task (nagranie → skill → replay) — plan wykonawczy

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
> Backend: **Opus 5**; frontend: **Fable 5**. Task 1 (skills backend) + Task 3 (UI)
> równolegle; Task 2 (recorder+synteza) PO Tasku 1 (obaj edytują app.py/gateway.py);
> Task 4 gate na końcu. Subagenty NIE commitują. Fakty:
> docs/reference/SKILLS-RECON.md (PRZECZYTAJ PRZED PRACĄ — format skilla, ścieżki,
> 4 pułapki „cichej odmowy") + BROWSER-RECON.md (CDP bridge).

**Goal (gate PLAN.md §5 fazy 9):** "Recorded 3-step browser task replays
successfully as a skill". Features #18-21 (§2). UI-SPEC §8 (Teach a task, red
border, "watching and learning", chip `Learn from demonstration`).

**Architecture (z recon):** Skill = agentskills.io (`SKILL.md` + frontmatter),
`skill_manage` JUŻ w toolsecie api_server — bot umie tworzyć skille dziś. Skille
są PER PROFIL (`HERMES_HOME/skills`), więc #19 „shared across bots" = junction
`profiles/<bot>/skills` → `$SLAFY_DATA_DIR/skills` (zweryfikowane: rglob +
os.walk przechodzą; ten sam wzorzec co mcp-tokens z fazy 5). `/slash` nie
istnieje na naszej ścieżce czatu — reuse `resolve_skill_command_key` +
`build_skill_invocation_message` (`agent/skill_commands.py:578,597`) w
`gateway.chat()`. `clarify` martwy na HTTP (`toolsets.py:461`) — #21 to
instrukcja w treści skilla, zero kodu. Nagranie demonstracji w 100% nasze: CDP
nie subskrybuje inputu usera; wzorzec = `Page.addScriptToEvaluateOnNewDocument`
+ `Runtime.addBinding` + `Page.frameNavigated` po tym samym `cdp_url` co
screencast fazy 4. Replay = kroki NL w SKILL.md wykonywane zwykłą turą z
toolsetem browser (deterministyczny skrypt odpada: drift selektorów, brak
samonaprawy).

## Global Constraints

- ZAKAZ C:. Nie psuć 125 pytest + 3 spec Playwright.
- 4 pułapki „cichej odmowy" (SKILLS-RECON §Konsekwencje):
  1. skill utworzony foregroundem = „user-owned" → background review go NIE
     tknie; po syntezie wołać `skill_usage.adopt_skill()` (inaczej #20 martwe);
  2. `creation_nudge_interval: 0` wyłącza CAŁY trigger background review —
     nie zerować;
  3. helpery Hermesa w naszym procesie rozwiązują `get_hermes_home()` lokalnie —
     scope przez `set_hermes_home_override` (wzorzec `_profile_scope` z routines);
  4. kurator gatewaya auto-archiwizuje skille po 90 dniach bezczynności —
     w profilu `curator.enabled: false` (ponytail: prościej niż pinowanie;
     upgrade = pin per skill, gdy kurator stanie się potrzebny).

---

### Task 1 (Opus 5): skills backend — junction, REST CRUD, /slash w chacie

**Files:** Create: `server/skills.py`; Modify: `server/gateway.py`, `server/app.py`;
Test: `tests/test_skills.py`

**Interfaces (PINOWANE — UI Taska 3 i Task 2 budują na tym):**
- `skills.ensure_shared(bot_id)` — katalog `$SLAFY_DATA_DIR/skills` (utwórz) +
  junction `profiles/<bot>/skills` → niego (`_winapi.CreateJunction`, wzorzec
  plugins.py z fazy 5; jeśli w profilu już jest PRAWDZIWY katalog skills z
  zawartością — przenieś zawartość do shared, potem junction). Idempotentne.
  Wołane w `gateway.chat()` obok `_ensure_memory_config`.
- `skills.list() -> list[dict]` — skan shared dir; rekord
  `{name, command, description, instructions, path}` (command = `/<name>`;
  frontmatter z SKILL.md — parsuj yaml między `---`, resztę jako instructions).
- `skills.view(name) -> dict | None`, `skills.update(name, **fields)`
  (name/description/instructions; zapis frontmatter+body z powrotem),
  `skills.delete(name) -> bool` (usuwa katalog skilla).
- `/slash` w chacie: w `gateway.chat()` — jeśli message zaczyna się od `/`,
  pod scope profilu (`set_hermes_home_override`) zawołaj
  `resolve_skill_command_key`; trafiony skill → `build_skill_invocation_message`
  i wyślij ZBUDOWANĄ wiadomość do gatewaya zamiast surowej. Nietrafiony →
  wiadomość leci bez zmian. (~10 linii — SKILLS-RECON §3.)
- Config per profil: `_ensure_skills_config(bot_id)` w gateway.py (wzorzec
  `_ensure_memory_config`): `curator.enabled: false`; NIE dotykać
  `creation_nudge_interval`.
- REST (app.py): `GET /api/skills`, `GET /api/skills/{name}`,
  `PATCH /api/skills/{name}`, `DELETE /api/skills/{name}` (404 gdy brak).
  Skille są WSPÓLNE — ścieżka globalna, nie per bot.
- TDD: ensure_shared tworzy junction i jest idempotentne (drugi call no-op);
  skill położony w shared dir widać przez `skills.list()` i przez ścieżkę
  profilu DWÓCH różnych botów (dowód #19); update edytuje frontmatter i body;
  delete usuwa; `/slash` w gateway.chat buduje invocation message (mock httpx —
  asercja treści wysłanej do gatewaya), nieznany slash przechodzi bez zmian;
  REST happy path + 404.

### Task 2 (Opus 5): recorder CDP + synteza skilla (PO Tasku 1)

**Files:** Create: `server/teach.py`; Modify: `server/app.py`; Test: `tests/test_teach.py`

**Interfaces (PINOWANE):**
- `teach.start(bot_id) -> {"recording_id"}` — po `cdp_url` z computer.py:
  `Page.addScriptToEvaluateOnNewDocument` (recorder JS: listener click/input/
  submit na `capture: true`, raport przez `Runtime.addBinding` binding
  `slafyTeach` — payload `{type, selector, text?, value?, ts}`; selector =
  najbliższe `[aria-label]`/`id`/`data-testid`/tekst przycisku, fallback CSS
  path) + `Runtime.evaluate` tego samego JS na JUŻ otwartych stronach +
  subskrypcja `Page.frameNavigated` (event `{type: "navigate", url}`). Zdarzenia
  do `$SLAFY_DATA_DIR/teach/<recording_id>.json` (stdlib json, append).
- `teach.stop(bot_id, recording_id) -> {"events", "transcript"}` — odłącz,
  transcript NL: `clicked "Login"`, `typed "hello" into search box`,
  `navigated to https://...` (jedna linia na zdarzenie, dedup szumu:
  scalaj kolejne input w to samo pole).
- `teach.synthesize(bot_id, recording_id, name=None) -> {"skill_name"}` —
  `gateway.chat(bot_id, prompt)` z transkryptem + poleceniem: utwórz skill
  przez `skill_manage` (kroki NL z transkryptu; w instructions dopisz
  sekcję #21 „przed pierwszym uruchomieniem zadaj pytania doprecyzowujące,
  wielokrotny wybór" i #20 „po każdym uruchomieniu skrytykuj wynik i popraw
  skill przez skill_manage"). Po odpowiedzi: zweryfikuj, że SKILL.md istnieje
  w shared dir (KeyError gdy nie) i zawołaj `skill_usage.adopt_skill()` pod
  scope profilu (pułapka 1 — bez tego background review nie tknie skilla).
- REST: `POST /api/bots/{id}/teach/start` (201), `POST .../teach/stop`,
  `POST .../teach/synthesize`. WS event `{"type": "teach", "bot_id", "state":
  "recording"|"stopped"|"skill_created", "skill_name"?}` przez `_broadcast`
  (UI: czerwona ramka + chip).
- TDD: recorder JS jako string zawiera binding i listenery (test lekki — bez
  realnej przeglądarki); transcript z przykładowych eventów (click+typed+nav,
  dedup inputów); synthesize: mock gateway.chat + skill podłożony w shared dir
  → adopt wywołany (mock/spy), brak skilla → KeyError; REST + WS event.
  Realne CDP zostaje na gate (Task 4).

### Task 3 (Fable 5): UI — Teach a task, panel skilli, `/` w composerze

**Files:** Create: `ui/src/components/SkillsSection.tsx`; Modify:
`ui/src/components/ComputerView.tsx`, `ui/src/components/Composer.tsx`,
`ui/src/lib/api.ts`, `ui/src/lib/ws.ts`, `ui/src/components/RightPanel.tsx`

**Kontrakt API (Task 1+2 — koduj do kontraktu):** REST skills CRUD + teach
start/stop/synthesize + WS `teach` event (kształty wyżej).

- ComputerView (UI-SPEC §8): przycisk `Teach a task` w prawym górnym rogu;
  po start: CZERWONA ramka widoku + tytuł `<Bot> is watching and learning`,
  przycisk zmienia się w `Finish`; po stop → synthesize → chip
  `Learn from demonstration` / toast `Skill created: /<name>` (WS `teach`).
- SkillsSection w RightPanel (pod Memory): lista skilli (name jako
  `/<command>` w mono, description, "Use when…"), edycja inline
  (name/description/instructions — PATCH), delete. Caption w duchu UI-SPEC §7
  („skills shared across all bots").
- Composer: wpisanie `/` na początku pustego inputu → popup listy skilli
  (command + description; wzorzec istniejącego @ rostera). Wybór wstawia
  `/name `.
- Gates: `npm run build` zielony. Nie dotykaj plików backendu ani e2e.

### Task 4: Gate fazy 9

**Files:** Test: `tests/test_gate_faza9.py`

- Scenariusz (gate: "recorded 3-step browser task replays as a skill"), realny
  gateway + realna przeglądarka bota (wzorzec gate 4) + mock LLM:
  1. NAGRANIE: `teach.start`, w przeglądarce bota (CDP, strona testowa
     `data:`/lokalny plik) wykonaj 3 kroki naszym mostkiem take-over
     (`Input.dispatchMouseEvent`/`dispatchKeyEvent` — recorder JS je złapie,
     bo lecą przez stronę): klik → wpisanie tekstu → nawigacja. `teach.stop`
     → transcript ma 3 linie we właściwej kolejności.
  2. SYNTEZA: mock LLM emituje tool_call `skill_manage` create (wzorzec
     tool_call z gate 8) → SKILL.md w shared dir; junction: plik widoczny ze
     ścieżki DRUGIEGO bota (dowód #19); adopt wykonany.
  3. REPLAY: `gateway.chat(bot, "/<skill>")` → invocation message zawiera
     kroki (asercja w `seen` mocka); mock odpowiada tool_callem browser
     (nawigacja) → strona bota realnie zmienia URL (asercja przez CDP)
     i tura kończy się odpowiedzią. To jest „replays successfully" —
     realna maszyneria minus inteligencja LLM.
- Pełny pytest + specy Playwright zielone. LOOP.md: #18 (nagranie → skill),
  #19 (slash + shared przez junction + edit/delete), #20 częściowo (instrukcja
  self-critique w skillu + adopt dla background review; realna samopoprawa
  wymaga prawdziwego LLM — odnotuj), #21 (instrukcja clarifying questions w
  skillu — `clarify` tool martwy na HTTP). FAZA: 10.
